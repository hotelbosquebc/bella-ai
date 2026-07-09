import { Controller, Get, Module } from '@nestjs/common';
import { LeadStage, MessageSender, ReservationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  /** KPIs do Dashboard Executivo (Tela 02) */
  @Get('kpis')
  async kpis() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [messagesToday, bellaMessages, humanMessages, confirmedReservations, revenue, activeLeads, quotes] =
      await Promise.all([
        this.prisma.message.count({ where: { timestamp: { gte: startOfDay }, sender: MessageSender.GUEST } }),
        this.prisma.message.count({ where: { sender: MessageSender.BELLA } }),
        this.prisma.message.count({ where: { sender: MessageSender.HUMAN_AGENT } }),
        this.prisma.reservation.count({ where: { status: ReservationStatus.CONFIRMED } }),
        this.prisma.reservation.aggregate({
          where: { status: ReservationStatus.CONFIRMED },
          _sum: { total: true },
        }),
        this.prisma.lead.count({
          where: { stage: { notIn: [LeadStage.POST_STAY, LeadStage.RECURRING_CUSTOMER] } },
        }),
        this.prisma.lead.count({ where: { stage: LeadStage.QUOTE_SENT } }),
      ]);

    const totalLeads = activeLeads + confirmedReservations;
    return {
      messagesToday,
      reservationsGenerated: confirmedReservations,
      revenue: revenue._sum.total ?? 0,
      conversionRate: totalLeads > 0 ? Math.round((confirmedReservations / totalLeads) * 100) : 0,
      bellaVsHumans: { bella: bellaMessages, humans: humanMessages },
      activeLeads,
      quotesSent: quotes,
    };
  }

  /** Inteligência comercial: motivos de perda agrupados */
  @Get('loss-reasons')
  async lossReasons() {
    return this.prisma.lead.groupBy({
      by: ['lostReason'],
      where: { lostReason: { not: null } },
      _count: true,
    });
  }

  /** Visão de Analytics: canais, funil, desempenho da IA e motivos de perda */
  @Get('overview')
  async overview() {
    const [byChannel, funnel, audits, escalated, lossReasons] = await Promise.all([
      this.prisma.conversation.groupBy({ by: ['channel'], _count: true }),
      this.prisma.lead.groupBy({ by: ['stage'], _count: true }),
      this.prisma.aiAudit.aggregate({ _avg: { confidence: true }, _count: true }),
      this.prisma.aiAudit.count({ where: { escalated: true } }),
      this.prisma.lead.groupBy({ by: ['lostReason'], where: { lostReason: { not: null } }, _count: true }),
    ]);

    const totalAudits = audits._count || 0;
    return {
      channels: byChannel.map((c) => ({ channel: c.channel, conversations: c._count })),
      funnel: funnel.map((f) => ({ stage: f.stage, count: f._count })),
      ai: {
        interactions: totalAudits,
        avgConfidence: audits._avg.confidence != null ? Math.round(audits._avg.confidence * 100) : null,
        escalated,
        autoResolvedRate: totalAudits > 0 ? Math.round(((totalAudits - escalated) / totalAudits) * 100) : null,
      },
      lossReasons: lossReasons.map((l) => ({ reason: l.lostReason, count: l._count })),
    };
  }
}

@Module({ controllers: [AnalyticsController] })
export class AnalyticsModule {}
