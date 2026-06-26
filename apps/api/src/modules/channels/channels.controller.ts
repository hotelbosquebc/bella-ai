import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { ChannelsService } from './channels.service';

/**
 * Webhooks de entrada de cada canal. Cada handler normaliza o payload
 * específico do provedor e entrega ao ChannelsService.
 */
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  /** Verificação de webhook exigida pela Meta (WhatsApp/Instagram/Facebook) */
  @Get('whatsapp/webhook')
  verifyWhatsApp(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      return challenge;
    }
    return 'forbidden';
  }

  @Post('whatsapp/webhook')
  async whatsapp(@Body() payload: any) {
    await this.channels.ingestMetaWebhook(Channel.WHATSAPP, payload);
    return { status: 'ok' };
  }

  @Get('whatsapp/status')
  whatsappStatus() {
    return this.channels.getChannelStatus(Channel.WHATSAPP);
  }

  /** Verificação de webhook da Meta (Instagram) */
  @Get('instagram/webhook')
  verifyInstagram(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.verifyMeta(mode, token, challenge);
  }

  @Post('instagram/webhook')
  async instagram(@Body() payload: any) {
    await this.channels.ingestMetaWebhook(Channel.INSTAGRAM, payload);
    return { status: 'ok' };
  }

  /** Verificação de webhook da Meta (Facebook Messenger) */
  @Get('facebook/webhook')
  verifyFacebook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.verifyMeta(mode, token, challenge);
  }

  @Post('facebook/webhook')
  async facebook(@Body() payload: any) {
    await this.channels.ingestMetaWebhook(Channel.FACEBOOK, payload);
    return { status: 'ok' };
  }

  @Post('tiktok/webhook')
  async tiktok(@Body() payload: any) {
    await this.channels.ingestGenericWebhook(Channel.TIKTOK, payload);
    return { status: 'ok' };
  }

  /** Telegram entrega updates via POST; não há verificação GET (usa setWebhook). */
  @Post('telegram/webhook')
  async telegram(@Body() payload: any) {
    await this.channels.ingestTelegramWebhook(payload);
    return { status: 'ok' };
  }

  @Get('telegram/status')
  telegramStatus() {
    return this.channels.getChannelStatus(Channel.TELEGRAM);
  }

  private verifyMeta(mode: string, token: string, challenge: string) {
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      return challenge;
    }
    return 'forbidden';
  }

  @Post('email/webhook')
  async email(@Body() payload: any) {
    await this.channels.ingestGenericWebhook(Channel.EMAIL, payload);
    return { status: 'ok' };
  }

  @Post('webchat/webhook')
  async webchat(@Body() payload: any) {
    await this.channels.ingestGenericWebhook(Channel.WEBCHAT, payload);
    return { status: 'ok' };
  }
}
