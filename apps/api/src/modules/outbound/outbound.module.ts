import { Module } from '@nestjs/common';
import { OutboundService } from './outbound.service';

@Module({
  providers: [OutboundService],
  exports: [OutboundService],
})
export class OutboundModule {}
