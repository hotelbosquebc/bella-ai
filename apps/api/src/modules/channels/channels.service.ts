import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { NormalizedInboundMessage } from './channel.types';
import { BellaOrchestratorService } from '../bella/bella-orchestrator.service';

/**
 * Normaliza payloads dos provedores e encaminha para o orquestrador da Bella.
 * Em produção a entrega é feita via fila RabbitMQ (inbound.messages) para
 * absorver picos; a chamada direta abaixo é o caminho de desenvolvimento.
 */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(private readonly bella: BellaOrchestratorService) {}

  private get hotelId() {
    return process.env.DEFAULT_HOTEL_ID ?? 'hotel-do-bosque';
  }

  /**
   * Webhook da Meta. Trata os DOIS formatos:
   *  - WhatsApp: entry[].changes[].value.messages[]  (remetente em msg.from)
   *  - Messenger/Instagram: entry[].messaging[]       (remetente em sender.id)
   */
  async ingestMetaWebhook(channel: Channel, payload: any): Promise<void> {
    for (const entry of payload?.entry ?? []) {
      // Formato WhatsApp (changes/value/messages)
      for (const change of entry.changes ?? []) {
        const contacts = change.value?.contacts ?? [];
        for (const msg of change.value?.messages ?? []) {
          await this.dispatch({
            hotelId: this.hotelId,
            channel,
            senderExternalId: msg.from,
            senderName: contacts[0]?.profile?.name,
            content: msg.text?.body ?? '',
            contentType: msg.type === 'text' ? 'text' : 'document',
            receivedAt: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date(),
            raw: payload,
          });
        }
      }

      // Formato Messenger / Instagram Direct (messaging)
      for (const event of entry.messaging ?? []) {
        if (!event.message || event.message.is_echo) continue; // ignora ecos do próprio bot
        await this.dispatch({
          hotelId: this.hotelId,
          channel,
          senderExternalId: event.sender?.id,
          content: event.message?.text ?? '',
          contentType: event.message?.attachments?.length ? 'document' : 'text',
          receivedAt: event.timestamp ? new Date(Number(event.timestamp)) : new Date(),
          raw: payload,
        });
      }
    }
  }

  /**
   * Webhook do Telegram (Bot API). O chat.id é usado como identificador do
   * remetente e como destino das respostas (sendMessage chat_id).
   */
  async ingestTelegramWebhook(payload: any): Promise<void> {
    const msg = payload?.message ?? payload?.edited_message;
    if (!msg?.chat?.id) return;
    const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username;
    await this.dispatch({
      hotelId: this.hotelId,
      channel: Channel.TELEGRAM,
      senderExternalId: String(msg.chat.id),
      senderName: name,
      content: msg.text ?? msg.caption ?? '',
      contentType: msg.text ? 'text' : 'document',
      receivedAt: msg.date ? new Date(Number(msg.date) * 1000) : new Date(),
      raw: payload,
    });
  }

  /** Canais genéricos (chat do site, e-mail, testes): { from, name, text } */
  async ingestGenericWebhook(channel: Channel, payload: any): Promise<void> {
    await this.dispatch({
      hotelId: payload.hotelId ?? this.hotelId,
      channel,
      senderExternalId: payload.from,
      senderName: payload.name,
      content: payload.text ?? payload.content ?? '',
      contentType: 'text',
      receivedAt: new Date(),
      raw: payload,
    });
  }

  private async dispatch(message: NormalizedInboundMessage): Promise<void> {
    if (!message.senderExternalId || !message.content) {
      this.logger.debug(`Evento ${message.channel} ignorado (sem remetente ou conteúdo)`);
      return;
    }
    this.logger.log(`Mensagem recebida via ${message.channel} de ${message.senderExternalId}`);
    try {
      // TODO: publicar em RabbitMQ (inbound.messages) e consumir no orquestrador
      await this.bella.handleInbound(message);
    } catch (err) {
      // Webhook nunca deve falhar para o provedor (a Meta/Telegram desativam endpoints com erro)
      this.logger.error(`Falha ao processar mensagem de ${message.senderExternalId}`, err instanceof Error ? err.stack : String(err));
    }
  }

  getChannelStatus(channel: Channel) {
    const configured: Record<string, boolean> = {
      WHATSAPP: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      INSTAGRAM: Boolean(process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN),
      FACEBOOK: Boolean(process.env.FACEBOOK_PAGE_ACCESS_TOKEN),
      TELEGRAM: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    };
    return { channel, connected: configured[channel] ?? false };
  }
}
