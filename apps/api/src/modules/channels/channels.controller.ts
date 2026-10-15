import { Body, Controller, ForbiddenException, Get, Logger, Post, Query, UseGuards } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { ChannelsService } from './channels.service';
import { Public } from '../auth/public.decorator';
import { Privado } from '../auth/privado.decorator';
import { MetaWebhookGuard } from './meta-webhook.guard';
import { WhatsAppOnboardingService } from './whatsapp-onboarding.service';

/**
 * Webhooks de entrada de cada canal. Cada handler normaliza o payload
 * específico do provedor e entrega ao ChannelsService.
 */
/** Webhooks são públicos por natureza (Meta/Telegram chamam sem nosso JWT). */
@Public()
@Controller('channels')
export class ChannelsController {
  private readonly logger = new Logger(ChannelsController.name);

  constructor(
    private readonly channels: ChannelsService,
    private readonly onboarding: WhatsAppOnboardingService,
  ) {}

  /**
   * Verificacao do webhook, igual para os tres canais da Meta.
   *
   * Dois detalhes que custaram tempo em 15/10/2026:
   *
   * - respondia 200 com o texto "forbidden". A Meta trata 200 como sucesso,
   *   entao a falha aparecia so depois, como webhook que nunca entrega nada.
   *   Agora e 403 de verdade.
   * - o valor colado no painel costuma vir com espaco no fim (o copiar e colar
   *   leva junto). Comparar sem aparar fazia o token certo parecer errado.
   */
  private responderVerificacao(mode: string, token: string, challenge: string, canal: string): string {
    const esperado = String(process.env.META_WEBHOOK_VERIFY_TOKEN || '').trim();
    const recebido = String(token || '').trim();
    if (mode === 'subscribe' && esperado && recebido === esperado) return challenge;
    // Sem o texto dos tokens no log: e segredo combinado entre nos e a Meta.
    this.logger.warn(
      `Verificacao de webhook ${canal} recusada` +
        (esperado ? ' (token diferente do configurado)' : ' (META_WEBHOOK_VERIFY_TOKEN nao configurado)'),
    );
    throw new ForbiddenException('token de verificacao invalido');
  }


  /** Verificação de webhook exigida pela Meta (WhatsApp/Instagram/Facebook) */
  @Get('whatsapp/webhook')
  verifyWhatsApp(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.responderVerificacao(mode, token, challenge, 'whatsapp');
  }

  @UseGuards(MetaWebhookGuard)
  @Post('whatsapp/webhook')
  async whatsapp(@Body() payload: any) {
    await this.channels.ingestMetaWebhook(Channel.WHATSAPP, payload);
    return { status: 'ok' };
  }

  /**
   * O percurso das ultimas mensagens dos canais, sem o texto delas.
   *
   * Publico pelo mesmo motivo dos outros diagnosticos: quando o hospede
   * escreve na Pagina e nada acontece, precisamos saber ONDE parou sem
   * depender de login nem do log do Render, que hiberna.
   */
  @Get('diagnostico')
  diagnosticoCanais() {
    return { percurso: this.channels.percurso.slice(-30) };
  }

  /**
   * Conclusao do Cadastro Incorporado (coexistencia).
   *
   * Recebe do painel o codigo de uso unico que a Meta devolveu e o troca por
   * token - operacao que exige a chave secreta do app e por isso nao pode
   * acontecer no navegador.
   */
  @Privado()
  @Post('whatsapp/onboarding')
  async whatsappOnboarding(@Body() body: { code: string; wabaId?: string; phoneNumberId?: string }) {
    return this.onboarding.concluir(body);
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
    return this.verifyMeta(mode, token, challenge, 'instagram');
  }

  @UseGuards(MetaWebhookGuard)
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
    return this.verifyMeta(mode, token, challenge, 'facebook');
  }

  @UseGuards(MetaWebhookGuard)
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

  private verifyMeta(mode: string, token: string, challenge: string, canal: string) {
    return this.responderVerificacao(mode, token, challenge, canal);
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
