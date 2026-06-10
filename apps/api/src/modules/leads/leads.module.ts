import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { LeadStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('leads')
export class LeadsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Pipeline Kanban (Tela 05) — leads agrupáveis por etapa */
  @Get()
  list(@Query('stage') stage?: LeadStage) {
    return this.prisma.lead.findMany({
      where: stage ? { stage } : {},
      include: { guest: true, owner: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Post()
  create(@Body() body: { guestId: string; stage?: LeadStage; estimatedValue?: number }) {
    return this.prisma.lead.create({
      data: {
        guestId: body.guestId,
        stage: body.stage ?? LeadStage.NEW_LEAD,
        estimatedValue: body.estimatedValue ?? 0,
      },
    });
  }

  /** Drag and drop no Kanban + edição de probabilidade/valor/motivo de perda */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { stage?: LeadStage; probability?: number; estimatedValue?: number; lostReason?: string; ownerId?: string },
  ) {
    return this.prisma.lead.update({ where: { id }, data: body });
  }
}

@Module({ controllers: [LeadsController] })
export class LeadsModule {}
