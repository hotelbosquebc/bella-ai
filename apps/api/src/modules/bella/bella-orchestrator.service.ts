import { Injectable, Logger } from '@nestjs/common';
import { ConversationStatus, LeadStage, MessageSender } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NormalizedInboundMessage } from '../channels/channel.types';
import { MemoryService } from './memory.service';
import { ModelRouterService } from './model-router.service';
import { GuardrailsService } from './guardrails.service';
import { FollowUpService } from './follow-up.service';
import { ReservationEngineService } from '../reservations/reservation-engine.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PoliciesService } from '../policies/policies.service';
import { AuditService } from '../audit/audit.service';
import { MASTER_PROMPT, STAY_EXTRACTION_TOOL } from './prompts';

/**
 * Fluxo de IA do PRD:
 * mensagem → hóspede → histórico → memória → políticas → base vetorial →
 * disponibilidade → resposta → validação anti-prejuízo → envio → auditoria.
 */
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
  ) {}

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

    // Hóspede respondeu → interromper follow-ups pendentes
    const lead = await this.findOrCreateLead(guest.id);
    if (lead.nextFollowUpAt) await this.followUp.cancel(lead.id);

    // Conversa sob controle humano → Bella não responde
    if (conversation.status === ConversationStatus.PENDING_HUMAN) return;

    // 3-4. Memória + extração de intenção/dados de reserva
    const mem = await this.memory.load(guest.id, conversation.id);
    const extraction = await this.modelRouter.complete({
      task: 'booking_extraction',
      system: 'Extraia os dados de hospedagem da conversa usando a ferramenta.',
      messages: [{ role: 'user', content: inbound.content }],
      temperature: 0,
      tools: [STAY_EXTRACTION_TOOL],
    });
    const stay = extraction.toolInput ?? { intent: 'other' };
    const intent = String(stay.intent ?? 'other');

    // 5-6. Políticas oficiais + base vetorial (RAG)
    const relevantPolicies = await this.policies.findRelevant(guest.hotelId, inbound.content);
    const knowledgeChunks = await this.knowledge.search(guest.hotelId, inbound.content);

    // 7. Motor de reservas: com dados completos, gera link automaticamente
    let bookingContext = '';
    if (intent === 'booking') {
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
    const system = (settings?.masterPrompt ?? MASTER_PROMPT)
      .replace('{{assistantName}}', settings?.assistantName ?? 'Bella')
      .replace('{{hotelName}}', hotel.name)
      .replace('{{personality}}', settings?.personality ?? 'acolhedora, educada e natural')
      .replace('{{guestContext}}', this.memory.buildGuestContext(mem))
      .replace('{{policiesContext}}', relevantPolicies.map((p) => `[${p.category}] ${p.content}`).join('\n') || 'Nenhuma.')
      .replace('{{knowledgeContext}}', (knowledgeChunks.join('\n---\n') || 'Nenhum.') + (bookingContext ? `\n\nDADOS DE RESERVA (use exatamente estes valores):\n${bookingContext}` : ''));

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

    // 9. Validação anti-prejuízo
    const verdict = this.guardrails.evaluate({
      intent,
      draftResponse: draft.text,
      confidence: draft.confidence,
      hasPolicySource: relevantPolicies.length > 0,
    });

    // 10. Enviar ou escalar para humano
    if (verdict.requiresHuman) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: ConversationStatus.PENDING_HUMAN },
      });
      await this.sendReply(
        conversation.id,
        inbound,
        'Vou encaminhar sua solicitação para nossa equipe, que poderá ajudá-lo da melhor forma. ' +
          'Nossa recepção também está disponível 24 horas pelo telefone +55 47 3367-0211. 🌿',
      );
      this.logger.warn(`Escalado para humano: ${verdict.reason}`);
    } else {
      await this.sendReply(conversation.id, inbound, draft.text);
    }

    // 11. Auditoria total
    await this.audit.log({
      conversationId: conversation.id,
      question: inbound.content,
      response: verdict.requiresHuman ? `[ESCALADO] ${verdict.reason}` : draft.text,
      sources: knowledgeChunks,
      policyUsed: relevantPolicies[0]?.title ?? null,
      confidence: draft.confidence,
      model: draft.model,
      guardrailLevel: verdict.level,
      escalated: verdict.requiresHuman,
    });
  }

  private async sendReply(conversationId: string, inbound: NormalizedInboundMessage, content: string) {
    await this.prisma.message.create({
      data: { conversationId, sender: MessageSender.BELLA, content, type: 'text' },
    });
    // TODO: entrega real via API do canal de origem (WhatsApp Cloud API etc.)
    this.logger.log(`Resposta enviada via ${inbound.channel} para ${inbound.senderExternalId}`);
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
