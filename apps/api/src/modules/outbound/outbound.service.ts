import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';

const GRAPH_VERSION = 'v21.0';

/**
 * Entrega de mensagens ao hóspede pelo canal de origem.
 * - WhatsApp: Cloud API (Graph)
 * - Instagram / Facebook Messenger: Graph Send API (mesmo token de página)
 * - Telegram: Bot API
 * Cada canal degrada graciosamente: sem credenciais, apenas registra e segue.
 */
@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);

  async send(channel: Channel, recipientExternalId: string, text: string): Promise<boolean> {
    switch (channel) {
      case Channel.WHATSAPP:
        return this.sendWhatsApp(recipientExternalId, text);
      case Channel.INSTAGRAM:
      case Channel.FACEBOOK:
        return this.sendMessenger(channel, recipientExternalId, text);
      case Channel.TELEGRAM:
        return this.sendTelegram(recipientExternalId, text);
      default:
        // WEBCHAT/EMAIL/GOOGLE_BUSINESS: entrega tratada em outro fluxo (WebSocket/SMTP)
        this.logger.warn(`Entrega para canal ${channel} ainda não implementada — mensagem registrada apenas no banco`);
        return false;
    }
  }

  private async sendWhatsApp(to: string, text: string): Promise<boolean> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      this.logger.warn('WhatsApp não configurado (WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID) — envio ignorado');
      return false;
    }
    return this.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      { Authorization: `Bearer ${token}` },
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      'WhatsApp',
    );
  }

  /**
   * Instagram Direct e Facebook Messenger usam a mesma Send API da Meta,
   * autenticada pelo token da Página vinculada. O destinatário é o PSID/IGSID
   * do remetente (capturado no webhook).
   */
  private async sendMessenger(channel: Channel, recipientId: string, text: string): Promise<boolean> {
    const token =
      channel === Channel.INSTAGRAM
        ? process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN
        : process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    const pageId = process.env.FACEBOOK_PAGE_ID;
    if (!token) {
      this.logger.warn(`${channel} não configurado (FACEBOOK_PAGE_ACCESS_TOKEN) — envio ignorado`);
      return false;
    }
    // Quando o pageId é conhecido usamos /{pageId}/messages; senão, /me/messages
    const target = pageId ? pageId : 'me';
    return this.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${target}/messages?access_token=${encodeURIComponent(token)}`,
      {},
      { recipient: { id: recipientId }, message: { text }, messaging_type: 'RESPONSE' },
      channel,
    );
  }

  private async sendTelegram(chatId: string, text: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn('Telegram não configurado (TELEGRAM_BOT_TOKEN) — envio ignorado');
      return false;
    }
    return this.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {},
      { chat_id: chatId, text },
      'Telegram',
    );
  }

  /** POST JSON com tratamento uniforme de erro */
  private async post(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<boolean> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.logger.error(`Falha no envio ${label} (${res.status}): ${await res.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(`Erro de rede no envio ${label}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
