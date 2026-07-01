import { Body, Controller, Get, Module, Param, Patch, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Central da Bella (Tela 06): identidade, personalidade, temperatura e prompts. */
@Controller('settings')
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  get(@Query('hotelId') hotelId: string) {
    return this.prisma.aiSettings.upsert({
      where: { hotelId },
      update: {},
      create: { hotelId },
    });
  }

  @Patch(':hotelId')
  update(@Param('hotelId') hotelId: string, @Body() body: Record<string, unknown>) {
    const allowed = [
      'assistantName',
      'personality',
      'language',
      'temperature',
      'masterPrompt',
      'salesPrompt',
      'opsPrompt',
      'bookingPrompt',
      'cancelPrompt',
      'modelSales',
      'modelPolicies',
      'modelBooking',
    ];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) data[key] = key === 'temperature' ? Number(body[key]) : body[key];
    }
    return this.prisma.aiSettings.upsert({
      where: { hotelId },
      update: data,
      create: { hotelId, ...data },
    });
  }
}

@Module({ controllers: [SettingsController] })
export class SettingsModule {}
