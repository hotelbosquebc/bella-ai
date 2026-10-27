/**
 * Duas sujeiras que a IA deixa na resposta e que nunca podem chegar ao hospede.
 *
 * Caso real (26/10/2026). A sugestao comecou com o rascunho da propria IA:
 *   "(a) periodo — datas de entrada e saida: 22 de dezembro ate 28 de dezembro
 *    (b) quantidade de pessoas: ...
 *    O hospede perguntou sobre piscina.
 *    ---
 *    Ola! Sou a Bella..."
 * O "(a) (b) (c)" e o checklist do prompt, copiado. E a piscina ninguem
 * perguntou: a IA puxou da base de conhecimento ("o hotel NAO possui piscina")
 * e respondeu a uma pergunta inventada.
 *
 * Prompt e pedido; funcao e garantia - mesmo desenho das outras guardas.
 */

/** Corta o rascunho que a IA escreve para si antes da resposta. */
export function semRaciocinioVazado(texto: string): string {
  let t = texto || '';
  // Rascunho separado por uma linha de tracos: a resposta e o que vem depois.
  const partes = t.split(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m);
  if (partes.length > 1) {
    const ultima = partes[partes.length - 1].trim();
    if (ultima.length >= 20) t = ultima;
  }
  // Rascunho antes da saudacao: a resposta comeca no "Ola". Caso real
  // (27/10/2026): a sugestao abriu com "INVENTARIO:" - o titulo do checklist
  // do prompt - e so depois vinha "Ola! Sou a Bella...". So corta quando o
  // que vem antes tem cara de anotacao interna.
  const linhas = t.split(/\r?\n/);
  const saudacao = linhas.findIndex((l) => /^\s*(?:Ol[áa]|Oi|Bom dia|Boa tarde|Boa noite|Hola|Buen[oa]s)(?![a-zà-ÿ])/i.test(l));
  if (saudacao > 0) {
    const antes = linhas.slice(0, saudacao).join('\n');
    if (/invent[áa]rio|rascunho|checklist|^\s*\(?[a-e]\)\s|per[íi]odo\s*[:—-]|quantidade de pessoas\s*[:—-]|^\s*[A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{4,}:\s*$/im.test(antes)) {
      t = linhas.slice(saudacao).join('\n');
    }
  }
  // Linhas de checklist, titulos internos e narracao sobre o hospede em
  // terceira pessoa.
  const limpo = t
    .split(/\r?\n/)
    .filter((linha) => !/^\s*\(?[a-e]\)\s/i.test(linha))
    .filter((linha) => !/^\s*\**\s*(?:invent[áa]rio|rascunho|resposta|an[áa]lise|checklist)\b[^\n]{0,30}:?\s*\**\s*$/i.test(linha))
    .filter((linha) => !/^\s*O\s+h[óo]spede\s+(?:tamb[ée]m\s+)?(?:perguntou|informou|disse|quer|pediu|mencionou|est[áa])\b/i.test(linha))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return limpo || (texto || '').trim();
}

/**
 * Estrutura que o hotel NAO tem: so se fala dela quando o hospede perguntou.
 * A base de conhecimento traz "nao possui piscina / cofre" para responder a
 * quem pergunta - nao para anunciar a ausencia a quem nem tocou no assunto.
 */
const ASSUNTOS_SO_SE_PERGUNTADOS: RegExp[] = [/piscinas?/i, /cofres?/i, /academia/i, /sauna/i, /\bspa\b/i];

export function semAssuntoNaoPerguntado(texto: string, falasDoHospede: string): string {
  const original = texto || '';
  const fala = falasDoHospede || '';
  const intrusos = ASSUNTOS_SO_SE_PERGUNTADOS.filter((r) => r.test(original) && !r.test(fala));
  if (!intrusos.length) return original;
  const limpo = original
    .split(/\r?\n/)
    .map((linha) =>
      linha
        .split(/(?<=[.!?])\s+/)
        .filter((frase) => !intrusos.some((r) => r.test(frase)))
        .join(' ')
        .trim(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return limpo || original;
}
