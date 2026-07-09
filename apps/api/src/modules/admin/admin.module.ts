import { Controller, Delete, Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Operações administrativas (protegidas pelo JWT global).
 * Limpa os dados transacionais mantendo a configuração do hotel.
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Zera dados de atendimento (conversas, mensagens, leads, reservas,
   * auditoria e hóspedes), PRESERVANDO hotel, usuários, políticas,
   * conhecimento e configurações da Bella. Uso: limpar dados de teste
   * antes de abrir para hóspedes reais.
   */
  @Delete('cleanup-test-data')
  async cleanup() {
    const audits = await this.prisma.aiAudit.deleteMany({});
    const messages = await this.prisma.message.deleteMany({});
    const conversations = await this.prisma.conversation.deleteMany({});
    const leads = await this.prisma.lead.deleteMany({});
    const reservations = await this.prisma.reservation.deleteMany({});
    const guests = await this.prisma.guest.deleteMany({});
    return {
      status: 'ok',
      removed: {
        auditoria: audits.count,
        mensagens: messages.count,
        conversas: conversations.count,
        leads: leads.count,
        reservas: reservations.count,
        hospedes: guests.count,
      },
      preservado: 'hotel, usuários, políticas, conhecimento e configurações',
    };
  }
}

@Module({ controllers: [AdminController] })
export class AdminModule {}
