/**
 * "O cancelamento e gratuito?" de quem AINDA NAO reservou.
 *
 * Caso real (29/10/2026): cafe, estacionamento e o link ja tinham sido
 * respondidos; a hospede so perguntou "O cancelamento e gratuito?". A sugestao
 * respondeu o horario do setor de reservas e nada sobre cancelamento. A base
 * manda "perguntar ANTES onde a reserva foi feita" e "encaminhar a equipe" -
 * regras para quem JA TEM reserva -, e fora do expediente isso virou so o
 * horario. Quem esta orcando com a gente vai reservar direto: a regra e a da
 * reserva direta, e ela pode ser dita.
 *
 * As faixas repetem a base ("Cancelamento e alteracao: multas da reserva
 * DIRETA", prisma/seed-conhecimento.js). Mudou la, muda aqui.
 */
const PERGUNTA_DE_CANCELAMENTO = /cancel/i;

/** Sinais de que ele JA tem reserva - ai vale o caminho da base (onde reservou, encaminhar). */
const JA_TEM_RESERVA =
  /\b(minha reserva|nossa reserva|j[áa] reservei|reservei|reservamos|fiz (?:a|uma) reserva|fizemos (?:a|uma) reserva|reserva (?:feita|confirmada)|j[áa] paguei|localizador|n[úu]mero da reserva|booking|expedia|decolar|cvc|airbnb|hoteis\.com|trivago|ag[êe]ncia|operadora)\b/i;

export function contextoDeCancelamento(perguntaDeAgora: string, falasDoHospede: string): string {
  if (!PERGUNTA_DE_CANCELAMENTO.test(perguntaDeAgora || '')) return '';
  if (JA_TEM_RESERVA.test(falasDoHospede || '')) return '';
  return (
    `\n\nPERGUNTA SOBRE CANCELAMENTO de quem AINDA NÃO RESERVOU (está orçando conosco, vai reservar direto pelo site). ` +
    `Responda a regra da reserva DIRETA, em no máximo 3 linhas: o cancelamento não é gratuito — a multa depende da ` +
    `antecedência em relação ao check-in: 30 dias ou mais antes, 10% do valor total; de 29 a 15 dias, 50%; de 14 a 8 dias, 80%; ` +
    `7 dias ou menos, 100%. Não há reembolso em dinheiro: o saldo vira crédito para hospedagem futura, válido por um ano. ` +
    `NÃO pergunte onde ele reservou (ainda não reservou), NÃO fale do horário do setor de reservas, NÃO encaminhe para a equipe, ` +
    `NÃO reenvie o link e NÃO repita o que já foi respondido antes na conversa.`
  );
}
