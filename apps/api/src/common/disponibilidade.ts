/**
 * A Bella nao pode AFIRMAR disponibilidade que ninguem consultou.
 *
 * No caminho dos canais (Instagram, Facebook, WhatsApp oficial) a consulta de
 * vaga e um esqueleto: checkAvailability() devolve sempre { available: true }.
 * Ou seja, nunca houve consulta nenhuma - e mesmo assim a resposta saia
 * dizendo "Temos disponibilidade para essas datas", frase que apareceu num
 * atendimento real de 15/10/2026, na mesma mensagem em que ela inventou um
 * preco.
 *
 * O link do motor de reservas mostra a vaga verdadeira. Entao a resposta certa
 * e mandar o link, nao garantir vaga. Afirmar antes e prometer o que nao se
 * sabe - e, na alta temporada, e prometer o que nao existe.
 *
 * Mesma licao do preco e do audio: o prompt pede, a funcao garante.
 */
const AFIRMA_VAGA =
  /(temos|h[áa]|ainda (?:h[áa]|temos)|est[áa])\s+(?:sim\s+)?(?:apartamentos?\s+)?dispon[íi]ve(?:l|is)|temos\s+disponibilidade|h[áa]\s+disponibilidade|dispon[íi]vel\s+para\s+(?:essas|estas|as suas|suas)\s+datas|confirmo\s+a\s+disponibilidade/i;

/** A frase garante vaga? */
export function fraseAfirmaDisponibilidade(frase: string): boolean {
  return AFIRMA_VAGA.test(frase || '');
}

/**
 * Tira as frases que garantem vaga, quando nao houve consulta de verdade.
 *
 * Recorte por frase, como no preco: o resto da resposta continua valendo, e o
 * hospede recebe o link - que e onde a vaga real aparece.
 */
export function semGarantiaDeVaga(texto: string, consultou: boolean): string {
  const original = texto || '';
  if (consultou || !original.trim() || !fraseAfirmaDisponibilidade(original)) return original;

  const limpo = original
    .split(/\r?\n/)
    .map((linha) =>
      linha
        .split(/(?<=[.!?])\s+/)
        .filter((f) => !fraseAfirmaDisponibilidade(f))
        .join(' ')
        .trim(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return limpo.length >= 40 ? limpo : original.replace(AFIRMA_VAGA, 'o link abaixo mostra a disponibilidade');
}
