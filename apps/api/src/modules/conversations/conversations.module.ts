import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { MessageSender } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Controller()
export class ConversationsController {
  constructor(private readonly prisma: PrismaService) {}

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

  /** Envio manual por atendente humano */
  @Post('messages/send')
  async send(@Body() body: { conversationId: string; content: string; userId?: string }) {
    const message = await this.prisma.message.create({
      data: {
        conversationId: body.conversationId,
        sender: MessageSender.HUMAN_AGENT,
        content: body.content,
      },
    });
    // TODO: entrega real via canal de origem
    return message;
  }
}

@Module({ controllers: [ConversationsController] })
export class ConversationsModule {}
