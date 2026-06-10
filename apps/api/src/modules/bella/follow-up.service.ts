import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LeadStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface FollowUpStep {
  step: number;
  afterHours: number;
  message: string;
}

const FOLLOW_UP_STEPS: FollowUpStep[] = [
  { step: 1, afterHours: 24, message: 'Olá! Gostaria de saber se posso ajudá-lo com sua reserva. 😊' },
  { step: 2, afterHours: 72, message: 'Ainda temos disponibilidade para as datas consultadas. Posso garantir sua reserva?' },
  { step: 3, afterHours: 24 * 7, message: 'Posso verificar novas opções para sua hospedagem?' },
  { step: 4, afterHours: 24 * 15, message: 'Seguimos à disposição para planejar sua estadia no Hotel do Bosque 🌿' },
];

/**
 * Follow-up automático de orçamentos não concluídos: 24h → 72h → 7d → 15d.
 * Interrompido quando a reserva é confirmada ou o hóspede responde
 * (o orquestrador zera followUpStep ao receber mensagem do hóspede).
 */
@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async run(): Promise<void> {
    const due = await this.prisma.lead.findMany({
      where: {
        stage: { in: [LeadStage.QUOTE_SENT, LeadStage.NEGOTIATION] },
        nextFollowUpAt: { lte: new Date() },
        followUpStep: { lt: FOLLOW_UP_STEPS.length },
      },
      include: { guest: true },
    });

    for (const lead of due) {
      const next = FOLLOW_UP_STEPS[lead.followUpStep];
      if (!next) continue;

      this.logger.log(`Follow-up passo ${next.step} para lead ${lead.id} (${lead.guest.name ?? 'sem nome'})`);
      // TODO: enviar via canal de origem do hóspede (ChannelsService/outbound)

      const upcoming = FOLLOW_UP_STEPS[next.step];
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          followUpStep: next.step,
          nextFollowUpAt: upcoming
            ? new Date(Date.now() + (upcoming.afterHours - next.afterHours) * 3600 * 1000)
            : null,
        },
      });
    }
  }

  /** Agenda o primeiro follow-up após o envio de uma cotação */
  async scheduleAfterQuote(leadId: string): Promise<void> {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        stage: LeadStage.QUOTE_SENT,
        followUpStep: 0,
        nextFollowUpAt: new Date(Date.now() + FOLLOW_UP_STEPS[0].afterHours * 3600 * 1000),
      },
    });
  }

  /** Cancela follow-ups (reserva confirmada ou hóspede respondeu) */
  async cancel(leadId: string): Promise<void> {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { nextFollowUpAt: null, followUpStep: 0 },
    });
  }
}
