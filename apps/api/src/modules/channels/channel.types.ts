import { Channel } from '@prisma/client';

/**
 * Toda mensagem recebida de qualquer canal é normalizada para este formato
 * antes de entrar na fila de processamento da Bella.
 */
export interface NormalizedInboundMessage {
  hotelId: string;
  channel: Channel;
  /** Identificador do remetente no canal (telefone, handle do Instagram, e-mail...) */
  senderExternalId: string;
  senderName?: string;
  content: string;
  contentType: 'text' | 'image' | 'audio' | 'document';
  attachments?: string[];
  receivedAt: Date;
  /** Payload bruto do webhook, preservado para auditoria */
  raw: unknown;
}
