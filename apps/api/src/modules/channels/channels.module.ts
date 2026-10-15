import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { WhatsAppOnboardingService } from './whatsapp-onboarding.service';
import { BellaModule } from '../bella/bella.module';

@Module({
  imports: [BellaModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, WhatsAppOnboardingService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
