/**
 * Teto de tamanho de mensagem, por canal.
 *
 * O Instagram corta em 1.000 BYTES - nao caracteres. Acento ocupa dois bytes,
 * e as respostas da Bella sao cheias deles. Uma resposta de 4 apartamentos,
 * com 4 links do Silbeck (~130 caracteres cada), passa do teto com folga: a
 * API recusa e o hospede nao recebe NADA. Pior que uma resposta cortada e uma
 * resposta que nao chega.
 */
export const LIMITE_POR_CANAL: Record<string, number> = {
  INSTAGRAM: 1000,
  FACEBOOK: 2000,
  WHATSAPP: 4096,
  TELEGRAM: 4096,
};

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

/**
 * Corte duro, por BYTES, respeitando caractere.
 *
 * Ultimo recurso: texto corrido sem paragrafo, linha nem frase. Cortar no meio
 * de um caractere acentuado produziria bytes invalidos, entao a conta e feita
 * caractere a caractere.
 */
function cortarPorBytes(texto: string, limite: number): string[] {
  const partes: string[] = [];
  let atual = '';
  for (const c of texto) {
    if (bytes(atual + c) > limite) {
      partes.push(atual);
      atual = '';
    }
    atual += c;
  }
  if (atual) partes.push(atual);
  return partes;
}

/**
 * Divide a mensagem em pedacos que cabem no canal, cortando onde faz sentido.
 *
 * A ordem das tentativas importa para o hospede: primeiro por paragrafo,
 * depois por linha, depois por frase, e so em ultimo caso no meio do texto.
 * Um LINK nunca pode ser partido - chega quebrado e nao abre -, entao linha
 * que contenha link vai inteira, mesmo que estoure um pouco.
 */
export function dividirMensagem(texto: string, limite: number): string[] {
  const inteiro = (texto || '').trim();
  if (!inteiro) return [];
  if (bytes(inteiro) <= limite) return [inteiro];

  const pedacos: string[] = [];
  let atual = '';

  const empurrar = () => {
    if (atual.trim()) pedacos.push(atual.trim());
    atual = '';
  };

  for (const paragrafo of inteiro.split(/\n{2,}/)) {
    const candidato = atual ? atual + '\n\n' + paragrafo : paragrafo;
    if (bytes(candidato) <= limite) {
      atual = candidato;
      continue;
    }
    empurrar();

    if (bytes(paragrafo) <= limite) {
      atual = paragrafo;
      continue;
    }

    // Paragrafo sozinho ja estoura: quebra por linha, mantendo link inteiro.
    for (const linha of paragrafo.split(/\n/)) {
      const comLinha = atual ? atual + '\n' + linha : linha;
      if (bytes(comLinha) <= limite) {
        atual = comLinha;
        continue;
      }
      empurrar();
      if (bytes(linha) <= limite || /https?:\/\//.test(linha)) {
        atual = linha; // link vai inteiro mesmo estourando: partido nao abre
        continue;
      }
      // Linha enorme e sem link: corta por frase.
      for (const frase of linha.split(/(?<=[.!?])\s+/)) {
        const comFrase = atual ? atual + ' ' + frase : frase;
        if (bytes(comFrase) <= limite) {
          atual = comFrase;
        } else {
          empurrar();
          if (bytes(frase) <= limite) {
            atual = frase;
          } else {
            // Frase sozinha estoura: nao ha mais onde quebrar com sentido.
            const duros = cortarPorBytes(frase, limite);
            pedacos.push(...duros.slice(0, -1));
            atual = duros[duros.length - 1] || '';
          }
        }
      }
    }
  }
  empurrar();
  return pedacos;
}
