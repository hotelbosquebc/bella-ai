import { Module } from '@nestjs/common';
import { ReservationEngineService } from './reservation-engine.service';
import { ReservationsController } from './reservations.controller';

@Module({
  controllers: [ReservationsController],
  providers: [ReservationEngineService],
  exports: [ReservationEngineService],
})
export class ReservationsModule {}
