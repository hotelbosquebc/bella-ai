import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { NormalizedInboundMessage } from './channel.types';
import { BellaOrchestratorService } from '../bella/bella-orchestrator.service';
import { ModelRouterService } from '../bella/model-router.service';

const GRAPH_VERSION = 'v21.0';

/**
 * Normaliza payloads dos provedores e encaminha para o orquestrador da Bella.
 * Notas de voz (áudio) são baixadas do canal e transcritas pelo Gemini antes
 * de seguir o mesmo fluxo de uma mensagem de texto.
 */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly bella: BellaOrchestratorService,
    private readonly ai: ModelRouterService,
  ) {}

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
          // Nota de voz do WhatsApp → transcreve; texto → usa direto
          const isAudio = msg.type === 'audio' || msg.type === 'voice';
          const content = isAudio
            ? await this.transcribeWhatsappAudio(msg.audio?.id ?? msg.voice?.id, msg.audio?.mime_type)
            : msg.text?.body ?? '';
          await this.dispatch({
            hotelId: this.hotelId,
            channel,
            senderExternalId: msg.from,
            senderName: contacts[0]?.profile?.name,
            content,
            contentType: isAudio ? 'audio' : msg.type === 'text' ? 'text' : 'document',
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

    // Nota de voz / áudio do Telegram → transcreve
    const voice = msg.voice ?? msg.audio;
    let content = msg.text ?? msg.caption ?? '';
    let contentType: NormalizedInboundMessage['contentType'] = msg.text ? 'text' : 'document';
    if (voice?.file_id) {
      content = await this.transcribeTelegramAudio(voice.file_id, voice.mime_type ?? 'audio/ogg');
      contentType = 'audio';
    }

    await this.dispatch({
      hotelId: this.hotelId,
      channel: Channel.TELEGRAM,
      senderExternalId: String(msg.chat.id),
      senderName: name,
      content,
      contentType,
      receivedAt: msg.date ? new Date(Number(msg.date) * 1000) : new Date(),
      raw: payload,
    });
  }

  /** Baixa a nota de voz do WhatsApp (Graph media API) e transcreve. */
  private async transcribeWhatsappAudio(mediaId?: string, mimeType = 'audio/ogg'): Promise<string> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!mediaId || !token) return '';
    try {
      // 1) resolve a URL temporária da mídia
      const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meta: any = await metaRes.json();
      if (!meta?.url) return '';
      // 2) baixa os bytes (também exige o token) e transcreve
      const base64 = await this.fetchAsBase64(meta.url, { Authorization: `Bearer ${token}` });
      const text = await this.ai.transcribeAudio(base64, meta.mime_type ?? mimeType);
      this.logger.log(`Áudio WhatsApp transcrito (${text.length} caracteres)`);
      return text;
    } catch (err) {
      this.logger.error(`Falha ao transcrever áudio do WhatsApp: ${err instanceof Error ? err.message : err}`);
      return '';
    }
  }

  /** Baixa a nota de voz do Telegram (getFile) e transcreve. */
  private async transcribeTelegramAudio(fileId: string, mimeType = 'audio/ogg'): Promise<string> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return '';
    try {
      const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
      const info: any = await infoRes.json();
      const path = info?.result?.file_path;
      if (!path) return '';
      const base64 = await this.fetchAsBase64(`https://api.telegram.org/file/bot${token}/${path}`);
      const text = await this.ai.transcribeAudio(base64, mimeType);
      this.logger.log(`Áudio Telegram transcrito (${text.length} caracteres)`);
      return text;
    } catch (err) {
      this.logger.error(`Falha ao transcrever áudio do Telegram: ${err instanceof Error ? err.message : err}`);
      return '';
    }
  }

  /** Baixa um arquivo e devolve em base64 (para enviar ao Gemini). */
  private async fetchAsBase64(url: string, headers: Record<string, string> = {}): Promise<string> {
    const res = await fetch(url, { headers });
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
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
