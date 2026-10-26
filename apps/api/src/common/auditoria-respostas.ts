import { frasePrometeRegistro } from './registro';
import { fraseAfirmaDisponibilidade } from './disponibilidade';
import { semCustoDeHorarioExtra } from './horario-extra';
import { falaDeNotaFiscal } from '../modules/bella/escalonamento';

/**
 * O que a auditoria diaria procura em cada resposta da Bella, sem IA.
 *
 * Pedido do dono (26/10/2026): "uma analise completa diaria para evitar erros
 * e alucinacoes". As guardas cortam esses problemas ANTES de a resposta sair;
 * a auditoria confere DEPOIS se alguma coisa passou - foi assim que se
 * descobriu, em 26/10, que as guardas da extensao nao tinham efeito desde
 * 13/10. Guarda sem conferencia e promessa.
 *
 * "grave" = nao pode chegar ao hospede nunca. "atencao" = pode ser legitimo
 * (vaga confirmada pela consulta real, piscina quando ele perguntou), mas
 * vale um olhar.
 */
export type Gravidade = 'grave' | 'atencao';

export interface Achado {
  tipo: string;
  gravidade: Gravidade;
  trecho: string;
}

const DOMINIOS_OFICIAIS = /silbeck\.com\.br|hotelbosque\.com\.br|instagram\.com\/hotelbosquebc|facebook\.com\/hoteldobosque|tiktok\.com\/@?hoteldobosquebc|drive\.google\.com|wa\.me|bella-api-nh3h\.onrender\.com/i;

function trechoEm(texto: string, indice: number, tamanho = 160): string {
  const ini = Math.max(0, indice - 60);
  return (texto.slice(ini, ini + tamanho) || '').replace(/\s+/g, ' ').trim();
}

function frases(texto: string): string[] {
  return (texto || '').split(/\r?\n|(?<=[.!?])\s+/).map((f) => f.trim()).filter(Boolean);
}

export function auditarResposta(texto: string): Achado[] {
  const t = texto || '';
  const achados: Achado[] = [];
  const add = (tipo: string, gravidade: Gravidade, trecho: string) => achados.push({ tipo, gravidade, trecho: trecho.slice(0, 200) });

  // Valor em dinheiro: a Bella nao informa preco.
  const dinheiro = t.search(/R\$\s*\d|\b\d+[.,]\d{2}\s*reais\b/i);
  if (dinheiro >= 0) add('preço em reais', 'grave', trechoEm(t, dinheiro));

  // Promessa de registro/aviso interno que ela nao faz.
  const registro = frases(t).find((f) => frasePrometeRegistro(f));
  if (registro) add('prometeu registro/aviso interno', 'grave', registro);

  // Rascunho da IA vazado.
  const rascunho = t.search(/^\s*\([a-e]\)\s|^\s*O\s+h[óo]spede\s+(?:tamb[ée]m\s+)?(?:perguntou|informou|disse|mencionou)\b|^\s*(?:-{3,}|\*{3,})\s*$/im);
  if (rascunho >= 0) add('rascunho da IA', 'grave', trechoEm(t, rascunho));

  // Custo de early check-in / late check-out (regra do dono, 22/10/2026).
  if (semCustoDeHorarioExtra(t) !== t) add('custo de early/late check-out', 'grave', t);

  // Link que nao e do hotel.
  for (const m of t.matchAll(/https?:\/\/\S+/gi)) {
    if (!DOMINIOS_OFICIAIS.test(m[0])) add('link que não é do hotel', 'grave', m[0]);
  }

  // Texto quebrado: variavel nao preenchida, marcador interno.
  const quebrado = t.search(/\{\{|\}\}|\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b|RESERVA:|VAGA CONFIRMADA|DADOS DE RESERVA/);
  if (quebrado >= 0) add('texto quebrado ou instrução interna', 'grave', trechoEm(t, quebrado));

  // Nota fiscal: so a frase oficial. Qualquer outra afirmacao e atencao.
  if (falaDeNotaFiscal(t) && !/recep[çc][ãa]o no (momento do )?check-?out|no check-?out, na recep[çc][ãa]o/i.test(t)) {
    add('nota fiscal fora da frase oficial', 'atencao', trechoEm(t, t.search(/nota\s+fiscal|nf/i)));
  }

  // Vaga afirmada: so vale com a consulta real. Atencao, nao grave.
  // "quando ha disponibilidade" / "se houver disponibilidade" e condicao, nao afirmacao.
  const vaga = frases(t).find(
    (f) => fraseAfirmaDisponibilidade(f) && !/\b(quando|se|caso)\s+(h[áa]|houver|haja|tiver)(?![a-zà-ÿ])|sujeit[oa]s?\s+[àa]/i.test(f),
  );
  if (vaga) add('afirmou disponibilidade', 'atencao', vaga);

  // Estrutura que o hotel nao tem.
  const estrutura = t.search(/piscina|cofre|academia|sauna|\bspa\b/i);
  if (estrutura >= 0) add('falou de estrutura que o hotel não tem', 'atencao', trechoEm(t, estrutura));

  // Longa demais para WhatsApp (mediana da recepcao: 69 caracteres).
  if (t.length > 700) add('resposta longa (mais de 700 caracteres)', 'atencao', t.slice(0, 120) + '…');

  return achados;
}
