import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('guests')
export class GuestsController {
  constructor(private readonly prisma: PrismaService) {}

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
