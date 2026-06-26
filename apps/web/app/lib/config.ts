// Hotel ativo no painel. Multi-tenant futuro: derivar do usuário autenticado.
export const HOTEL_ID = 'hotel-do-bosque';

export const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
  TELEGRAM: 'Telegram',
  EMAIL: 'E-mail',
  WEBCHAT: 'Site',
  GOOGLE_BUSINESS: 'Google',
};

export const STAGE_LABELS: Record<string, string> = {
  NEW_LEAD: 'Novo Lead',
  INQUIRY: 'Consulta',
  QUOTE_SENT: 'Cotação Enviada',
  NEGOTIATION: 'Em Negociação',
  RESERVATION_CONFIRMED: 'Reserva Confirmada',
  CHECKED_IN: 'Check-in',
  POST_STAY: 'Pós Venda',
  RECURRING_CUSTOMER: 'Cliente Recorrente',
};

export const POLICY_LABELS: Record<string, string> = {
  CANCELLATION: 'Cancelamento',
  REFUND: 'Reembolso',
  NO_SHOW: 'No-show',
  PETS: 'Pets',
  CHILDREN: 'Crianças',
  GROUPS: 'Grupos',
  PAYMENT: 'Pagamento',
  CHECK_IN: 'Check-in',
  CHECK_OUT: 'Check-out',
  CHANGES: 'Alterações',
  COURTESY: 'Cortesia',
};

export const SENDER_LABELS: Record<string, string> = {
  GUEST: 'Hóspede',
  BELLA: 'Bella',
  HUMAN_AGENT: 'Atendente',
  SYSTEM: 'Sistema',
};
