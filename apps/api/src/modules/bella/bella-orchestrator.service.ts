import { Injectable, Logger } from '@nestjs/common';
import { ConversationStatus, LeadStage, MessageSender } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NormalizedInboundMessage } from '../channels/channel.types';
import { MemoryService } from './memory.service';
import { ModelRouterService } from './model-router.service';
import { normalizar } from '../attachments/attachments.module';
import { corrigirLinks, garantirLink } from '../../common/links';
import { mensagemDeEntregaAoHumano, mensagemForaDoAtendimento } from '../../common/contato';
import { ehMensagemDeEspera, idiomaDaMensagem, mensagemDeEspera } from '../../common/mensagem-espera';
import { semGarantiaDeVaga } from '../../common/disponibilidade';
import { semPromessaDeRegistro } from '../../common/registro';
import { semCustoDeHorarioExtra } from '../../common/horario-extra';
import { semRaciocinioVazado, semAssuntoNaoPerguntado } from '../../common/resposta-limpa';
import { semPrecoInventado } from '../../common/preco';
import { motivoParaHumano, assuntoForaDoAtendimento } from './escalonamento';
import { buscarContatoMarcado } from '../contatos/contatos.module';
import { GuardrailsService } from './guardrails.service';
import { FollowUpService } from './follow-up.service';
import { ReservationEngineService } from '../reservations/reservation-engine.service';
import { OutboundService } from '../outbound/outbound.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PoliciesService } from '../policies/policies.service';
import { AuditService } from '../audit/audit.service';
import { MASTER_PROMPT, STAY_EXTRACTION_TOOL } from './prompts';
import { isWithinBusinessHours, contextoDeHorario, inicioDoDiaEmSaoPaulo } from './business-hours';

/**
 * Fluxo de IA do PRD:
 * mensagem → hóspede → histórico → memória → políticas → base vetorial →
 * disponibilidade → resposta → validação anti-prejuízo → envio → auditoria.
 */
/** Silencio da equipe depois do qual a Bella volta a responder no WhatsApp. */
const PAUSA_DA_EQUIPE_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class BellaOrchestratorService {
  private readonly logger = new Logger(BellaOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memory: MemoryService,
    private readonly modelRouter: ModelRouterService,
    private readonly guardrails: GuardrailsService,
    private readonly followUp: FollowUpService,
    private readonly reservations: ReservationEngineService,
    private readonly knowledge: KnowledgeService,
    private readonly policies: PoliciesService,
    private readonly audit: AuditService,
    private readonly outbound: OutboundService,
  ) {}

  /**
   * A leitura do pedido (datas, pessoas, apartamentos, crianças, Réveillon,
   * período novo...) é a MESMA da extensão.
   *
   * Até 21/10/2026 o caminho automático tinha um motor próprio, bem mais
   * fraco: extraía só da ÚLTIMA mensagem e não tinha nenhuma das travas que a
   * extensão ganhou com prints reais — divisão em apartamentos, ocupação de
   * outro dia, período que substitui o já respondido, "pet porte pequeno",
   * saída no dia da entrada. Pedido do dono: os dois caminhos sempre iguais.
   * E é o automático que responde SEM ninguém revisar.
   *
   * A função mora no AssistController e é registrada aqui quando o servidor
   * sobe (o módulo de atendimento já depende deste, e importar de volta
   * fecharia um ciclo). Sem registro, cai no motor antigo — melhor que calar.
   */
  private leitorDoPedido: ((conversa: string) => Promise<string>) | null = null;

  definirLeitorDoPedido(fn: (conversa: string) => Promise<string>) {
    this.leitorDoPedido = fn;
  }

  /** A conversa do banco no formato que a extensão manda: "Hóspede (hoje): ...", "Nós: ...". */
  private conversaComoTexto(mensagens: { sender: MessageSender; content: string; timestamp: Date }[]): string {
    const inicioDeHoje = inicioDoDiaEmSaoPaulo().getTime();
    return mensagens
      .filter((m) => (m.content || '').trim())
      .map((m) => {
        const quem = m.sender === MessageSender.GUEST ? 'Hóspede' : 'Nós';
        const hoje = new Date(m.timestamp).getTime() >= inicioDeHoje ? ' (hoje)' : '';
        return `${quem}${hoje}: ${m.content}`;
      })
      .join('\n');
  }

  async handleInbound(inbound: NormalizedInboundMessage): Promise<void> {
    // 1-2. Identificar hóspede e conversa
    const guest = await this.findOrCreateGuest(inbound);
    const conversation = await this.findOrCreateConversation(guest.id, inbound);

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: MessageSender.GUEST,
        content: inbound.content,
        type: inbound.contentType,
      },
    });
    await this.subirNaCaixaDeEntrada(conversation.id);

    // Hóspede respondeu → interromper follow-ups pendentes
    const lead = await this.findOrCreateLead(guest.id);
    if (lead.nextFollowUpAt) await this.followUp.cancel(lead.id);

    // WhatsApp por coexistencia: a equipe respondeu pelo aplicativo e ficou
    // quieta por 2h - a Bella volta. Sem isso, uma resposta da recepcao de
    // manha calaria a Bella na conversa para sempre, e a duvida da noite
    // ficaria sem ninguem ("o importante e responder", dono, 22/10/2026).
    // So quando a pausa veio de uma resposta da equipe (sem pedido de ajuda
    // em aberto) e nunca para guia marcado.
    if (
      conversation.status === ConversationStatus.PENDING_HUMAN &&
      !conversation.escalationReason &&
      inbound.channel === 'WHATSAPP'
    ) {
      const ultimaDaEquipe = await this.prisma.message.findFirst({
        where: { conversationId: conversation.id, sender: MessageSender.HUMAN_AGENT },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      });
      const quieta = ultimaDaEquipe && Date.now() - new Date(ultimaDaEquipe.timestamp).getTime() > PAUSA_DA_EQUIPE_MS;
      const guia = quieta
        ? await buscarContatoMarcado(this.prisma, guest.hotelId, {
            identificador: inbound.senderExternalId,
            nome: inbound.senderName ?? guest.name,
          })
        : null;
      if (quieta && !guia) {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: ConversationStatus.OPEN, assignedUserId: null },
        });
        conversation.status = ConversationStatus.OPEN;
        this.logger.log('Equipe quieta ha mais de 2h nesta conversa: a Bella volta a responder.');
      }
    }

    // Conversa sob controle humano → Bella não responde
    if (conversation.status === ConversationStatus.PENDING_HUMAN) return;

    // Modo de operação definido pelo dono no painel (Central da Bella).
    // "auto" entrega o expediente à equipe e cobre só o fora de horário.
    const modo = (await this.prisma.aiSettings.findUnique({ where: { hotelId: guest.hotelId } }))?.mode ?? 'auto';
    if (modo === 'off') {
      this.logger.log('Bella desligada no painel — mensagem registrada, sem resposta automática.');
      return;
    }
    // Instagram e Facebook: a Bella responde SEMPRE, inclusive no expediente.
    // Decisao do dono em 21/10/2026 - so o que ela nao souber vai para uma
    // pessoa, com alerta sonoro no painel (motivoParaHumano + AlertaAtendimento).
    // O WhatsApp segue a regra do modo: no "auto", o expediente e da equipe.
    const sempreResponde = inbound.channel === 'INSTAGRAM' || inbound.channel === 'FACEBOOK';
    if (modo === 'auto' && isWithinBusinessHours() && !sempreResponde) {
      this.logger.log('Modo automático dentro do expediente — atendimento fica com a equipe.');
      return;
    }

    // Quem a Bella NAO atende vai direto para uma pessoa, ANTES de qualquer IA.
    //
    // Regras do dono (21/10/2026): guia de grupos e excursoes (marcado no
    // painel ou na extensao) fala sempre com a equipe; curriculo e oferta de
    // venda nao sao reserva nem duvida sobre o hotel. Uma mensagem pronta, a
    // conversa fica com a equipe e o painel avisa - sem extracao, sem
    // resposta gerada, sem ida e volta.
    const marcado = await buscarContatoMarcado(this.prisma, guest.hotelId, {
      identificador: inbound.senderExternalId,
      nome: inbound.senderName ?? guest.name,
    });
    const naoEHospede = marcado ? null : assuntoForaDoAtendimento(inbound.content);
    if (marcado || naoEHospede) {
      const motivo = marcado
        ? marcado.tipo === 'guia'
          ? 'contato marcado: guia de grupos e excursões'
          : `contato marcado: ${marcado.tipo}`
        : naoEHospede === 'curriculo'
          ? 'currículo: não é hóspede'
          : 'oferta de venda: não é hóspede';
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: ConversationStatus.PENDING_HUMAN, escalationReason: motivo },
      });
      await this.sendReply(
        conversation.id,
        inbound,
        naoEHospede ? mensagemForaDoAtendimento(naoEHospede) : this.humanHandoffMessage(),
      );
      this.logger.warn(`Direto para humano, sem IA: ${motivo}`);
      return;
    }

    // "Estou verificando" antes de qualquer IA - ver common/mensagem-espera.ts.
    // Pedido do dono (22/10/2026): mesmo que a resposta demore, o hospede
    // sabe que ela vem. Uma por rodada: se a ultima mensagem nossa ja e a de
    // espera (o hospede mandou varias linhas seguidas), nao repete.
    try {
      const ultimaNossa = await this.prisma.message.findFirst({
        where: { conversationId: conversation.id, sender: MessageSender.BELLA },
        orderBy: { timestamp: 'desc' },
        select: { content: true },
      });
      if (!ultimaNossa || !ehMensagemDeEspera(ultimaNossa.content)) {
        const falouHoje = await this.prisma.message.findFirst({
          where: {
            sender: MessageSender.BELLA,
            timestamp: { gte: inicioDoDiaEmSaoPaulo() },
            conversation: { guestId: guest.id },
          },
          select: { id: true },
        });
        await this.sendReply(
          conversation.id,
          inbound,
          mensagemDeEspera(idiomaDaMensagem(inbound.content), !falouHoje),
        );
      }
    } catch (err) {
      // Sem a espera, a resposta de verdade ainda sai: nao derruba o atendimento.
      this.logger.warn(`Mensagem de espera falhou: ${err instanceof Error ? err.message : err}`);
    }

    // 3-4. Memória + extração de intenção/dados de reserva
    const mem = await this.memory.load(guest.id, conversation.id);
    // A mensagem de espera nao e resposta: fora da leitura e do historico.
    // Varias leituras usam "o que o hospede disse DEPOIS da nossa ultima
    // mensagem" - com a espera contando, esse trecho ficaria sempre vazio.
    mem.recentMessages = mem.recentMessages.filter(
      (m: any) => !(m.sender === MessageSender.BELLA && ehMensagemDeEspera(m.content)),
    );
    const today = new Date().toISOString().slice(0, 10);
    const extraction = await this.modelRouter.complete({
      task: 'booking_extraction',
      system: `Extraia os dados de hospedagem mencionados pelo hóspede. Hoje é ${today}. Converta datas relativas (ex.: "julho", "próximo fim de semana") para o formato YYYY-MM-DD no ano correto.`,
      messages: [{ role: 'user', content: inbound.content }],
      temperature: 0,
      tools: [STAY_EXTRACTION_TOOL],
    });
    const stay = extraction.toolInput ?? { intent: 'other' };
    const intent = this.normalizeIntent(stay);
    this.logger.log(`Extração [${extraction.model}]: intent=${intent} stay=${JSON.stringify(stay)}`);

    // 5-6. Políticas oficiais + base de conhecimento do hotel
    const relevantPolicies = await this.policies.findRelevant(guest.hotelId, inbound.content);
    const knowledgeText = await this.knowledge.getKnowledgeContext(guest.hotelId);

    // 7. Motor de reservas: com dados completos, gera link automaticamente
    let bookingContext = '';
    if (this.leitorDoPedido) {
      try {
        bookingContext = await this.leitorDoPedido(this.conversaComoTexto(mem.recentMessages as any));
      } catch (err) {
        // Extração indisponível (IA fora): sem dado de reserva, a resposta pede
        // o que falta em vez de inventar.
        this.logger.warn(`Leitura do pedido falhou: ${err instanceof Error ? err.message : err}`);
        bookingContext = '';
      }
      if (/sbreserva\.silbeck/i.test(bookingContext)) {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { stage: LeadStage.QUOTE_SENT },
        });
        await this.followUp.scheduleAfterQuote(lead.id);
      }
    } else if (intent === 'booking') {
      const result = await this.reservations.process(guest, stay);
      bookingContext = result.contextForPrompt;
      if (result.quoteSent) {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { stage: LeadStage.QUOTE_SENT },
        });
        await this.followUp.scheduleAfterQuote(lead.id);
      }
    }

    // 8. Montar resposta
    const settings = await this.prisma.aiSettings.findUnique({ where: { hotelId: guest.hotelId } });
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: guest.hotelId } });
    const assistantName = settings?.assistantName ?? 'Bella';

    // Apresentação: uma vez por contato A CADA DIA. Quem volta a falar noutro
    // dia deve saber de novo que está falando com uma assistente; quem já falou
    // hoje não precisa ouvir a apresentação de novo a cada resposta.
    // A busca é pelo hóspede (não pela conversa) para não repetir a
    // apresentação quando ele escreve por mais de um canal no mesmo dia.
    const jaFalouHoje = await this.prisma.message.findFirst({
      where: {
        sender: MessageSender.BELLA,
        timestamp: { gte: inicioDoDiaEmSaoPaulo() },
        conversation: { guestId: guest.id },
      },
      select: { id: true },
    });

    const identityRule = jaFalouHoje
      ? `você JÁ se apresentou a este contato hoje. NÃO se apresente de novo: nada de "Olá, sou a ${assistantName}..." no começo da resposta. Responda direto ao que foi perguntado.`
      : `esta é a sua PRIMEIRA resposta a este contato hoje. Comece se apresentando como "${assistantName}, assistente online do ${hotel.name}", numa linha só, para o hóspede saber que fala com uma assistente virtual. Depois pule uma linha e responda o que foi perguntado. Não repita a apresentação nas mensagens seguintes.`;

    const system = (settings?.masterPrompt ?? MASTER_PROMPT)
      .replaceAll('{{assistantName}}', assistantName)
      .replaceAll('{{hotelName}}', hotel.name)
      .replaceAll('{{personality}}', settings?.personality ?? 'acolhedora, educada e natural')
      .replaceAll('{{identityRule}}', identityRule)
      .replaceAll('{{guestContext}}', this.memory.buildGuestContext(mem))
      .replaceAll('{{policiesContext}}', relevantPolicies.map((p) => `[${p.category}] ${p.content}`).join('\n') || 'Nenhuma.')
      .replaceAll('{{knowledgeContext}}', (knowledgeText || 'Nenhum.') + (bookingContext ? `\n\nDADOS DE RESERVA (use exatamente estes valores):\n${bookingContext}` : '')) +
      contextoDeHorario();

    const history = mem.recentMessages.map((m) => ({
      role: m.sender === MessageSender.GUEST ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

    const draft = await this.modelRouter.complete({
      task: intent === 'booking' ? 'sales' : 'general',
      system,
      messages: [...history, { role: 'user', content: inbound.content }],
      temperature: settings?.temperature ?? 0.7,
    });


    // O link que sai TEM de ser o nosso.
    //
    // Primeiro teste real pelo Messenger (15/10/2026): o servidor montou o
    // link certo e o modelo o reescreveu num formato mais curto e inventado,
    // que nao leva a lugar nenhum. A extensao ja tinha essa trava; este
    // caminho, nao. Agora os dois usam a mesma.
    //
    // Os enderecos oficiais sao os que o motor de reservas colocou no
    // contexto - nunca os que o modelo escreveu.
    const linksOficiais = (bookingContext.match(/https?:\/\/\S+/g) || []).map((u) => u.replace(/[),.]+$/, ''));
    if (draft.text && linksOficiais.length) {
      const corrigido = garantirLink(corrigirLinks(draft.text, linksOficiais), linksOficiais);
      if (corrigido !== draft.text) {
        this.logger.warn('Link da resposta foi corrigido para o endereco oficial');
        draft.text = corrigido;
      }
    }

    // Nao garantir vaga que ninguem consultou.
    //
    // checkAvailability() neste caminho e um esqueleto que devolve sempre
    // "tem vaga". O link do motor mostra a disponibilidade de verdade, entao
    // a resposta certa e mandar o link - nunca afirmar que ha apartamento.
    if (draft.text) {
      const semGarantia = semGarantiaDeVaga(draft.text, false);
      if (semGarantia !== draft.text) {
        this.logger.warn('Resposta afirmava disponibilidade sem consulta - frase removida');
        draft.text = semGarantia;
      }
    }

    // A Bella nao registra recado, nao anota na reserva e nao avisa a
    // recepcao. Dizer que fez isso manda o hospede embora tranquilo com uma
    // informacao falsa - caso real de 16/10/2026, chegada as 19h "registrada".
    if (draft.text) {
      const semPromessa = semPromessaDeRegistro(draft.text);
      if (semPromessa !== draft.text) {
        this.logger.warn('Resposta PROMETIA registro - frase removida');
        draft.text = semPromessa;
      }
      // Early/late: custo e com a recepcao (regra do dono, 22/10/2026).
      const semCusto = semCustoDeHorarioExtra(draft.text);
      if (semCusto !== draft.text) {
        this.logger.warn('Resposta dava custo de early/late - frase removida');
        draft.text = semCusto;
      }
      // Rascunho da IA e assunto que ninguem perguntou - ver common/resposta-limpa.
      draft.text = semRaciocinioVazado(draft.text);
      const falasDoHospede = [
        ...mem.recentMessages.filter((m: any) => m.sender === MessageSender.GUEST).map((m: any) => m.content),
        inbound.content,
      ].join(String.fromCharCode(10));
      draft.text = semAssuntoNaoPerguntado(draft.text, falasDoHospede);
    }

    // PRECO INVENTADO nunca chega ao hospede.
    //
    // Esta trava existia so na sugestao da extensao, onde um atendente le
    // antes de enviar. Aqui, que e o caminho automatico, ela faltava - e no
    // diagnostico de 20/10/2026 a guarda do outro lado disparou 13 vezes em 7
    // dias, ou seja, a Bella tenta cotar valor com frequencia. Um preco
    // inventado no Instagram sai direto para o hospede, sem ninguem no meio.
    if (draft.text) {
      const semPreco = semPrecoInventado(draft.text, linksOficiais[0] || null);
      if (semPreco !== draft.text) {
        this.logger.warn('Resposta trazia PRECO - frase removida');
        draft.text = semPreco;
      }
    }
    // 9. Validação anti-prejuízo
    const verdict = this.guardrails.evaluate({
      intent,
      draftResponse: draft.text,
      confidence: draft.confidence,
      hasPolicySource: relevantPolicies.length > 0,
    });

    // 9b. Casos em que ela não responde sozinha (regras em código, não no
    // prompt): pedido de atendente, reclamação, idioma que ela não atende,
    // preço escrito, promessa que depende de gente, e resposta repetida.
    const motivoHumano =
      verdict.requiresHuman
        ? verdict.reason ?? 'bloqueado pelo anti-prejuízo'
        : motivoParaHumano({
            falaDoHospede: inbound.content,
            resposta: draft.text,
            respostasAnteriores: mem.recentMessages
              .filter((m) => m.sender === MessageSender.BELLA)
              .map((m) => m.content),
          });

    // 10. Enviar ou escalar para humano
    if (motivoHumano) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: ConversationStatus.PENDING_HUMAN, escalationReason: motivoHumano },
      });
      await this.sendReply(conversation.id, inbound, this.humanHandoffMessage());
      this.logger.warn(`Escalado para humano: ${motivoHumano}`);
    } else {
      await this.sendReply(conversation.id, inbound, draft.text);
      await this.enviarAnexos(conversation.id, inbound);
    }

    // 11. Auditoria total
    await this.audit.log({
      conversationId: conversation.id,
      question: inbound.content,
      response: motivoHumano ? `[ESCALADO] ${motivoHumano}` : draft.text,
      sources: knowledgeText ? ['base-de-conhecimento'] : [],
      policyUsed: relevantPolicies[0]?.title ?? null,
      confidence: draft.confidence,
      model: draft.model,
      guardrailLevel: verdict.level,
      escalated: Boolean(motivoHumano),
    });
  }

  /**
   * Anexos que combinam com o que o hospede perguntou.
   *
   * Casamento por palavra-chave, igual ao caminho da extensao: e previsivel,
   * nao gasta chamada de IA e o dono controla exatamente o que dispara cada
   * arquivo, pelo painel.
   *
   * Vao por LINK publico (/api/attachments/:id/file) - a Meta busca o arquivo
   * direto, sem upload a cada envio.
   */
  private async enviarAnexos(conversationId: string, inbound: NormalizedInboundMessage): Promise<void> {
    const alvo = normalizar(inbound.content || '');
    if (!alvo.trim()) return;

    const todos = await this.prisma.attachment.findMany({
      where: { hotelId: inbound.hotelId, active: true },
      select: { id: true, title: true, mimeType: true, keywords: true },
    });
    const combinam = todos.filter((a) =>
      a.keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
        .some((k) => alvo.includes(k)),
    );
    if (!combinam.length) return;

    const base = (process.env.API_PUBLIC_URL || '').replace(/\/+$/, '');
    if (!base) {
      // Sem endereco publico a Meta nao consegue buscar o arquivo. Melhor nao
      // enviar e dizer por que do que mandar um link quebrado ao hospede.
      this.logger.warn('API_PUBLIC_URL nao configurada — anexos nao enviados');
      return;
    }

    for (const a of combinam) {
      const url = `${base}/api/attachments/${a.id}/file`;
      const entregue = await this.outbound.sendArquivo(inbound.channel, inbound.senderExternalId, url, a.mimeType, a.title);
      await this.prisma.message.create({
        data: { conversationId, sender: MessageSender.BELLA, content: `[anexo] ${a.title}`, type: 'document' },
      });
      await this.subirNaCaixaDeEntrada(conversationId);
      this.logger.log(`Anexo "${a.title}" ${entregue ? 'entregue' : 'NAO entregue'} via ${inbound.channel}`);
    }
  }

  private async sendReply(conversationId: string, inbound: NormalizedInboundMessage, content: string) {
    await this.prisma.message.create({
      data: { conversationId, sender: MessageSender.BELLA, content, type: 'text' },
    });
    await this.subirNaCaixaDeEntrada(conversationId);
    const delivered = await this.outbound.send(inbound.channel, inbound.senderExternalId, content);
    this.logger.log(
      `Resposta ${delivered ? 'entregue' : 'registrada (entrega pendente)'} via ${inbound.channel} para ${inbound.senderExternalId}`,
    );
  }

  /**
   * Normaliza a intenção para o enum canônico em inglês. O LLM frequentemente
   * responde em português ("reserva", "cancelamento"); aqui mapeamos sinônimos
   * e idiomas. Se houver datas extraídas, tratamos como reserva por padrão.
   */
  private normalizeIntent(stay: Record<string, unknown>): string {
    const raw = String(stay.intent ?? '').toLowerCase().trim();
    const map: [RegExp, string][] = [
      [/book|reserv|hosped|di[áa]ria|or[çc]amento|cota[çc]/, 'booking'],
      [/cancel/, 'cancellation'],
      [/refund|reembols|estorno|devolu/, 'refund'],
      [/discount|desconto|promo/, 'discount_request'],
      [/complain|reclama[çc]/, 'complaint'],
      [/question|d[úu]vida|pergunt|informa[çc]/, 'question'],
    ];
    for (const [re, canonical] of map) {
      if (re.test(raw)) return canonical;
    }
    // Sem intenção clara, mas com datas → é uma reserva
    if (stay.checkin || stay.checkout) return 'booking';
    return raw || 'other';
  }

  /**
   * Mensagem de encaminhamento para humano, conforme o horário:
   * - Dentro do expediente: a equipe assume o atendimento.
   * - Fora do expediente: informa o horário e orienta ligar para a recepção 24h.
   */
  private humanHandoffMessage(): string {
    // O texto vive em common/contato.ts: estava escrito a mao aqui e divergiu
    // do atalho /dados que a recepcao manda. O dono confirmou: 9h-12h30, 14h30-17h30.
    return mensagemDeEntregaAoHumano(isWithinBusinessHours());
  }

  /**
   * A recepcao respondeu pelo aplicativo do WhatsApp (coexistencia).
   *
   * A Meta avisa com um "eco" (webhook smb_message_echoes) cada mensagem que
   * sai pelo celular ou pelo WhatsApp Web. E a equipe assumindo: a Bella para
   * de responder nesta conversa, e o pedido de ajuda (se havia) conta como
   * atendido. Ela volta sozinha depois de 2h de silencio da equipe - ver
   * handleInbound.
   */
  async registrarRespostaDaEquipe(dados: {
    hotelId: string;
    channel: NormalizedInboundMessage['channel'];
    guestExternalId: string;
    content: string;
  }) {
    const inbound = {
      hotelId: dados.hotelId,
      channel: dados.channel,
      senderExternalId: dados.guestExternalId,
      content: dados.content,
      contentType: 'text',
      receivedAt: new Date(),
      raw: null,
    } as unknown as NormalizedInboundMessage;
    const guest = await this.findOrCreateGuest(inbound);
    const conversation = await this.findOrCreateConversation(guest.id, inbound);
    await this.prisma.message.create({
      data: { conversationId: conversation.id, sender: MessageSender.HUMAN_AGENT, content: dados.content, type: 'text' },
    });
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: ConversationStatus.PENDING_HUMAN, escalationReason: null, updatedAt: new Date() },
    });
  }

  /**
   * A caixa de entrada ordena pela atualizacao da CONVERSA, e gravar uma
   * mensagem nao mexe nela. Caso real (21/10/2026): mensagem nova numa
   * conversa antiga ficava no meio da lista - ou alem das 100 que o painel
   * carrega - e para a recepcao era como se nao tivesse chegado.
   */
  async subirNaCaixaDeEntrada(conversationId: string) {
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  }

  private async findOrCreateGuest(inbound: NormalizedInboundMessage) {
    return this.prisma.guest.upsert({
      where: { hotelId_phone: { hotelId: inbound.hotelId, phone: inbound.senderExternalId } },
      update: { name: inbound.senderName ?? undefined },
      create: {
        hotelId: inbound.hotelId,
        phone: inbound.senderExternalId,
        name: inbound.senderName,
      },
    });
  }

  private async findOrCreateConversation(guestId: string, inbound: NormalizedInboundMessage) {
    const existing = await this.prisma.conversation.findFirst({
      where: { guestId, channel: inbound.channel, status: { not: ConversationStatus.ARCHIVED } },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) return existing;
    return this.prisma.conversation.create({
      data: { guestId, channel: inbound.channel },
    });
  }

  private async findOrCreateLead(guestId: string) {
    const existing = await this.prisma.lead.findFirst({
      where: { guestId, stage: { notIn: [LeadStage.POST_STAY, LeadStage.RECURRING_CUSTOMER] } },
    });
    if (existing) return existing;
    return this.prisma.lead.create({ data: { guestId, stage: LeadStage.NEW_LEAD } });
  }
}
