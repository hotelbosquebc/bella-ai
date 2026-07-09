import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { MessageSender } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboundModule } from '../outbound/outbound.module';
import { OutboundService } from '../outbound/outbound.service';

@Controller()
export class ConversationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbound: OutboundService,
  ) {}

  /** Caixa de entrada unificada — todos os canais, com filtro opcional */
  @Get('conversations')
  list(@Query('channel') channel?: string, @Query('status') status?: string) {
    return this.prisma.conversation.findMany({
      where: {
        ...(channel ? { channel: channel as any } : {}),
        ...(status ? { status: status as any } : {}),
      },
      include: {
        guest: true,
        messages: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  @Get('conversations/:id')
  detail(@Param('id') id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: {
        guest: { include: { reservations: true, leads: true } },
        messages: { orderBy: { timestamp: 'asc' } },
      },
    });
  }

  /**
   * Envio manual por atendente humano: grava a mensagem, ENTREGA ao hóspede
   * pelo canal de origem e assume a conversa (sai do controle da Bella).
   */
  @Post('messages/send')
  async send(@Body() body: { conversationId: string; content: string; userId?: string }) {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: body.conversationId },
      include: { guest: true },
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: body.conversationId,
        sender: MessageSender.HUMAN_AGENT,
        content: body.content,
      },
    });

    // Entrega real pelo canal (WhatsApp/Instagram/Facebook/Telegram)
    let delivered = false;
    if (conversation.guest.phone) {
      delivered = await this.outbound.send(conversation.channel, conversation.guest.phone, body.content);
    }

    // Atendente assumiu → conversa fica sob controle humano
    await this.prisma.conversation.update({
      where: { id: body.conversationId },
      data: { status: 'PENDING_HUMAN', assignedUserId: body.userId ?? undefined },
    });

    return { ...message, delivered };
  }
}

@Module({
  imports: [OutboundModule],
  controllers: [ConversationsController],
})
export class ConversationsModule {}
