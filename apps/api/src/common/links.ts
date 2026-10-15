/**
 * As travas do LINK, num lugar que os dois caminhos alcancam.
 *
 * Elas nasceram no modulo do atendimento (a extensao do WhatsApp) e por isso
 * o caminho dos CANAIS - Instagram, Facebook, WhatsApp oficial - nunca as
 * teve. Em 15/10/2026, no primeiro teste real pelo Messenger, a Bella montou
 * o link certo no servidor e o modelo o reescreveu num formato inventado:
 *
 *   enviado:  ...hotelbosque?checkin=2026-10-18&checkout=2026-10-20&adultos=2
 *   correto:  ...hotelbosque/pt-br/reserva/busca/?...&adultos-000001=2&...
 *
 * Um endereco assim parece certo e nao leva a lugar nenhum - pior do que nao
 * mandar link. Como o modulo do atendimento depende do modulo da Bella, nao
 * dava para importar de volta sem fechar um ciclo; entao as funcoes vieram
 * para ca, e os dois lados importam daqui.
 */

/**
 * Garante que os links da resposta sejam os NOSSOS.
 *
 * Caso real (04/09/2026): a Bella enviou
 * "/hotelbosque/resultado?checkin=2023-09-08&adultos=2&criancas=0" - endereco
 * inventado, com caminho que nao existe, parametros errados e ano 2023. O
 * modelo escreveu uma URL de memoria em vez de usar a que o servidor montou.
 * Instrucao no prompt nao basta: aqui a troca e feita no codigo.
 *
 * - Havendo UM link oficial, qualquer endereco do motor vira ele.
 * - Havendo VARIOS (um por apartamento), so os oficiais sobrevivem; um link
 *   inventado no meio deles e removido.
 * - Nao havendo nenhum, todo link do motor sai da mensagem: se nao montamos um
 *   link, e porque ainda falta dado - mandar qualquer coisa e pior que nada.
 */
export function corrigirLinks(texto: string, oficiais: string[]): string {
  // Sem exigir o "https://": ela ja escreveu "sbreserva.silbeck.com.br/hotelbosque"
  // cru, sem protocolo, e o endereco escapou desta troca inteira - o hospede
  // recebeu a home do motor em vez do orcamento com as datas dele.
  const doMotor = /(?:https?:\/\/)?(?:www\.)?sbreserva\.silbeck\.com\.br\/\S*/gi;
  const achados = texto.match(doMotor);
  if (!achados) return texto;

  if (oficiais.length === 1) {
    return texto.replace(doMotor, oficiais[0]);
  }

  if (oficiais.length > 1) {
    const validos = new Set(oficiais);
    return texto.replace(doMotor, (url) => (validos.has(url) ? url : ''));
  }

  // Sem link oficial: remove o endereco e a linha que ficaria orfa.
  return texto
    .replace(doMotor, '')
    .split('\n')
    .filter((l, i, arr) => !(l.trim() === '' && arr[i - 1] !== undefined && arr[i - 1].trim() === ''))
    .join('\n');
}

/**
 * A resposta promete um link? Entao o link tem que estar la.
 *
 * Caso real (09/09/2026): "Para verificar os valores e a disponibilidade para
 * 10/11 a 12/11 para 2 adultos e 1 crianca de 8 anos, voce pode acessar o link
 * abaixo" - e abaixo nao havia nada. O modelo escreveu um endereco inventado,
 * corrigirLinks tirou (certo, era falso) e sobrou a promessa sozinha. Do lado
 * do hospede isso e pior que nao responder: ele fica procurando o que nao veio.
 *
 * Duas situacoes, duas saidas:
 *
 * - Temos link oficial e o texto ficou sem nenhum: o link entra no fim. E o
 *   endereco certo, montado pelo servidor - nao ha por que perder a resposta.
 * - Nao temos link algum: a promessa e apagada. Nada de "segue o link abaixo"
 *   quando nao existe link para seguir.
 */
export function garantirLink(texto: string, oficiais: string[]): string {
  // Link de mentira: "[LINK PARA RESERVA AQUI]".
  //
  // Caso real (16/09/2026): sem ocupacao o servidor nao montou link, e o modelo
  // preencheu o buraco com um marcador em colchetes. Nao e URL, entao passava
  // por todas as travas - e o hospede receberia literalmente isso. Com link
  // oficial em maos, o marcador vira o link; sem ele, sai da mensagem junto com
  // a promessa.
  const marcador = /[\[\(<][^\]\)>\n]*\blinks?\b[^\]\)>\n]*[\]\)>]/gi;
  if (marcador.test(texto)) {
    texto = oficiais.length ? texto.replace(marcador, oficiais[0]) : texto.replace(marcador, '');
  }

  const temLink = /https?:\/\//.test(texto);

  if (oficiais.length && !temLink) {
    const faltando = oficiais.filter((u) => !texto.includes(u));
    return (texto.trimEnd() + '\n\n' + faltando.join('\n\n')).trim();
  }

  if (!oficiais.length && !temLink) {
    // Frases que so fazem sentido acompanhadas de um endereco. "Link" nao
    // basta: no caso de 09/09/2026 ela escreveu "fazer a sua reserva
    // diretamente pelo nosso site:" - promessa igual, palavra diferente.
    const prometeLink =
      /(segue|abaixo|a seguir|neste|nesse|clicando|acesse|acessar|através d|diretamente)[^.!?\n]*\b(links?|site|endereço)\b/i;
    const prometeSite = /\b(links?|site)\b[^.!?\n]*(abaixo|a seguir)|(pelo|no|em) nosso site\s*:?\s*$/i;
    const linhas = texto.split('\n').filter((l) => !prometeLink.test(l) && !prometeSite.test(l));
    return linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  return texto;
}
