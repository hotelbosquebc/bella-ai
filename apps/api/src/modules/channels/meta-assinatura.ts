import { createHmac, timingSafeEqual } from 'crypto';

/**
 * A chamada veio mesmo da Meta?
 *
 * O webhook precisa ser publico: a Meta chama sem o nosso login. Sem conferir
 * nada, porem, qualquer um que descubra o endereco consegue fingir ser a Meta,
 * inventar uma mensagem de hospede e fazer a Bella RESPONDER - em nome do
 * hotel, para o destinatario que o atacante escolher, gastando a cota da IA.
 *
 * A Meta assina cada chamada com HMAC-SHA256 do corpo CRU, usando o segredo do
 * app, e manda no cabecalho `x-hub-signature-256: sha256=<hex>`.
 *
 * Dois cuidados que parecem detalhe e nao sao:
 *
 * - o HMAC e do corpo CRU, byte a byte. Se usarmos o JSON ja interpretado e
 *   remontado, a assinatura nunca bate (ordem de chaves, espacos, acentos).
 * - a comparacao e com timingSafeEqual, nao com ===. Comparar texto sai mais
 *   cedo no primeiro byte diferente, e esse tempo conta quanto do segredo o
 *   atacante acertou.
 *
 * Sem segredo configurado, devolve false: melhor o webhook recusar tudo e
 * aparecer no log do que aceitar tudo calado.
 */
export function assinaturaDaMetaConfere(
  corpoCru: Buffer | string | undefined,
  cabecalho: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !cabecalho || corpoCru === undefined) return false;

  const partes = String(cabecalho).split('=');
  if (partes.length !== 2 || partes[0] !== 'sha256') return false;
  const recebida = partes[1].trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(recebida)) return false;

  const corpo = Buffer.isBuffer(corpoCru) ? corpoCru : Buffer.from(corpoCru, 'utf8');
  const nossa = createHmac('sha256', appSecret).update(corpo).digest('hex');

  const a = Buffer.from(nossa, 'hex');
  const b = Buffer.from(recebida, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
