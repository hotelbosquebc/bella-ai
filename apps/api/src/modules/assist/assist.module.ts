import { Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import { createHash } from 'crypto';
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
    // Reveillon: o pacote e de 5 diarias no minimo. Se o hospede pedir menos e o
    // periodo incluir o 31/12, o site NAO mostra disponibilidade - ele conclui
    // que estamos lotados e desiste. Esticamos a busca para 5 diarias para que
    // ele veja os valores, e a Bella explica a regra com naturalidade.
    let contextoReveillon = '';
    if (stay.checkin && stay.checkout) {
      const entrada = new Date(stay.checkin + 'T12:00:00');
      const saida = new Date(stay.checkout + 'T12:00:00');
      const noites = Math.round((saida.getTime() - entrada.getTime()) / 86400000);

      // A virada esta dentro da estadia? (a noite de 31/12 e a que conta)
      const virada = new Date(`${entrada.getFullYear() + (entrada.getMonth() === 0 ? -1 : 0)}-12-31T12:00:00`);
      const pegaVirada = entrada <= virada && virada < saida;

      if (pegaVirada && noites > 0 && noites < 5) {
        const novaSaida = new Date(entrada.getTime() + 5 * 86400000);
        const iso = novaSaida.toISOString().slice(0, 10);
        const original = `${stay.checkin} a ${stay.checkout}`;
        stay.checkout = iso;
        contextoReveillon =
          `\n\nPACOTE DE RÉVEILLON: o hóspede pediu ${noites} diária(s) (${original}), mas a virada de ano é ` +
          `pacote fechado de 5 diárias — com menos que isso o site nem mostra disponibilidade. ` +
          `O link abaixo JÁ FOI AJUSTADO para as 5 diárias (até ${iso}), para ele conseguir ver os valores.\n` +
          `Explique isso de forma leve e acolhedora, como uma característica da temporada e não como uma negativa: ` +
          `no Réveillon a estadia é um pacote de 5 diárias, e por isso o link mostra o período completo. ` +
          `Diga que o valor total é o mesmo de 1 a 5 diárias, então ele pode aproveitar os dias extras sem custo ` +
          `adicional — é um ganho, e vale apresentar assim. Nada de "não é possível" ou "infelizmente".`;
      }
    }

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

    // Mais de um apartamento: UM LINK PARA CADA.
    //
    // Caso real: o hospede pediu "1 apartamento para 1 casal + 1 pet" e
    // "1 apartamento para 3 adultos", pedindo valores SEPARADOS. Enviar um link
    // so - ou o link sem ocupacao - faz parecer que metade do pedido foi
    // ignorada. Como a busca aceita a ocupacao de um apartamento, geramos um
    // link por composicao, cada um ja com a gente certa dentro.
    /**
     * Classifica as pessoas de UM apartamento a partir das idades cruas.
     *
     * A conta NAO fica com o modelo. Caso real: "1 adulto e 1 menor de 11 anos"
     * virou 1 adulto no link, e "menores de 6 e 17 anos" virou duas criancas -
     * quando 11 e 17 ja contam como ADULTO pela politica do hotel. Aqui a regra
     * e aplicada sempre igual: 10 anos ou mais e adulto, 7 a 9 e meia, 0 a 6 e
     * cortesia. O rotulo mostrado ao hospede sai DESTES mesmos numeros, entao
     * texto e link nunca divergem.
     */
    const classificarApartamento = (a: any) => {
      const idades: number[] = Array.isArray(a?.idades) ? a.idades.map(Number).filter((n: number) => !isNaN(n)) : [];
      const adultos = (Number(a?.adultos) || 0) + idades.filter((i) => i >= 10).length;
      const criancas0_6 = (Number(a?.criancas0_6) || 0) + idades.filter((i) => i >= 0 && i <= 6).length;
      const criancas7_9 = (Number(a?.criancas7_9) || 0) + idades.filter((i) => i >= 7 && i <= 9).length;

      const partes: string[] = [];
      if (adultos) partes.push(`${adultos} ${adultos === 1 ? 'adulto' : 'adultos'}`);
      const criancas = criancas0_6 + criancas7_9;
      if (criancas) {
        const menores = idades.filter((i) => i < 10).sort((x, y) => x - y);
        partes.push(
          menores.length
            ? `${criancas} ${criancas === 1 ? 'criança' : 'crianças'} (${menores.join(' e ')} anos)`
            : `${criancas} ${criancas === 1 ? 'criança' : 'crianças'}`,
        );
      }
      return { adultos: Math.max(1, adultos), criancas0_6, criancas7_9, descricao: partes.join(' e ') };
    };

    const detalhe: any[] = Array.isArray(stay.apartamentos_detalhe) ? stay.apartamentos_detalhe : [];

    if (detalhe.length > 1) {
      const linhas = detalhe.map((a: any, i: number) => {
        const c = classificarApartamento(a);
        const url = this.reservations.buildBookingLink({
          checkin: stay.checkin,
          checkout: stay.checkout,
          adults: c.adultos,
          children0_6: c.criancas0_6,
          children7_9: c.criancas7_9,
        } as any);
        return `Apartamento ${i + 1} — ${c.descricao}:
${url}`;
      });

      const muitos = detalhe.length >= 4;
      return (
        `\n\nRESERVA DE ${detalhe.length} APARTAMENTOS — UM LINK PARA CADA.\n` +
        `Primeiro confirme, em uma linha, a composição que você entendeu de cada apartamento. ` +
        `Depois envie os links ABAIXO, na mesma ordem, cada um identificado e SOZINHO em sua linha, ` +
        `com uma linha em branco antes e depois. Cada link já vem com a ocupação daquele apartamento, ` +
        `então o hóspede vê o valor separado de cada um — que foi o que ele pediu.\n` +
        `NÃO junte tudo num link só e NÃO envie um link sem ocupação.\n\n` +
        linhas.join('\n\n') +
        `\n\nNÃO informe preços, NÃO trate isso como grupo/excursão e NÃO some todos os hóspedes num apartamento só.` +
        (muitos
          ? `\nComo são vários apartamentos, ofereça também que a nossa equipe monte o orçamento completo, ` +
            (isWithinBusinessHours()
              ? `encaminhando agora ao especialista em reservas.`
              : `informando o horário do setor — sem prometer atendimento imediato.`)
          : '')
      );
    }

    // Sabemos que são vários, mas não conseguimos separar as composições.
    if (Number(stay.apartamentos) > 1) {
      const linkBase = this.reservations.buildSearchLink(stay.checkin, stay.checkout);
      return (
        `\n\nRESERVA DE ${stay.apartamentos} APARTAMENTOS (composição de cada um não ficou clara): ` +
        `confirme com o hóspede quantas pessoas ficam em CADA apartamento — com isso você consegue ` +
        `enviar um orçamento separado para cada um. Se ele já tiver dito e você não separou, releia a conversa.\n` +
        `Se preferir adiantar, este link abre a busca pelas datas, e na página ele ajusta os hóspedes ` +
        `e o campo "Nº apartamentos":\n${linkBase}\n` +
        `NÃO apresente esse link como orçamento fechado do pedido todo.` +
        ofertaAtendimento
      );
    }

    // Disponibilidade REAL, consultada no motor de reservas. Só faz sentido para
    // UM apartamento: com vários, a ocupação somada não representa nenhuma busca
    // válida (e passaria de 6 pessoas, o que o site recusaria).
    let contextoDisponibilidade = '';
    try {
      const disp = await this.disponibilidade.consultar(
        stay.checkin,
        stay.checkout,
        Number(stay.adults) || 1,
        Number(stay.children0_6) || 0,
        Number(stay.children7_9) || 0,
      );

      if (disp && disp.semDisponibilidade) {
        // Basta UM dia lotado no meio do período para o site não devolver nada.
        // Mandar o link aqui seria pior que não responder: o hóspede clica, bate
        // no aviso de indisponível e volta perguntando o que houve.
        const dias = disp.diasIndisponiveis.length
          ? ` O(s) dia(s) sem disponibilidade nesse intervalo: ${disp.diasIndisponiveis.join(', ')}.`
          : '';
        return (
          `\n\nSEM DISPONIBILIDADE (consultado agora no sistema, para ${stay.checkin} a ${stay.checkout}): ` +
          `NÃO envie o link e NÃO diga que seguem os valores — para este período o site não oferece nenhum apartamento.` +
          dias +
          `\nInforme com clareza e cordialidade que para essas datas não temos disponibilidade. ` +
          `Se houver dia(s) citado(s) acima, diga QUAL dia está lotado: muitas vezes o hóspede consegue ajustar ` +
          `a entrada ou a saída em um dia e resolver. Convide-o a informar outras datas que você verifica de novo. ` +
          `NÃO invente datas alternativas nem diga que "temos vaga" em outro período sem ter consultado.` +
          ofertaAtendimento
        );
      }

      if (disp) {
        const poucos = disp.categorias.filter((c) => c.restantes !== null);
        const linhas: string[] = [];
        if (poucos.length) {
          linhas.push(
            'Restam poucos apartamentos: ' + poucos.map((c) => `${c.categoria} (${c.restantes})`).join(', ') + '.',
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
      `NÃO informe preços nem prometa verificar disponibilidade — o link já mostra tudo isso.` + contextoDisponibilidade + contextoReveillon + ofertaAtendimento
    );
  }


  /**
   * Registra o que a Bella sugeriu x o que o atendente realmente enviou.
   *
   * É o retorno mais honesto que temos: quando o humano reescreve antes de
   * mandar, a diferença mostra onde ela erra — sem depender de alguém notar e
   * avisar. Guardamos só os dois textos; a conversa entra como HASH, então dá
   * para agrupar por contato sem armazenar telefone nem nome.
   */
  @Post('feedback')
  async feedback(
    @Body()
    body: {
      hotelId?: string;
      conversa?: string;
      acao?: string;
      sugestao?: string;
      enviado?: string;
      modelo?: string;
    },
  ) {
    const sugestao = (body.sugestao || '').trim();
    const enviado = (body.enviado || '').trim();
    if (!sugestao || !enviado) return { ok: false, motivo: 'textos vazios' };

    const acoesValidas = ['igual', 'editada', 'descartada'];
    const acao = acoesValidas.includes(body.acao || '') ? body.acao! : 'editada';

    // Hash curto e estável da conversa: agrupa sem identificar o hóspede.
    const conversa = body.conversa
      ? createHash('sha256').update(body.conversa).digest('hex').slice(0, 12)
      : null;

    await this.prisma.suggestionFeedback.create({
      data: {
        hotelId: body.hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque',
        conversa,
        acao,
        sugestao: sugestao.slice(0, 4000),
        enviado: enviado.slice(0, 4000),
        modelo: body.modelo || null,
      },
    });
    return { ok: true };
  }

  /**
   * O que aprender com o uso: casos em que o atendente NÃO enviou o que a Bella
   * escreveu. É a lista que vira correção de regra.
   */
  @Get('feedback')
  async listarFeedback(@Query('hotelId') hotelId?: string, @Query('dias') dias?: string) {
    const id = hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    const desde = new Date(Date.now() - (Number(dias) || 7) * 86400000);
    const todos = await this.prisma.suggestionFeedback.findMany({
      where: { hotelId: id, createdAt: { gte: desde } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const porAcao = todos.reduce((acc: Record<string, number>, f) => {
      acc[f.acao] = (acc[f.acao] || 0) + 1;
      return acc;
    }, {});
    return {
      periodoDias: Number(dias) || 7,
      total: todos.length,
      porAcao,
      /** só o que divergiu: é onde está o aprendizado */
      divergencias: todos
        .filter((f) => f.acao !== 'igual')
        .map((f) => ({
          quando: f.createdAt,
          acao: f.acao,
          conversa: f.conversa,
          sugerido: f.sugestao,
          enviado: f.enviado,
        })),
    };
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
