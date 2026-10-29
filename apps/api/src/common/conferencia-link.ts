/**
 * Conferencia do link ANTES de ele sair. Regra do dono (29/10/2026): "ela nao
 * pode errar os links, eles seguem um padrao definido - identifique e sempre
 * confirme antes de enviar".
 *
 * Caso que motivou: "1 diaria, do dia 2 ao dia 3/04" + "2 adultos e 2
 * criancas (3 e 4 anos)" saiu como checkout=04/04 e criancas-000003=4. O link
 * estava no formato certo - o erro era o CONTEUDO. Por isso duas conferencias:
 *
 *  1. Padrao: o endereco e os parametros que o motor aceita, e valores que
 *     fazem sentido (data valida, saida depois da entrada, nada no passado,
 *     no maximo 6 pessoas por apartamento).
 *  2. Fala do hospede: o periodo, o numero de diarias e a ocupacao que ele
 *     escreveu por ultimo, lidos de novo, separado da montagem.
 */
export const PADRAO_DO_LINK = 'https://sbreserva.silbeck.com.br/hotelbosque/pt-br/reserva/busca/';
const PARAMETROS = ['checkin', 'checkout', 'adultos-000001', 'criancas-000003', 'criancas-000004'];
const MAXIMO_POR_APARTAMENTO = 6;
const MAXIMO_DE_NOITES = 60;

export interface LinkLido {
  checkin: string;
  checkout: string;
  adultos: number;
  criancas0_6: number;
  criancas7_9: number;
}

export interface Esperado {
  /** Periodos que o hospede escreveu no pedido mais recente; null = nao da para conferir. */
  periodos: { checkin: string; checkout: string }[] | null;
  /** "1 diaria", "3 noites" no mesmo pedido. */
  noites: number | null;
  /** Ocupacao da fala mais recente que a traz; null = nao da para conferir. */
  ocupacao: { adultos: number; criancas0_6: number; criancas7_9: number } | null;
}

const ehDataIso = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const noitesEntre = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const br = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

export function lerLink(url: string): LinkLido | null {
  if (!url.startsWith(PADRAO_DO_LINK + '?')) return null;
  const q = new URLSearchParams(url.slice(PADRAO_DO_LINK.length + 1));
  return {
    checkin: q.get('checkin') || '',
    checkout: q.get('checkout') || '',
    adultos: Number(q.get('adultos-000001')),
    criancas0_6: Number(q.get('criancas-000003') || 0),
    criancas7_9: Number(q.get('criancas-000004') || 0),
  };
}

/** Problemas de PADRAO: endereco, parametros e valores possiveis. Vazio = ok. */
export function problemasDePadrao(url: string, hojeIso: string): string[] {
  const p: string[] = [];
  if (!url.startsWith(PADRAO_DO_LINK + '?')) return [`endereço fora do padrão (${url.slice(0, 70)})`];
  const q = new URLSearchParams(url.slice(PADRAO_DO_LINK.length + 1));
  const estranhos = [...q.keys()].filter((k) => !PARAMETROS.includes(k));
  if (estranhos.length) p.push(`parâmetro desconhecido: ${estranhos.join(', ')}`);
  const l = lerLink(url)!;
  if (!ehDataIso(l.checkin)) p.push('data de entrada inválida');
  if (!ehDataIso(l.checkout)) p.push('data de saída inválida');
  if (ehDataIso(l.checkin) && ehDataIso(l.checkout)) {
    const n = noitesEntre(l.checkin, l.checkout);
    if (n < 1) p.push('saída não é depois da entrada');
    if (n > MAXIMO_DE_NOITES) p.push(`${n} diárias`);
    if (l.checkin < hojeIso) p.push('entrada no passado');
  }
  const inteiro = (n: number, min: number) => Number.isInteger(n) && n >= min;
  if (!inteiro(l.adultos, 1)) p.push('sem adultos');
  if (!inteiro(l.criancas0_6, 0) || !inteiro(l.criancas7_9, 0)) p.push('quantidade de crianças inválida');
  if (l.adultos + l.criancas0_6 + l.criancas7_9 > MAXIMO_POR_APARTAMENTO) p.push(`mais de ${MAXIMO_POR_APARTAMENTO} pessoas num apartamento`);
  return p;
}

/** Problemas de CONTEUDO: o link diz o que o hospede pediu? */
export function problemasDeConteudo(url: string, esperado: Esperado, umApartamento: boolean): string[] {
  const l = lerLink(url);
  if (!l) return [];
  const p: string[] = [];
  if (esperado.periodos && esperado.periodos.length) {
    const casa = esperado.periodos.some((x) => x.checkin === l.checkin && x.checkout === l.checkout);
    if (!casa) {
      const pedido = esperado.periodos.map((x) => `${br(x.checkin)} a ${br(x.checkout)}`).join(' ou ');
      p.push(`período ${br(l.checkin)} a ${br(l.checkout)}, mas o hóspede pediu ${pedido}`);
    }
  }
  if (esperado.noites && ehDataIso(l.checkin) && ehDataIso(l.checkout)) {
    const n = noitesEntre(l.checkin, l.checkout);
    if (n !== esperado.noites) p.push(`${n} diária(s) no link, mas o hóspede pediu ${esperado.noites}`);
  }
  if (umApartamento && esperado.ocupacao) {
    const o = esperado.ocupacao;
    if (o.adultos !== l.adultos || o.criancas0_6 !== l.criancas0_6 || o.criancas7_9 !== l.criancas7_9) {
      p.push(
        `ocupação ${l.adultos} adulto(s) + ${l.criancas0_6} criança(s) 0-6 + ${l.criancas7_9} de 7-9, ` +
          `mas o hóspede escreveu ${o.adultos} + ${o.criancas0_6} + ${o.criancas7_9}`,
      );
    }
  }
  return p;
}

/** Resumo legivel do link, para o atendente conferir de olho. */
export function resumoDoLink(url: string): string {
  const l = lerLink(url);
  if (!l) return '';
  const partes = [`${br(l.checkin)} a ${br(l.checkout)}`, `${l.adultos} adulto(s)`];
  if (l.criancas0_6) partes.push(`${l.criancas0_6} criança(s) 0-6`);
  if (l.criancas7_9) partes.push(`${l.criancas7_9} criança(s) 7-9`);
  return partes.join(' · ');
}
