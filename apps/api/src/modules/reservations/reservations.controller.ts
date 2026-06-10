import { Body, Controller, Post } from '@nestjs/common';
import { ReservationEngineService, StayDetails } from './reservation-engine.service';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('reservation')
export class ReservationsController {
  constructor(
    private readonly engine: ReservationEngineService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('availability')
  async availability(@Body() stay: StayDetails) {
    // TODO: consulta real ao PMS
    return { available: true, stay };
  }

  @Post('link')
  link(@Body() stay: StayDetails) {
    return { link: this.engine.buildBookingLink(stay) };
  }

  @Post('create')
  async create(@Body() body: StayDetails & { guestId: string }) {
    return this.prisma.reservation.create({
      data: {
        guestId: body.guestId,
        checkin: new Date(body.checkin!),
        checkout: new Date(body.checkout!),
        adults: body.adults ?? 1,
        children0_6: body.children0_6 ?? 0,
        children7_9: body.children7_9 ?? 0,
      },
    });
  }

  @Post('search')
  async search(@Body() body: { guestId?: string }) {
    return this.prisma.reservation.findMany({
      where: body.guestId ? { guestId: body.guestId } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
