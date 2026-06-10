import { Injectable } from '@nestjs/common';
import { Guest, Message, Reservation } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface GuestMemory {
  /** Curto prazo: últimas mensagens da conversa */
  recentMessages: Message[];
  /** Médio prazo: resumo da conversa (gerado por LLM) */
  conversationSummary: string | null;
  /** Longo prazo: perfil, preferências e histórico de reservas */
  guest: Guest;
  pastReservations: Reservation[];
}

@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async load(guestId: string, conversationId: string): Promise<GuestMemory> {
    const [guest, recentMessages, conversation, pastReservations] = await Promise.all([
      this.prisma.guest.findUniqueOrThrow({ where: { id: guestId } }),
      this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { timestamp: 'desc' },
        take: 20,
      }),
      this.prisma.conversation.findUnique({ where: { id: conversationId } }),
      this.prisma.reservation.findMany({
        where: { guestId },
        orderBy: { checkin: 'desc' },
        take: 5,
      }),
    ]);

    return {
      recentMessages: recentMessages.reverse(),
      conversationSummary: conversation?.summary ?? null,
      guest,
      pastReservations,
    };
  }

  /** Contexto do hóspede para o prompt — ex.: boas-vindas personalizadas */
  buildGuestContext(memory: GuestMemory): string {
    const parts: string[] = [];
    const g = memory.guest;
    if (g.name) parts.push(`Nome: ${g.name}`);
    if (g.city) parts.push(`Cidade: ${g.city}`);
    parts.push(`Idioma preferido: ${g.language}`);

    const last = memory.pastReservations[0];
    if (last) {
      parts.push(
        `Hóspede recorrente. Última hospedagem: ${last.checkin.toISOString().slice(0, 10)} a ${last.checkout
          .toISOString()
          .slice(0, 10)}.`,
      );
    } else {
      parts.push('Primeiro contato deste hóspede.');
    }

    const prefs = g.preferences as Record<string, unknown>;
    if (prefs && Object.keys(prefs).length > 0) {
      parts.push(`Preferências: ${JSON.stringify(prefs)}`);
    }

    if (memory.conversationSummary) {
      parts.push(`Resumo da conversa até aqui: ${memory.conversationSummary}`);
    }

    return parts.join('\n');
  }
}
