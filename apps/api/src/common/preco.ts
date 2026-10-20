/**
 * A Bella NAO informa valores. Esta guarda impede que ela informe.
 *
 * A regra de nao cotar preco esta no prompt desde o inicio e mesmo assim ela
 * cotou: em 13/10/2026 sugeriu "o valor da diaria e de R$ 430,00", inventado e
 * errado. Prompt e pedido; funcao e garantia.
 *
 * Morava dentro do modulo de atendimento e por isso valia so para a sugestao
 * da extensao. Em 20/10/2026, ao auditar a Bella antes de deixa-la responder
 * sozinha, ficou claro que o caminho dos canais (Instagram, Facebook e em
 * breve o WhatsApp automatico) NAO tinha essa trava - justamente o caminho em
 * que ninguem le a resposta antes de ela sair. Mudou para ca para os dois
 * usarem a mesma, como ja foi feito com os links e a disponibilidade.
 */

/** Esta frase informa um valor? */
export function fraseTemPreco(frase: string): boolean {
  const t = frase || '';
  if (/R\$\s*\d/.test(t)) return true;
  if (/\b\d{2,4}[.,]\d{2}\s*(reais|por noite|a di[áa]ria)\b/i.test(t)) return true;
  if (/\b(valor|pre[çc]o|di[áa]ria|tarifa)\b[^.!?]{0,40}\b\d{2,4}\b/i.test(t)) return true;
  return false;
}

/**
 * Tira da resposta qualquer frase que informe preco.
 *
 * Se sobrar texto demais de menos, devolve uma frase util no lugar: com link,
 * manda o link (que e quem mostra o valor de verdade); sem link, pede os dados
 * que faltam. Resposta vazia seria pior do que a frase errada.
 */
export function semPrecoInventado(texto: string, link?: string | null): string {
  const original = texto || '';
  if (!original.trim() || !fraseTemPreco(original)) return original;

  const linhas = original.split(/\r?\n/);
  const cortada: boolean[] = [];
  const restos = linhas.map((linha, i) => {
    const sobra = linha
      .split(/(?<=[.!?])\s+/)
      .filter((f) => !fraseTemPreco(f))
      .join(' ')
      .trim();
    cortada[i] = Boolean(linha.trim()) && !sobra;
    return sobra;
  });

  // Rotulo que ficou orfao: "Para 3 pessoas:" com o valor na linha de baixo.
  // Caso real (20/10/2026): a guarda cortou os valores e a mensagem chegou ao
  // atendente com "Para 3 pessoas:" e "Para 4 pessoas:" seguidos de nada.
  // So sai o rotulo cuja PROXIMA linha com texto foi justamente a cortada.
  for (let i = 0; i < restos.length; i++) {
    if (!/:\s*$/.test(restos[i])) continue;
    let j = i + 1;
    while (j < linhas.length && !linhas[j].trim()) j++;
    if (j < linhas.length && cortada[j]) restos[i] = '';
  }

  const limpo = restos
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (limpo.length >= 40) return limpo;

  return link
    ? `Segue o link com os valores e a disponibilidade para o seu período. Por ele você já consegue concluir a sua reserva:\n\n${link}`
    : 'Para eu verificar os valores e a disponibilidade, me confirme por gentileza o período da estadia e quantas pessoas seriam.';
}
