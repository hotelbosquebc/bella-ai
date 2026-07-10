import { Injectable, Logger } from '@nestjs/common';
import { Guest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface StayDetails {
  checkin?: string | null;
  checkout?: string | null;
  adults?: number | null;
  children0_6?: number | null;
  children7_9?: number | null;
}

export interface BookingResult {
  /** Texto injetado no prompt da Bella com dados reais (nunca inventados) */
  contextForPrompt: string;
  quoteSent: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  checkin: 'data de entrada',
  checkout: 'data de saída',
  adults: 'quantidade de adultos',
};

/**
 * Motor de Reservas Inteligente.
 * Regras de ocupação: 0-6 e 7-9 anos seguem política infantil; 10+ é adulto
 * (a classificação por idade é feita na extração via LLM — STAY_EXTRACTION_TOOL).
 * Se faltarem dados, informa à Bella APENAS os campos faltantes a solicitar.
 */
@Injectable()
export class ReservationEngineService {
  private readonly logger = new Logger(ReservationEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  async process(guest: Guest, stay: StayDetails): Promise<BookingResult> {
    const missing = this.missingFields(stay);
    if (missing.length > 0) {
      return {
        quoteSent: false,
        contextForPrompt:
          `Dados de reserva incompletos. Solicite ao hóspede APENAS: ${missing.join(', ')}. ` +
          `Não pergunte o que ele já informou. Lembre-se: crianças a partir de 10 anos contam como adultos.`,
      };
    }

    // 1-3. Disponibilidade, regras tarifárias e ocupação
    const availability = await this.checkAvailability(guest.hotelId, stay);
    if (!availability.available) {
      return {
        quoteSent: false,
        contextForPrompt:
          `Não há disponibilidade para ${stay.checkin} a ${stay.checkout}. ` +
          `Ofereça gentilmente verificar datas alternativas. Não invente alternativas de tarifas.`,
      };
    }

    // 4. Gerar link do motor de reservas
    const link = this.buildBookingLink(stay);

    // Registrar reserva pendente + persistir no histórico do hóspede
    await this.prisma.reservation.create({
      data: {
        guestId: guest.id,
        checkin: new Date(stay.checkin!),
        checkout: new Date(stay.checkout!),
        adults: stay.adults!,
        children0_6: stay.children0_6 ?? 0,
        children7_9: stay.children7_9 ?? 0,
        bookingLink: link,
        status: 'PENDING',
      },
    });

    this.logger.log(`Link de reserva gerado para hóspede ${guest.id}: ${link}`);

    // 5. A Bella envia o link — sem intervenção humana
    return {
      quoteSent: true,
      contextForPrompt:
        `Há DISPONIBILIDADE para ${stay.checkin} a ${stay.checkout} ` +
        `(${stay.adults} adulto(s), ${stay.children0_6 ?? 0} criança(s) 0-6, ${stay.children7_9 ?? 0} criança(s) 7-9).\n` +
        (availability.rateInfo ? `Tarifa: ${availability.rateInfo}\n` : '') +
        `IMPORTANTE: a reserva NÃO está confirmada. Apresente isto como uma COTAÇÃO. ` +
        `A reserva só se concretiza quando o hóspede finalizar e pagar pelo link. ` +
        `NÃO diga que a reserva "está confirmada"; convide-o a finalizar pelo link.\n` +
        `LINK OFICIAL DE RESERVA (envie exatamente este link): ${link}`,
    };
  }

  private missingFields(stay: StayDetails): string[] {
    const missing: string[] = [];
    if (!stay.checkin) missing.push(FIELD_LABELS.checkin);
    if (!stay.checkout) missing.push(FIELD_LABELS.checkout);
    if (stay.adults == null) missing.push(FIELD_LABELS.adults);
    return missing;
  }

  /** TODO: integrar com o PMS/channel manager real do hotel */
  private async checkAvailability(
    hotelId: string,
    stay: StayDetails,
  ): Promise<{ available: boolean; rateInfo?: string }> {
    this.logger.debug(`Consultando disponibilidade do hotel ${hotelId} para ${stay.checkin}-${stay.checkout}`);
    return { available: true };
  }

  /**
   * Gera o link do motor de reservas oficial do hotel (sistema Silbeck),
   * no MESMO formato que a equipe usa no WhatsApp — página de busca que já
   * leva o hóspede aos resultados:
   *   /pt-br/reserva/busca/?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&adultos-000001=N
   * Categorias: 000001 = Adultos | 000003 = Crianças 0-6 | 000004 = Crianças 7-9.
   * As datas já vêm em ISO (YYYY-MM-DD) da extração — é o formato desta rota.
   */
  buildBookingLink(stay: StayDetails): string {
    const base = process.env.BOOKING_ENGINE_BASE_URL ?? 'https://sbreserva.silbeck.com.br/hotelbosque';
    const path = process.env.BOOKING_ENGINE_PATH ?? '/pt-br/reserva/busca/';
    const params = new URLSearchParams({
      checkin: stay.checkin!,
      checkout: stay.checkout!,
      'adultos-000001': String(stay.adults ?? 0),
      'criancas-000003': String(stay.children0_6 ?? 0),
      'criancas-000004': String(stay.children7_9 ?? 0),
    });
    return `${base}${path}?${params.toString()}`;
  }
}
