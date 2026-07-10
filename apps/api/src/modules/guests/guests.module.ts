import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type ContactInput = { name?: string; phone?: string; email?: string; city?: string; language?: string };

@Controller('guests')
export class GuestsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Cadastra um contato manualmente (agenda do painel). */
  @Post()
  create(@Body() body: ContactInput & { hotelId: string }) {
    return this.prisma.guest.create({
      data: {
        hotelId: body.hotelId,
        name: body.name,
        phone: body.phone || null,
        email: body.email,
        city: body.city,
        language: body.language ?? 'pt',
      },
    });
  }

  /** Edita os dados de um contato. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: ContactInput) {
    const data: ContactInput = {};
    for (const k of ['name', 'phone', 'email', 'city', 'language'] as const) {
      if (k in body) data[k] = body[k];
    }
    return this.prisma.guest.update({ where: { id }, data });
  }

  @Get()
  list(@Query('hotelId') hotelId: string, @Query('q') q?: string) {
    return this.prisma.guest.findMany({
      where: {
        hotelId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Perfil 360º do hóspede (Tela 04) */
  @Get(':id')
  profile(@Param('id') id: string) {
    return this.prisma.guest.findUnique({
      where: { id },
      include: {
        reservations: { orderBy: { checkin: 'desc' } },
        leads: true,
        conversations: { orderBy: { updatedAt: 'desc' }, take: 10 },
      },
    });
  }
}

@Module({ controllers: [GuestsController] })
export class GuestsModule {}
