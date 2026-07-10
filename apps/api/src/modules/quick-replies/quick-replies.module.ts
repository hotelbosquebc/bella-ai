import { Body, Controller, Delete, Get, Module, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Respostas rápidas (atalhos "/") usadas pelos atendentes na Caixa de Entrada. */
@Controller('quick-replies')
export class QuickRepliesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query('hotelId') hotelId: string) {
    return this.prisma.quickReply.findMany({
      where: { hotelId },
      orderBy: { shortcut: 'asc' },
    });
  }

  @Post()
  create(@Body() body: { hotelId: string; shortcut: string; title: string; content: string }) {
    return this.prisma.quickReply.create({
      data: {
        hotelId: body.hotelId,
        shortcut: (body.shortcut || '').replace(/^\/+/, '').trim(),
        title: body.title,
        content: body.content,
      },
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.quickReply.delete({ where: { id } });
  }
}

@Module({ controllers: [QuickRepliesController] })
export class QuickRepliesModule {}
