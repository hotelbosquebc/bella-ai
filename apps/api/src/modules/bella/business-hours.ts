/**
 * Horário do setor de reservas do hotel, em um lugar só.
 *
 * Estava privado dentro do orquestrador (canal oficial da Meta) e por isso o
 * co-piloto do WhatsApp Web não o enxergava — a Bella prometia "transferir
 * agora mesmo" às 22h de domingo. Compartilhado para que todos os caminhos
 * respondam a mesma coisa.
 */

/** Janelas de atendimento (Brasília): seg-sex, 9h-12h e 14h30-17h30. */
export const HORARIO_RESERVAS_TEXTO = 'de segunda a sexta, das 9h às 12h e das 14h30 às 17h30';

/** Recepção do hotel — atende 24h, inclusive quando reservas está fechado. */
export const TELEFONE_RECEPCAO = '(47) 3367-0211';

/**
 * O setor de reservas está atendendo agora?
 * Usa o fuso America/Sao_Paulo independente do fuso do servidor (o Render roda em UTC).
 */
export function isWithinBusinessHours(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday)) return false;
  const m = hour * 60 + minute;
  const manha = m >= 9 * 60 && m < 12 * 60; // 09:00–12:00
  const tarde = m >= 14 * 60 + 30 && m < 17 * 60 + 30; // 14:30–17:30
  return manha || tarde;
}

/**
 * Contexto de horário para o prompt. A Bella precisa saber se PODE prometer
 * que um atendente assume agora, ou se deve informar quando o setor reabre.
 */
export function contextoDeHorario(now = new Date()): string {
  return isWithinBusinessHours(now)
    ? `\n\nAGORA: o setor de reservas ESTÁ atendendo. Ao encaminhar para um humano, diga que um atendente assume em instantes.`
    : `\n\nAGORA: o setor de reservas NÃO está atendendo (funciona ${HORARIO_RESERVAS_TEXTO}). ` +
        `NÃO prometa que um atendente assume agora nem diga "só um momento". Informe o horário de atendimento ` +
        `e ofereça a recepção 24h pelo telefone ${TELEFONE_RECEPCAO}.`;
}
