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

  // O scraper marca as mensagens do dia corrente com "(hoje)" — ex.: "Nós (hoje): ...".
  // A apresentação se repete A CADA DIA: a thread do WhatsApp é contínua, então
  // uma regra "uma vez por conversa" fazia a Bella nunca mais se apresentar.
  const linhas = texto.split('\n');
  const linhasDeHoje = linhas.filter((l) => /^\s*(H[óo]spede|N[óo]s)\s*\(hoje\)\s*:/i.test(l));

  if (linhasDeHoje.length) {
    const nossasDeHoje = linhasDeHoje.filter((l) => /^\s*N[óo]s\s*\(hoje\)\s*:/i.test(l));
    const jaSeApresentouHoje = nossasDeHoje.some((l) => APRESENTACAO.test(l));
    if (jaSeApresentouHoje) {
      return (
        `\n\nAPRESENTAÇÃO: você JÁ se apresentou a este contato hoje. ` +
        `NÃO se apresente de novo, NÃO comece com "Olá, sou a Bella..." nem repita seu cargo. ` +
        `Responda direto ao que foi perguntado, como quem continua um papo.`
      );
    }
    return (
      `\n\nAPRESENTAÇÃO: esta é a PRIMEIRA resposta a este contato HOJE (mesmo que a conversa venha de dias anteriores). ` +
      `Comece se apresentando como "Bella, assistente online do Hotel do Bosque", numa linha só, ` +
      `depois pule uma linha e responda o que foi perguntado.`
    );
  }

  // Sem marcação de data (WhatsApp mudou o HTML): mantém o comportamento antigo,
  // uma apresentação por conversa — melhor do que repetir a cada mensagem.
  const jaRespondemos = /(^|\n)\s*N[óo]s\s*(\(hoje\))?\s*:/.test(texto);
  if (jaRespondemos || APRESENTACAO.test(texto)) {
    return (
      `\n\nAPRESENTAÇÃO: esta conversa JÁ está em andamento e o hóspede já sabe quem você é. ` +
      `NÃO se apresente de novo, NÃO comece com "Olá, sou a Bella..." nem repita seu cargo. ` +
      `Responda direto ao que foi perguntado, como quem continua um papo.`
    );
  }
  return `\n\nAPRESENTAÇÃO: esta é a PRIMEIRA resposta desta conversa — apresente-se uma única vez, de forma breve.`;
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
      const linkBase = this.reservations.buildBookingLink({ ...stay, adults: 0, children0_6: 0, children7_9: 0 });
      return (
        `\n\nRESERVA: o hóspede quer ${stay.apartamentos} apartamentos. ` +
        `PRIMEIRO confirme a composição que você entendeu (quantos apartamentos e quantas pessoas em cada um), ` +
        `depois envie ESTE link para ele escolher os apartamentos e reservar no site:\n${linkBase}\n` +
        `O link deve ficar SOZINHO em uma linha, com uma linha em branco antes e outra depois.\n` +
        `NÃO informe preços, NÃO trate isso como grupo/excursão e NÃO some todos os hóspedes num apartamento só.`
      );
    }

    const link = this.reservations.buildBookingLink(stay);
    return (
      `\n\nRESERVA: envie ESTE link ao hóspede, exatamente como está, para ele ver ` +
      `disponibilidade e valores e reservar pelo site:\n${link}\n` +
      `O link deve ficar SOZINHO em uma linha, com uma linha em branco antes e outra depois — ` +
      `nunca grudado no texto nem logo após dois-pontos, senão o WhatsApp quebra o endereço.\n` +
      `NÃO informe preços nem prometa verificar disponibilidade — o link já mostra tudo isso.`
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
