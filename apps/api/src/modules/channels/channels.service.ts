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

  /** WhatsApp / Instagram / Facebook compartilham o formato de webhook da Meta */
  async ingestMetaWebhook(channel: Channel, payload: any): Promise<void> {
    const entries = payload?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages ?? [];
        for (const msg of messages) {
          const normalized: NormalizedInboundMessage = {
            // TODO: resolver hotelId pelo phone_number_id / page_id cadastrado
            hotelId: process.env.DEFAULT_HOTEL_ID ?? 'hotel-do-bosque',
            channel,
            senderExternalId: msg.from,
            senderName: change.value?.contacts?.[0]?.profile?.name,
            content: msg.text?.body ?? '',
            contentType: msg.type === 'text' ? 'text' : 'document',
            receivedAt: new Date(Number(msg.timestamp) * 1000),
            raw: payload,
          };
          await this.dispatch(normalized);
        }
      }
    }
  }

  async ingestGenericWebhook(channel: Channel, payload: any): Promise<void> {
    const normalized: NormalizedInboundMessage = {
      hotelId: payload.hotelId ?? process.env.DEFAULT_HOTEL_ID ?? 'hotel-do-bosque',
      channel,
      senderExternalId: payload.from,
      senderName: payload.name,
      content: payload.text ?? payload.content ?? '',
      contentType: 'text',
      receivedAt: new Date(),
      raw: payload,
    };
    await this.dispatch(normalized);
  }

  private async dispatch(message: NormalizedInboundMessage): Promise<void> {
    this.logger.log(`Mensagem recebida via ${message.channel} de ${message.senderExternalId}`);
    try {
      // TODO: publicar em RabbitMQ (inbound.messages) e consumir no orquestrador
      await this.bella.handleInbound(message);
    } catch (err) {
      // Webhook nunca deve falhar para o provedor (a Meta desativa endpoints com erro)
      this.logger.error(`Falha ao processar mensagem de ${message.senderExternalId}`, err instanceof Error ? err.stack : String(err));
    }
  }

  getChannelStatus(channel: Channel) {
    // TODO: verificar credenciais/conexão real do canal
    return { channel, connected: Boolean(process.env.WHATSAPP_ACCESS_TOKEN) };
  }
}
