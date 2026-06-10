import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';

/**
 * Entrega de mensagens ao hóspede pelo canal de origem.
 * WhatsApp implementado via Cloud API (Graph). Demais canais: TODO.
 */
@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);

  async send(channel: Channel, recipientExternalId: string, text: string): Promise<boolean> {
    switch (channel) {
      case Channel.WHATSAPP:
        return this.sendWhatsApp(recipientExternalId, text);
      default:
        // TODO: Instagram/Facebook (Graph), Telegram (Bot API), e-mail (SMTP), webchat (WebSocket)
        this.logger.warn(`Entrega para canal ${channel} ainda não implementada — mensagem registrada apenas no banco`);
        return false;
    }
  }

  private async sendWhatsApp(to: string, text: string): Promise<boolean> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      this.logger.warn('WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID não configurados — envio ignorado');
      return false;
    }

    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!res.ok) {
      this.logger.error(`Falha no envio WhatsApp (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  }
}
