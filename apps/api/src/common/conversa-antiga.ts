/**
 * Conversa de OUTROS DIAS e contexto, nao pergunta.
 *
 * Caso real (29/10/2026): o hospede voltou depois de mais de um mes. Hoje so
 * tinham saido as mensagens automaticas (saudacao do WhatsApp e /dados), entao
 * a conversa de setembro ("LI E CONCORDO", pagamento) parecia a ultima coisa
 * sem resposta - e a sugestao respondeu a ela: "o setor de reservas ja esta
 * ciente da sua confirmacao...". Regra do dono: le o contexto, mas responde so
 * ao que foi perguntado agora.
 *
 * Sem data na linha nao da para separar "ontem" de "setembro" - e o pedido de
 * ontem com um "bom dia" hoje TEM de ser respondido (caso de 27/10/2026). Por
 * isso quem tem a data (a extensao, o banco) separa as mensagens antigas e
 * elas chegam ao modelo num bloco a parte, fora de toda a leitura de pedido.
 */
export const DIAS_DE_CONVERSA_RECENTE = 3;

/** Inicio do periodo "recente": meia-noite de hoje menos DIAS_DE_CONVERSA_RECENTE. */
export function inicioDaConversaRecente(inicioDeHoje: Date): number {
  return inicioDeHoje.getTime() - DIAS_DE_CONVERSA_RECENTE * 24 * 60 * 60 * 1000;
}

/** A conversa como o modelo le, com o historico antigo separado e rotulado. */
export function comConversaAntiga(conversaRecente: string, antiga?: string): string {
  const velha = (antiga || '').trim();
  if (!velha) return `Conversa até aqui:\n${conversaRecente}`;
  return (
    `MENSAGENS DE DIAS ANTERIORES (mais de ${DIAS_DE_CONVERSA_RECENTE} dias atrás) — só contexto, já foram tratadas. ` +
    `NÃO responda a elas e NÃO retome os assuntos delas (confirmação, pagamento, reserva ou pedido antigo):\n` +
    `${velha.slice(-3000)}\n\n` +
    `CONVERSA RECENTE — é a ela que você responde:\n${conversaRecente}`
  );
}

/** Para o caminho automatico, que nao tem o historico antigo como texto de conversa. */
export function contextoDeConversaAntiga(antiga: string): string {
  const velha = (antiga || '').trim();
  if (!velha) return '';
  return (
    `\n\nMENSAGENS DE DIAS ANTERIORES com este contato (mais de ${DIAS_DE_CONVERSA_RECENTE} dias atrás) — só contexto, ` +
    `já foram tratadas. NÃO responda a elas e NÃO retome os assuntos delas (confirmação, pagamento, reserva ou pedido antigo):\n` +
    velha.slice(-2000)
  );
}
