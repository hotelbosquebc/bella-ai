import { Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BellaModule } from '../bella/bella.module';
import { ModelRouterService } from '../bella/model-router.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PoliciesModule } from '../policies/policies.module';
import { PoliciesService } from '../policies/policies.service';
import { MASTER_PROMPT, STAY_EXTRACTION_TOOL } from '../bella/prompts';
import { contextoDeHorario, isWithinBusinessHours, HORARIO_RESERVAS_TEXTO } from '../bella/business-hours';
import { normalizar } from '../attachments/attachments.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { ReservationEngineService } from '../reservations/reservation-engine.service';
import { SilbeckAvailabilityService } from '../reservations/silbeck-availability.service';

/**
 * Deixa a mensagem apresentável no WhatsApp. O prompt já pede isso, mas o
 * modelo às vezes cola o link no texto ("reservas:https://...") — e aí o
 * WhatsApp quebra o endereço e o hóspede recebe um link morto. Aqui a regra
 * é aplicada de forma determinística, sem depender da obediência do modelo.
 */
export function formatarParaWhatsApp(texto: string): string {
  return (texto || '')
    // markdown não renderiza no WhatsApp: **negrito** apareceria com asteriscos
    .replace(/\*\*(.+?)\*\*/g, '$1')
    // todo link isolado em sua própria linha
    .replace(/[ \t]*(https?:\/\/\S+?)([.,;:]?)(?=\s|$)/g, '\n\n$1\n\n')
    // no máximo uma linha em branco entre blocos
    .replace(/\n{3,}/g, '\n\n')
    // espaços sobrando nas pontas de cada linha (o texto após o link vinha com
    // um espaço à esquerda, herdado de onde a URL foi recortada)
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .trim();
}

/**
 * A Bella deve se apresentar nesta mensagem?
 *
 * O modelo vê a conversa mas não sabe se já se apresentou, então repetia
 * "Olá, sou a Bella, assistente online..." em TODA resposta — o que soa
 * robótico numa conversa em andamento. Aqui a decisão é tomada no código e
 * entregue pronta ao prompt.
 */
export function contextoDeApresentacao(conversation: string): string {
  const texto = conversation || '';
  const APRESENTACAO = /sou a bella|assistente (online|virtual)/i;

  // A apresentação se repete A CADA DIA, por regra do hotel. O scraper marca as
  // mensagens do dia corrente com "(hoje)" — ex.: "Nós (hoje): ...".
  //
  // A pergunta certa é UMA só: já nos apresentamos HOJE? Se sim, não repete. Em
  // qualquer outro caso — inclusive quando não há NENHUMA mensagem de hoje, que
  // é justamente o primeiro contato do dia — ela se apresenta.
  //
  // A versão anterior tinha um caminho alternativo que, ao não encontrar marcas
  // de "(hoje)", concluía "conversa em andamento, não se apresente". Numa
  // conversa cuja última mensagem era de ontem isso zerava a apresentação do
  // dia — exatamente o contrário da regra.
  const jaSeApresentouHoje = texto
    .split('\n')
    .filter((l) => /^\s*N[óo]s\s*\(hoje\)\s*:/i.test(l))
    .some((l) => APRESENTACAO.test(l));

  if (jaSeApresentouHoje) {
    return (
      `\n\nAPRESENTAÇÃO: você JÁ se apresentou a este contato hoje. ` +
      `NÃO se apresente de novo, NÃO comece com "Olá, sou a Bella..." nem repita seu cargo. ` +
      `Responda direto ao que foi perguntado, como quem continua um papo.`
    );
  }

  return (
    `\n\nAPRESENTAÇÃO: esta é a PRIMEIRA resposta a este contato HOJE — mesmo que a conversa venha ` +
    `de ontem ou de dias anteriores, e mesmo que a equipe já tenha respondido antes. ` +
    `Comece OBRIGATORIAMENTE com "Olá! Sou a Bella, assistente online do Hotel do Bosque." numa linha, ` +
    `pule uma linha e então responda o que foi perguntado. Não pule essa linha por achar que a conversa já está em andamento.`
  );
}

/**
 * Co-piloto do atendente (extensão do WhatsApp Web): sugere uma resposta a
 * partir do texto da conversa, SEM enviar nada e SEM criar registros. O humano
 * revisa e envia. Não há automação de envio — risco de ban praticamente nulo.
 */
@Controller('assist')
export class AssistController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: ModelRouterService,
    private readonly knowledge: KnowledgeService,
    private readonly policies: PoliciesService,
    private readonly reservations: ReservationEngineService,
    private readonly disponibilidade: SilbeckAvailabilityService,
  ) {}

  /**
   * Anexos que combinam com o que o hóspede perguntou (regras de pets, catálogo
   * de ingressos). Casamento por palavra-chave, não por IA: é previsível, não
   * gasta chamada e o dono controla exatamente o que dispara cada arquivo.
   */
  private async anexosRelevantes(texto: string, hotelId: string) {
    const alvo = normalizar(texto);
    const todos = await this.prisma.attachment.findMany({
      where: { hotelId, active: true },
      select: { id: true, title: true, mimeType: true, keywords: true },
    });
    return todos
      .filter((a) =>
        a.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
          .some((k) => alvo.includes(k)),
      )
      .map((a) => ({ id: a.id, title: a.title, mimeType: a.mimeType }));
  }

  /**
   * O papel da Bella é ENVIAR O LINK do site para o hóspede reservar sozinho —
   * ela não fecha reserva nem cota preço. Extrai datas/ocupação da conversa e,
   * quando estiverem completas, monta o link do motor oficial. Se faltar algo,
   * instrui a pedir APENAS o que falta (sem prometer verificar valores).
   */
  private async bookingContext(conversation: string): Promise<string> {
    const today = new Date().toISOString().slice(0, 10);
    const extraction = await this.ai.complete({
      task: 'booking_extraction',
      system:
        `Extraia os dados de hospedagem mencionados pelo hóspede. Hoje é ${today}. ` +
        `Converta datas relativas (ex.: "próximo fim de semana") para YYYY-MM-DD no ano correto.`,
      messages: [{ role: 'user', content: conversation }],
      temperature: 0,
      tools: [STAY_EXTRACTION_TOOL],
    });
    const stay: any = extraction.toolInput ?? {};
    if (stay.intent !== 'booking') return '';

    // Trava contra data inventada.
    //
    // Caso real: a hospede escreveu apenas "valor para 5 adultos, seria 1
    // diaria" e a sugestao saiu com "entrada de 5 a 6 de setembro" - data que
    // nunca existiu na conversa. Um contexto contaminado (ou uma inferencia do
    // modelo) virava link com o periodo errado. Antes de aceitar a data
    // extraida, exigimos que a conversa realmente mencione alguma data.
    const temNumeroDeData = /\b\d{1,2}\s*(?:\/|-|\s+de\s+)\s*(?:\d{1,2}|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i;
    const temDataRelativa = /\b(hoje|amanh[ãa]|fim de semana|final de semana|feriado|natal|ano novo|r[ée]veillon|carnaval|p[áa]scoa)\b/i;
    const temDiaDaSemana = /\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)\b/i;
    const mencionaData =
      temNumeroDeData.test(conversation) ||
      temDataRelativa.test(conversation) ||
      temDiaDaSemana.test(conversation);

    if (!mencionaData && (stay.checkin || stay.checkout)) {
      stay.checkin = null;
      stay.checkout = null;
    }


    // Trava contra quantidade de pessoas inventada.
    //
    // Caso real: o hospede escreveu "gostaria de ver disponibilidade pra
    // 16/01/2027 ate 20/01/2027" - so as datas - e a sugestao saiu "para 2
    // pessoas" com o link pronto. O 2 nunca foi dito por ninguem. Mesmo erro da
    // data inventada, so que na ocupacao: o modelo preenche o campo com um
    // padrao plausivel e o link sai com gente a mais ou a menos.
    const temNumeroDePessoas = /\b\d+\s*(pessoa|adulto|h[óo]spede|crian|beb[êe]|gente)/i;
    const temPessoasPorExtenso = /\b(um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez)\s+(pessoa|adulto|h[óo]spede|crian)/i;
    const temTipoDeQuarto = /\b(casal|duplo|dupla|triplo|tripla|qu[áa]druplo|individual|single|solteiro)\b/i;
    const temComposicao = /\b(somos|seremos|s[ãa]o)\s+\d+|\bsozinh[oa]\b|\beu e (a |o |minha |meu )/i;
    const mencionaPessoas =
      temNumeroDePessoas.test(conversation) ||
      temPessoasPorExtenso.test(conversation) ||
      temTipoDeQuarto.test(conversation) ||
      temComposicao.test(conversation);

    if (!mencionaPessoas && stay.adults) {
      stay.adults = null;
    }

    // Oferta de atendimento humano — SÓ dentro do horário do setor de reservas.
    // A Bella não fecha reserva, mas a equipe fecha, com pagamento via pix. Quem
    // trava na hora de pagar sozinho converte quando aparece essa porta. Fora do
    // expediente a oferta some: prometer especialista às 22h de domingo cria
    // expectativa que ninguém atende.
    const ofertaAtendimento = isWithinBusinessHours()
      ? `\n\nOFERTA DE ATENDIMENTO HUMANO (o setor de reservas está atendendo AGORA): ` +
        `logo DEPOIS do link, acrescente UMA frase curta oferecendo que, se ele preferir fazer a reserva ` +
        `por aqui mesmo pelo WhatsApp com pagamento via pix, basta pedir que você encaminha para o nosso ` +
        `especialista em reservas. Diga de forma natural, sem insistir e sem repetir em toda mensagem. ` +
        `NÃO prometa valor, desconto, prazo nem condição: só ofereça o encaminhamento. ` +
        `Se ele aceitar, encaminhe para a equipe.`
      : '';
    const faltam = ['checkin', 'checkout', 'adults'].filter((c) => !stay[c]);
    if (faltam.length) {
      const rotulos: Record<string, string> = {
        checkin: 'data de entrada',
        checkout: 'data de saída',
        adults: 'quantidade de adultos',
      };
      return (
        `\n\nRESERVA: faltam dados para gerar o link. Peça ao hóspede APENAS: ` +
        `${faltam.map((c) => rotulos[c]).join(', ')}. Não pergunte o que ele já informou. ` +
        `NÃO prometa verificar valores ou disponibilidade — quem consulta é o próprio hóspede no link.`
      );
    }

    // Mais de um apartamento: o link carrega a ocupação de UM apartamento só.
    // Mandar 7 pessoas num link único traria o resultado errado (o máximo é 6
    // por apartamento), então enviamos o link da busca e o hóspede monta lá.
    if (Number(stay.apartamentos) > 1) {
      const linkBase = this.reservations.buildSearchLink(stay.checkin, stay.checkout);
      return (
        `\n\nRESERVA: o hóspede quer ${stay.apartamentos} apartamentos. ` +
        `PRIMEIRO confirme a composição que você entendeu (quantos apartamentos e quantas pessoas em cada um), ` +
        `depois envie ESTE link para ele escolher os apartamentos e reservar no site:\n${linkBase}\n` +
        `O link deve ficar SOZINHO em uma linha, com uma linha em branco antes e outra depois.\n` +
        `NÃO informe preços, NÃO trate isso como grupo/excursão e NÃO some todos os hóspedes num apartamento só.` + ofertaAtendimento
      );
    }


    // Disponibilidade REAL, consultada no motor de reservas. É o que permite à
    // Bella falar de procura sem inventar: o site avisa "Apenas N disponíveis"
    // quando restam poucos, e omite a categoria quando esgota.
    let contextoDisponibilidade = '';
    try {
      const disp = await this.disponibilidade.consultar(
        stay.checkin,
        stay.checkout,
        Number(stay.adults) || 1,
        Number(stay.children0_6) || 0,
        Number(stay.children7_9) || 0,
      );
      if (disp) {
        const poucos = disp.categorias.filter((c) => c.restantes !== null);
        const linhas: string[] = [];
        if (poucos.length) {
          linhas.push(
            'Restam poucos apartamentos: ' +
              poucos.map((c) => `${c.categoria} (${c.restantes})`).join(', ') +
              '.',
          );
        }
        if (disp.esgotadas.length) {
          linhas.push('Já SEM disponibilidade neste período: ' + disp.esgotadas.join(', ') + '.');
        }
        if (linhas.length) {
          contextoDisponibilidade =
            `\n\nDISPONIBILIDADE REAL (consultada agora no sistema, para ${stay.checkin} a ${stay.checkout}):\n` +
            linhas.join('\n') +
            `\nVocê PODE usar esta informação para criar urgência HONESTA — é dado real, não suposição. ` +
            `Mencione de forma natural e sem alarde ("para essas datas restam poucas unidades dessa categoria"), ` +
            `uma vez só, junto do convite para concluir pelo link. ` +
            `NÃO invente número diferente do que está aqui, NÃO diga que o hotel está lotado, ` +
            `e NÃO cite categoria esgotada como se fosse opção. Se nada acima indicar escassez, não fale de procura.`;
        }
      }
    } catch (_) {
      /* indisponível: segue sem falar de procura */
    }
    const link = this.reservations.buildBookingLink(stay);
    return (
      `\n\nRESERVA: envie ESTE link ao hóspede, exatamente como está, para ele ver ` +
      `disponibilidade e valores e reservar pelo site:\n${link}\n` +
      `ANTES do link escreva UMA FRASE dizendo o que ele é e que a reserva se faz ali — ` +
      `por exemplo: "Segue o link com os valores e a disponibilidade para o seu período. ` +
      `Por ele você já consegue concluir a sua reserva:". Nunca cole o link solto, sem essa frase: ` +
      `o hóspede não sabe se aquilo é um orçamento, uma foto ou onde deve clicar.\n` +
      `O link deve ficar SOZINHO em uma linha, com uma linha em branco antes e outra depois — ` +
      `nunca grudado no texto nem logo após dois-pontos, senão o WhatsApp quebra o endereço.\n` +
      `NÃO informe preços nem prometa verificar disponibilidade — o link já mostra tudo isso.` + contextoDisponibilidade + ofertaAtendimento
    );
  }

  /**
   * A Bella deve agir agora? A extensão do WhatsApp Web consulta isto ao abrir
   * cada conversa para decidir se sugere sozinha ou fica só no botão manual.
   *
   * O envio NUNCA é automático em nenhum modo — quem manda é sempre o atendente.
   * "auto" liga a sugestão automática apenas fora do horário do setor de reservas,
   * que é quando não há ninguém para escrever a resposta.
   */
  @Get('status')
  async status(@Query('hotelId') hotelId?: string) {
    const id = hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    const settings = await this.prisma.aiSettings.findUnique({ where: { hotelId: id } });
    const mode = settings?.mode ?? 'auto';
    const dentroDoHorario = isWithinBusinessHours();
    const autoSuggest = mode === 'on' || (mode === 'auto' && !dentroDoHorario);
    return {
      mode,
      dentroDoHorario,
      horarioTexto: HORARIO_RESERVAS_TEXTO,
      /** sugerir sozinha ao abrir a conversa */
      autoSuggest,
      /** botão manual disponível (some só com a Bella desligada) */
      manualDisponivel: mode !== 'off',
    };
  }

  @Post('suggest')
  async suggest(@Body() body: { hotelId?: string; conversation: string; lastMessage?: string }) {
    const hotelId = body.hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    const conversation = (body.conversation || '').slice(-6000); // últimas mensagens
    const focus = body.lastMessage || conversation;

    // Desligada é desligada: não basta a extensão esconder o botão — o servidor
    // também recusa, senão uma aba antiga em cache continuaria sugerindo.
    const modo = (await this.prisma.aiSettings.findUnique({ where: { hotelId } }))?.mode ?? 'auto';
    if (modo === 'off') {
      return { suggestion: '', model: 'desligada', mode: modo };
    }

    const [settings, hotel, relevantPolicies, knowledgeText, reserva, anexos] = await Promise.all([
      this.prisma.aiSettings.findUnique({ where: { hotelId } }),
      this.prisma.hotel.findUnique({ where: { id: hotelId } }),
      this.policies.findRelevant(hotelId, focus),
      this.knowledge.getKnowledgeContext(hotelId),
      this.bookingContext(conversation),
      this.anexosRelevantes(focus, hotelId),
    ]);

    const system =
      (settings?.masterPrompt ?? MASTER_PROMPT)
        .replaceAll('{{assistantName}}', settings?.assistantName ?? 'Bella')
        .replaceAll('{{hotelName}}', hotel?.name ?? 'Hotel do Bosque')
        .replaceAll('{{personality}}', settings?.personality ?? 'acolhedora, educada e natural')
        // A regra de apresentação deste caminho vem de contextoDeApresentacao()
        // (abaixo), que enxerga a conversa raspada do WhatsApp.
        .replaceAll('{{identityRule}}', 'siga a instrução de APRESENTAÇÃO indicada mais abaixo.')
        .replaceAll('{{guestContext}}', 'Atendimento em andamento pelo WhatsApp.')
        .replaceAll('{{policiesContext}}', relevantPolicies.map((p) => `[${p.category}] ${p.content}`).join('\n') || 'Nenhuma.')
        .replaceAll('{{knowledgeContext}}', knowledgeText || 'Nenhum.') +
      contextoDeApresentacao(conversation) +
      contextoDeHorario() +
      reserva +
      (anexos.length
        ? `\n\nANEXO: o atendente vai enviar junto o arquivo "${anexos.map((a) => a.title).join('", "')}". ` +
          `Mencione que está enviando esse material em anexo, de forma natural, e NÃO repita todo o conteúdo dele na mensagem.`
        : '') +
      '\n\nVocê está SUGERINDO uma resposta para um atendente humano usar. Escreva apenas a mensagem sugerida ao hóspede, pronta para enviar, sem rótulos nem aspas.';

    const draft = await this.ai.complete({
      task: 'sales',
      system,
      messages: [{ role: 'user', content: `Conversa até aqui:\n${conversation}\n\nSugira a próxima resposta ao hóspede.` }],
      temperature: settings?.temperature ?? 0.7,
    });

    return { suggestion: formatarParaWhatsApp(draft.text), model: draft.model, attachments: anexos };
  }
}

@Module({
  imports: [BellaModule, KnowledgeModule, PoliciesModule, ReservationsModule],
  controllers: [AssistController],
})
export class AssistModule {}
