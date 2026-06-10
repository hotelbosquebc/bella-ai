import { Injectable } from '@nestjs/common';

export enum AuthorizationLevel {
  /** Informações gerais — resposta automática */
  LEVEL_1 = 1,
  /** Orçamentos e cotações — resposta automática com dados reais */
  LEVEL_2 = 2,
  /** Requer aprovação humana */
  LEVEL_3 = 3,
}

export interface GuardrailVerdict {
  level: AuthorizationLevel;
  allowed: boolean;
  requiresHuman: boolean;
  reason?: string;
}

/** Intenções que sempre exigem aprovação humana (Nível 3 — anti-prejuízo) */
const LEVEL_3_INTENTS = new Set([
  'cancellation',
  'refund',
  'chargeback',
  'discount_request',
  'courtesy',
  'contract_change',
]);

/** Padrões que indicam concessão indevida na resposta gerada */
const FORBIDDEN_RESPONSE_PATTERNS: RegExp[] = [
  /cancelamento\s+(está\s+)?(aprovado|confirmado|autorizado)/i,
  /(estorno|reembolso)\s+(está\s+)?(aprovado|confirmado|autorizado|será\s+(feito|processado))/i,
  /desconto\s+(especial\s+)?de\s+\d+\s*%/i,
  /cortesia\s+(confirmada|garantida|liberada)/i,
];

@Injectable()
export class GuardrailsService {
  /**
   * Sistema Anti-Prejuízo: classifica a interação e valida a resposta gerada
   * ANTES do envio. Nível 3 nunca é respondido automaticamente.
   */
  evaluate(params: {
    intent: string;
    draftResponse: string;
    confidence: number;
    hasPolicySource: boolean;
  }): GuardrailVerdict {
    const { intent, draftResponse, confidence, hasPolicySource } = params;

    if (LEVEL_3_INTENTS.has(intent)) {
      return {
        level: AuthorizationLevel.LEVEL_3,
        allowed: false,
        requiresHuman: true,
        reason: `Intenção "${intent}" exige aprovação humana`,
      };
    }

    for (const pattern of FORBIDDEN_RESPONSE_PATTERNS) {
      if (pattern.test(draftResponse)) {
        return {
          level: AuthorizationLevel.LEVEL_3,
          allowed: false,
          requiresHuman: true,
          reason: 'Resposta contém concessão não autorizada (bloqueada pelo anti-prejuízo)',
        };
      }
    }

    // Respostas sobre regras do hotel sem fonte oficial são escaladas
    const mentionsRules = /(pol[ií]tica|regra|cancelamento|reembolso|no-?show)/i.test(draftResponse);
    if (mentionsRules && !hasPolicySource) {
      return {
        level: AuthorizationLevel.LEVEL_2,
        allowed: false,
        requiresHuman: true,
        reason: 'Resposta cita regras sem política oficial como fonte',
      };
    }

    if (confidence < 0.6) {
      return {
        level: AuthorizationLevel.LEVEL_2,
        allowed: false,
        requiresHuman: true,
        reason: `Confiança baixa (${confidence.toFixed(2)})`,
      };
    }

    const level = intent === 'booking' ? AuthorizationLevel.LEVEL_2 : AuthorizationLevel.LEVEL_1;
    return { level, allowed: true, requiresHuman: false };
  }
}
