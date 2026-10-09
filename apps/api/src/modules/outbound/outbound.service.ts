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

  /**
   * Tipo de midia a partir do mimeType.
   *
   * WhatsApp e Messenger usam nomes diferentes para a mesma coisa, mas a
   * decisao e a mesma, entao fica num lugar so. PDF e "document" no WhatsApp e
   * "file" no Messenger - quem traduz e quem envia.
   */
  static tipoDeMidia(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
    const m = (mimeType || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    return 'document';
  }

  /**
   * Envia um arquivo ao hospede.
   *
   * Por LINK, nao por upload: os anexos ja tem endereco publico
   * (/api/attachments/:id/file), entao a Meta busca o arquivo direto e nos
   * poupamos o upload de cada envio. O nome do arquivo importa - e o que o
   * hospede ve no balao antes de abrir.
   */
  async sendArquivo(
    channel: Channel,
    recipientExternalId: string,
    url: string,
    mimeType: string,
    titulo: string,
  ): Promise<boolean> {
    const tipo = OutboundService.tipoDeMidia(mimeType);
    switch (channel) {
      case Channel.WHATSAPP: {
        const token = process.env.WHATSAPP_ACCESS_TOKEN;
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        if (!token || !phoneNumberId) {
          this.logger.warn('WhatsApp nao configurado — anexo ignorado');
          return false;
        }
        const midia: Record<string, unknown> =
          tipo === 'document' ? { link: url, filename: nomeDeArquivo(titulo, mimeType) } : { link: url };
        return this.post(
          `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
          { Authorization: `Bearer ${token}` },
          { messaging_product: 'whatsapp', to: recipientExternalId, type: tipo, [tipo]: midia },
          'WhatsApp (anexo)',
        );
      }
      case Channel.INSTAGRAM:
      case Channel.FACEBOOK: {
        const token =
          channel === Channel.INSTAGRAM
            ? process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN
            : process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
        if (!token) {
          this.logger.warn(`${channel} nao configurado — anexo ignorado`);
          return false;
        }
        const pageId = process.env.FACEBOOK_PAGE_ID;
        return this.post(
          `https://graph.facebook.com/${GRAPH_VERSION}/${pageId ? pageId : 'me'}/messages?access_token=${encodeURIComponent(token)}`,
          {},
          {
            recipient: { id: recipientExternalId },
            messaging_type: 'RESPONSE',
            message: {
              attachment: {
                // Messenger chama de "file" o que o WhatsApp chama de "document".
                type: tipo === 'document' ? 'file' : tipo,
                payload: { url, is_reusable: true },
              },
            },
          },
          `${channel} (anexo)`,
        );
      }
      case Channel.TELEGRAM: {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
          this.logger.warn('Telegram nao configurado — anexo ignorado');
          return false;
        }
        const metodo = tipo === 'image' ? 'sendPhoto' : tipo === 'video' ? 'sendVideo' : tipo === 'audio' ? 'sendAudio' : 'sendDocument';
        const campo = tipo === 'image' ? 'photo' : tipo === 'video' ? 'video' : tipo === 'audio' ? 'audio' : 'document';
        return this.post(
          `https://api.telegram.org/bot${token}/${metodo}`,
          {},
          { chat_id: recipientExternalId, [campo]: url },
          'Telegram (anexo)',
        );
      }
      default:
        this.logger.warn(`Anexo para canal ${channel} ainda nao implementado`);
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


/** Nome que o hospede ve no balao do anexo. */
export function nomeDeArquivo(titulo: string, mimeType: string): string {
  // Caracteres que o Windows e o WhatsApp recusam em nome de arquivo.
  const base = (titulo || 'arquivo').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60) || 'arquivo';
  const ext = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' }[(mimeType || '').toLowerCase()] || '';
  return base.toLowerCase().endsWith(ext) ? base : base + ext;
}