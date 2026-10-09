/**
 * Quando a Bella NAO deve responder sozinha.
 *
 * Decisao do dono em 09/10/2026: a Bella responde automaticamente em todos os
 * canais, e tudo que ela puder resolver sozinha, resolve. Mas "tudo" nao e
 * "qualquer coisa" - ha assunto que, errado, custa dinheiro ou custa o
 * hospede. Nesses casos ela cala e passa para a recepcao.
 *
 * As regras ficam AQUI, em codigo, e nao em instrucao de prompt. O projeto ja
 * aprendeu essa licao varias vezes: texto pronto vence regra escrita longe, e
 * uma instrucao de prompt e exatamente uma regra escrita longe. O modelo pode
 * ignora-la; uma funcao nao.
 *
 * O GuardrailsService continua cuidando do anti-prejuizo (cancelamento,
 * reembolso, desconto, confianca baixa). Aqui ficam os casos que faltavam.
 */

/** O hospede esta PEDINDO uma pessoa. Nao se discute: passa. */
const PEDIU_HUMANO: RegExp[] = [
  /\b(falar|conversar)\s+com\s+(uma?\s+)?(pessoa|humano|atendente|gerente|recep[cç][aã]o|respons[aá]vel)\b/i,
  /\b(quero|queria|gostaria de)\s+(falar|conversar)\s+com\s+algu[eé]m\b/i,
  /\b(me\s+)?(passa|transfere|transferir)\s+para\s+(um|uma)?\s*(atendente|humano|pessoa|gerente)\b/i,
  // Sem \b no fim: 'robô' termina em acento, e acento nao conta como letra
  // para a borda de palavra - "isso é um robô?" nao casava.
  /\b(isso|voc[êe])\s+[ée]\s+(um\s+)?(rob[oô]|bot\b|m[aá]quina)/i,
  /\bhablar con (una persona|un humano|alguien|un agente)\b/i,
  /\b(talk|speak) (to|with) (a )?(human|person|agent|someone)\b/i,
];

/** Reclamacao. Resposta automatica em cima de hospede irritado piora tudo. */
const RECLAMACAO: RegExp[] = [
  /\b(p[ée]ssimo|horr[ií]vel|inaceit[aá]vel|absurdo|vergonha|descaso)\b/i,
  /\b(reclama[cç][aã]o|reclamar|procon|processar|advogado|justi[cç]a)\b/i,
  /\b(nojento|sujo|imundo|barata|rato|mofo|infiltra[cç][aã]o)\b/i,
  /\b(fui\s+mal\s+atendid|me\s+trataram\s+mal|falta\s+de\s+respeito)/i,
  /\b(quero\s+meu\s+dinheiro\s+de\s+volta)\b/i,
  /\b(terrible|awful|unacceptable|disgusting)\b/i,
  /\b(p[ée]simo|horrible|inaceptable|asqueroso)\b/i,
];

/**
 * Dinheiro escrito na resposta.
 *
 * A Bella NUNCA informa preco - regra da casa desde o inicio. Ela manda o
 * link, e o link mostra o valor. Se um numero em reais apareceu no texto, ela
 * inventou ou leu errado, e inventar preco e o erro mais caro que existe aqui.
 */
const DINHEIRO = /R\$\s*\d|\b\d+[.,]\d{2}\s*reais\b|\breais\s*\d/i;

/** Promessa que so uma pessoa pode cumprir. */
const PROMESSA_HUMANA: RegExp[] = [
  /\b(vou|irei)\s+(verificar|conferir|checar|confirmar)\s+(com|junto)/i,
  /\b(te\s+)?(retorno|retornarei|aviso|avisarei)\s+(em\s+breve|mais\s+tarde|assim\s+que)/i,
  /\b(j[áa]\s+)?(reservei|bloqueei|garanti|separei)\s+(o|a|seu|sua)\b/i,
  /\bvou\s+registrar\s+(a|o|sua|seu)\b/i,
];

/**
 * O hospede escreveu numa lingua que a Bella nao atende?
 *
 * Deliberadamente conservador: so acusa o que e INEQUIVOCO. Nao importamos a
 * deteccao de idioma do modulo de atendimento de proposito - ela vive no
 * assist, que depende deste modulo, e o import de volta fecharia um ciclo.
 *
 * Dois sinais, os dois sem ambiguidade:
 *  - alfabeto que nao e o nosso (chines, japones, coreano, arabe, hebraico,
 *    cirilico, tailandes, grego);
 *  - palavras curtas e frequentes de frances, alemao e italiano que NAO
 *    existem em portugues, espanhol ou ingles.
 *
 * Na duvida, devolve null e a Bella responde - errar escalando demais cansa a
 * recepcao e mata o proposito de ela atender sozinha.
 */
export function idiomaNaoAtendido(texto: string): string | null {
  const t = (texto || '').trim();
  if (t.length < 3) return null;

  const alfabetos: [RegExp, string][] = [
    [/[\u4e00-\u9fff]/, 'chinês'],
    [/[\u3040-\u30ff]/, 'japonês'],
    [/[\uac00-\ud7af]/, 'coreano'],
    [/[\u0600-\u06ff]/, 'árabe'],
    [/[\u0590-\u05ff]/, 'hebraico'],
    [/[\u0400-\u04ff]/, 'russo'],
    [/[\u0e00-\u0e7f]/, 'tailandês'],
    [/[\u0370-\u03ff]/, 'grego'],
  ];
  for (const [r, nome] of alfabetos) if (r.test(t)) return nome;

  const baixo = t.toLowerCase();
  const frances = /\b(bonjour|bonsoir|s'il vous pla[îi]t|merci|chambre|nuits?|je voudrais|avez-vous|combien)\b/;
  const alemao = /\b(guten tag|guten morgen|zimmer|n[äa]chte|danke|haben sie|ich m[öo]chte|wie viel)\b/;
  const italiano = /\b(buongiorno|buonasera|camera|notti|grazie|vorrei|avete|quanto costa)\b/;
  if (frances.test(baixo)) return 'francês';
  if (alemao.test(baixo)) return 'alemão';
  if (italiano.test(baixo)) return 'italiano';

  return null;
}

export interface DadosDaDecisao {
  /** O que o hospede acabou de escrever. */
  falaDoHospede: string;
  /** O que a Bella pretende responder. */
  resposta: string;
  /** Respostas que a Bella ja mandou antes nesta conversa. */
  respostasAnteriores?: string[];
}

/**
 * Devolve o motivo para passar a conversa a um humano, ou null para seguir
 * respondendo sozinha.
 *
 * A ordem importa: o pedido explicito do hospede vem primeiro, porque nenhum
 * outro criterio deve passar por cima dele.
 */
export function motivoParaHumano(dados: DadosDaDecisao): string | null {
  const fala = dados.falaDoHospede || '';
  const resposta = dados.resposta || '';

  if (PEDIU_HUMANO.some((r) => r.test(fala))) {
    return 'o hóspede pediu para falar com uma pessoa';
  }

  if (RECLAMACAO.some((r) => r.test(fala))) {
    return 'o hóspede fez uma reclamação';
  }

  const outraLingua = idiomaNaoAtendido(fala);
  if (outraLingua) {
    return `o hóspede escreveu em ${outraLingua}, idioma que a Bella não atende`;
  }

  if (!resposta.trim() || resposta.trim().length < 15) {
    return 'a resposta saiu vazia ou curta demais para ser enviada';
  }

  if (DINHEIRO.test(resposta)) {
    return 'a resposta trazia valor em dinheiro, e a Bella não informa preços';
  }

  if (PROMESSA_HUMANA.some((r) => r.test(resposta))) {
    return 'a resposta prometia algo que depende de uma pessoa';
  }

  // A mesma resposta de novo quer dizer que ela nao esta resolvendo. Repetir
  // pela terceira vez e so fazer o hospede desistir sozinho.
  const anteriores = dados.respostasAnteriores ?? [];
  if (anteriores.some((a) => praticamenteIgual(a, resposta))) {
    return 'a Bella já tinha respondido isso e não resolveu';
  }

  return null;
}

/** Dois textos dizem a mesma coisa? Comparacao por palavras, sem acento. */
export function praticamenteIgual(a: string, b: string): boolean {
  const palavras = (t: string) =>
    new Set(
      (t || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean),
    );
  const A = palavras(a);
  const B = palavras(b);
  if (!A.size || !B.size) return false;
  let comuns = 0;
  A.forEach((p) => {
    if (B.has(p)) comuns++;
  });
  return comuns / Math.max(A.size, B.size) >= 0.9;
}
