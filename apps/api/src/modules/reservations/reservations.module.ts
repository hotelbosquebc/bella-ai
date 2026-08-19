import { Module } from '@nestjs/common';
import { ReservationEngineService } from './reservation-engine.service';
import { ReservationsController } from './reservations.controller';
import { SilbeckAvailabilityService } from './silbeck-availability.service';

@Module({
  controllers: [ReservationsController],
  providers: [ReservationEngineService, SilbeckAvailabilityService],
  exports: [ReservationEngineService, SilbeckAvailabilityService],
})
export class ReservationsModule {}
