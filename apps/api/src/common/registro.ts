/**
 * A Bella NAO registra nada. Esta guarda impede que ela diga que registrou.
 *
 * Caso real (16/10/2026): a hospede avisou "vamos chegar as 19 horas" e a
 * Bella respondeu "Registrei aqui que voces vao chegar as 19h, Debora" e "ja
 * anotei na sua reserva para deixarmos a recepcao ciente". Nada disso
 * aconteceu: ela nao tem acesso ao sistema de reservas, nao grava recado em
 * lugar nenhum e nao avisa a recepcao. A hospede chega as 19h confiando num
 * aviso que nunca existiu - e quem recebe a reclamacao e a recepcao.
 *
 * A base de conhecimento ja proibia a frase em dois lugares. Nao bastou:
 * prompt e pedido, funcao e garantia. Mesmo desenho de semPrecoInventado e
 * semGarantiaDeVaga - detecta por frase e corta so a frase ofensora.
 */

/** Esta frase afirma que algo foi anotado, registrado ou repassado? */
export function frasePrometeRegistro(frase: string): boolean {
  const t = frase || '';

  // "registrei", "anotei", "ja deixei anotado", "ficou registrado", "vou
  // registrar", "deixei no sistema", "constou na reserva".
  if (/\b(registrei|anotei|anotado|registrado|registrada|registrarei|anotarei)\b/i.test(t)) return true;
  if (/\bvou\s+(?:registrar|anotar|deixar\s+anotado|lan[çc]ar)\b/i.test(t)) return true;
  if (/\b(?:lancei|lan[çc]ei|inclui|incluí|coloquei|salvei)\b[^.!?]{0,30}\b(?:sistema|reserva|cadastro)\b/i.test(t))
    return true;

  // "avisei a recepcao", "ja informei a equipe", "deixamos a recepcao ciente".
  if (/\b(avisei|informei|comuniquei|repassei)\b/i.test(t)) return true;
  // "deixei a recepcao ciente", "deixaremos o hotel ciente", "deixar ciente".
  // O objeto entra no meio, entao nao da para exigir as palavras coladas.
  if (/\bdeix(?:ei|amos|arei|aremos|ar|armos)\b[^.!?]{0,25}\bciente\b/i.test(t)) return true;

  return false;
}

/**
 * Tira da resposta qualquer frase que prometa registro ou aviso interno.
 *
 * Se a resposta inteira era isso, sobra uma confirmacao honesta: a Bella
 * agradece o aviso sem dizer que fez algo que nao fez.
 */
export function semPromessaDeRegistro(texto: string): string {
  const original = texto || '';
  if (!original.trim() || !frasePrometeRegistro(original)) return original;

  const limpo = original
    .split(/\r?\n/)
    .map((linha) =>
      linha
        .split(/(?<=[.!?])\s+/)
        .filter((f) => !frasePrometeRegistro(f))
        .join(' ')
        .trim(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Cortar tudo deixaria a recepcao sem resposta para enviar. Melhor uma
  // frase curta e verdadeira do que uma invencao gentil.
  if (!limpo) return 'Obrigada por avisar! Ficamos à disposição.';
  return limpo;
}
