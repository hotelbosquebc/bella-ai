/**
 * Early check-in e late check-out: a Bella NAO fala de custo.
 *
 * Regra do dono (22/10/2026). A resposta dizia "Geralmente, nao ha custo se
 * houver disponibilidade no proprio dia" - e a base de conhecimento ensinava
 * isso. Se e cobrado ou nao, quem diz e a recepcao, no dia. A Bella diz so que
 * depende da disponibilidade e que, para GARANTIR, e preciso reservar mais uma
 * diaria.
 *
 * Mesmo desenho de semPromessaDeRegistro: detecta por frase e corta so a frase
 * ofensora. A frase de custo costuma vir SOZINHA ("Geralmente, nao ha
 * custo..."), sem repetir "late check-out" - por isso o assunto e lido na
 * resposta inteira, e o custo, frase a frase.
 */

const ASSUNTO =
  /\b(?:late\s*check-?\s*out|early\s*check-?\s*in|check-?\s*out\s+(?:tardio|mais\s+tarde|estendido)|check-?\s*in\s+(?:antecipado|mais\s+cedo)|sa[íi]da\s+(?:tardia|mais\s+tarde)|sair\s+mais\s+tarde|entrada\s+antecipada|entrar\s+mais\s+cedo|chegar\s+mais\s+cedo|ficar\s+(?:at[ée]\s+)?mais\s+tarde|salida\s+tard[íi]a|entrada\s+anticipada)/i;

const SEM_CUSTO =
  /\b(?:sem\s+(?:custo|cobran[çc]a|taxa|valor\s+adicional|acr[ée]scimo|custo\s+adicional)|n[ãa]o\s+(?:h[áa]|tem|existe)\s+(?:custo|cobran[çc]a|taxa)|n[ãa]o\s+(?:[ée]|ser[áa])\s+cobrad[oa]|n[ãa]o\s+cobramos|gratuit[oa]|de\s+gra[çc]a|cortesia|sin\s+(?:costo|cargo)|free\s+of\s+charge|no\s+(?:extra\s+)?charge)/i;

/** Bagagem guardada sem custo e verdade e pode ficar. */
const BAGAGEM = /\b(?:bagage(?:m|ns)|malas?|equipaje)\b/i;

export function fraseDaCustoDeHorario(frase: string): boolean {
  return SEM_CUSTO.test(frase || '') && !BAGAGEM.test(frase || '');
}

export function semCustoDeHorarioExtra(texto: string): string {
  const original = texto || '';
  if (!original.trim() || !ASSUNTO.test(original) || !SEM_CUSTO.test(original)) return original;

  const limpo = original
    .split(/\r?\n/)
    .map((linha) =>
      linha
        .split(/(?<=[.!?])\s+/)
        .filter((f) => !fraseDaCustoDeHorario(f))
        .join(' ')
        .trim(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Nunca devolver a frase cortada: sem nada, sai a regra, curta e verdadeira.
  return (
    limpo ||
    'O early check-in e o late check-out dependem da disponibilidade do dia. Para garantir, é preciso reservar uma diária adicional.'
  );
}
