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
}

@Module({ controllers: [AnalyticsController] })
export class AnalyticsModule {}
