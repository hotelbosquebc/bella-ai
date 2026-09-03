/* Service worker: fala com a API da Bella. Guarda config e token localmente. */

const DEFAULT_API = 'https://bella-api-nh3h.onrender.com';
const HOTEL_ID = 'hotel-do-bosque';

async function getCfg() {
  const c = await chrome.storage.local.get(['apiUrl', 'email', 'password', 'token']);
  return { apiUrl: c.apiUrl || DEFAULT_API, email: c.email, password: c.password, token: c.token };
}

async function login() {
  const { apiUrl, email, password } = await getCfg();
  if (!email || !password) throw new Error('Configure e-mail e senha nas opções da extensão.');
  const res = await fetch(`${apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('Login falhou (verifique e-mail/senha nas opções).');
  const data = await res.json();
  await chrome.storage.local.set({ token: data.token });
  return data.token;
}

/** Faz uma chamada autenticada; se der 401, refaz o login uma vez. */
async function authed(path, options = {}) {
  const { apiUrl } = await getCfg();
  let { token } = await getCfg();
  if (!token) token = await login();
  const doFetch = (t) =>
    fetch(`${apiUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, ...(options.headers || {}) },
    });
  let res = await doFetch(token);
  if (res.status === 401) {
    token = await login();
    res = await doFetch(token);
  }
  if (!res.ok) throw new Error(`Erro ${res.status} em ${path}`);
  return res.json();
}

/**
 * Clique no icone da barra abre as opcoes.
 *
 * O icone anunciava "Bella - abrir configuracoes" mas nao tinha handler: nao
 * acontecia nada. E o painel, quando falta login, manda justamente "clique no
 * icone da Bella" - orientacao que nao levava a lugar nenhum. Aparece logo apos
 * instalar ou reinstalar, que e quando o storage vem vazio.
 */

/**
 * Consulta a disponibilidade no Silbeck A PARTIR DO NAVEGADOR do atendente.
 *
 * POR QUE AQUI E NAO NO SERVIDOR
 * O site e protegido por Cloudflare. Do Render (datacenter) a primeira chamada
 * volta 403 "Just a moment..." e a consulta nunca acontece - descoberto com o
 * endpoint de diagnostico. Do navegador do hotel o acesso parte de um IP
 * residencial comum e passa normalmente, como quando alguem abre o site.
 *
 * Somente leitura da busca publica: nao cria reserva nem segura apartamento.
 */
const SILBECK = 'https://sbreserva.silbeck.com.br';
const SILBECK_HOTEL = 'hotelbosque';

function dataBR(iso) {
  const p = String(iso).split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

/**
 * Cache da consulta ao Silbeck (10 min).
 *
 * Sao 4 chamadas HTTP em sequencia; repetir isso a cada clique em Sugerir na
 * MESMA conversa e puro tempo de espera para o atendente.
 */
const cacheDisponibilidade = new Map();
const TTL_DISPONIBILIDADE = 10 * 60 * 1000;

async function consultarDisponibilidadeSilbeck(params) {
  const chave = JSON.stringify(params);
  const guardado = cacheDisponibilidade.get(chave);
  if (guardado && Date.now() - guardado.ts < TTL_DISPONIBILIDADE) return guardado.valor;
  const valor = await consultarDisponibilidadeSilbeckSemCache(params);
  if (valor && valor.html) cacheDisponibilidade.set(chave, { valor: valor, ts: Date.now() });
  return valor;
}

async function consultarDisponibilidadeSilbeckSemCache({ checkin, checkout, adultos, criancas0a6, criancas7a9 }) {
  const inicial = await fetch(SILBECK + '/' + SILBECK_HOTEL + '/pt-br/reserva/', { credentials: 'include' });
  const html = await inicial.text();
  const ref = (html.match(/sbClientRef\s*=\s*'([a-f0-9]+)'/i) || [])[1];
  if (!ref) return { erro: 'token nao encontrado (status ' + inicial.status + ')' };

  const cabecalhos = {
    ChaveHotel: SILBECK_HOTEL,
    RequestLang: 'pt-br',
    'X-Client-Ref': ref,
    'X-Requested-With': 'XMLHttpRequest',
  };

  const formulario =
    'data_inicio=' + encodeURIComponent(dataBR(checkin)) +
    '&data_fim=' + encodeURIComponent(dataBR(checkout)) +
    '&categorias_hospede%5B000001%5D=' + (adultos || 1) +
    '&categorias_hospede%5B000003%5D=' + (criancas0a6 || 0) +
    '&categorias_hospede%5B000004%5D=' + (criancas7a9 || 0) +
    '&codigo_promocional=';

  const busca = await fetch(SILBECK + '/api/hotel/busca-disponibilidades', {
    method: 'POST',
    credentials: 'include',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, cabecalhos),
    body: new URLSearchParams({ urlHotel: SILBECK_HOTEL, formulario: formulario, acao: 'consultaDisponibilidade' }).toString(),
  });
  const respBusca = await busca.json().catch(() => ({}));
  if (respBusca && respBusca.erro) return { erro: respBusca.erro };

  // A sessao so passa a apontar para esta busca depois de visitar a pagina.
  const pagina = await fetch(
    SILBECK + '/' + SILBECK_HOTEL + '/pt-br/reserva/busca/?checkin=' + checkin + '&checkout=' + checkout + '&adultos-000001=' + (adultos || 1),
    { credentials: 'include' },
  );
  const htmlPagina = await pagina.text();
  const ref2 = (htmlPagina.match(/sbClientRef\s*=\s*'([a-f0-9]+)'/i) || [])[1] || ref;

  const listagem = await fetch(SILBECK + '/api/hotel/listagem', {
    credentials: 'include',
    headers: Object.assign({}, cabecalhos, { 'X-Client-Ref': ref2 }),
  });
  const dados = await listagem.json().catch(() => ({}));
  return { html: (dados && dados.html) || '' };
}

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'LOGIN') {
        await chrome.storage.local.set({ apiUrl: msg.apiUrl, email: msg.email, password: msg.password });
        await login();
        sendResponse({ ok: true });
      } else if (msg.type === 'STATUS') {
        // A Bella está ligada? Deve sugerir sozinha agora? Quem manda é o painel.
        const st = await authed(`/api/assist/status?hotelId=${HOTEL_ID}`);
        sendResponse({ ok: true, data: st });
      } else if (msg.type === 'FETCH_FILE') {
        // Baixa o anexo e devolve em base64: não dá para passar um File pelo
        // sendMessage, então o content script remonta o arquivo do outro lado.
        const { apiUrl } = await getCfg();
        const res = await fetch(`${apiUrl}/api/attachments/${msg.id}/file`);
        if (!res.ok) throw new Error(`Falha ao baixar anexo (${res.status})`);
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        sendResponse({ ok: true, data: { base64: btoa(bin), mimeType: res.headers.get('Content-Type') || '' } });
      } else if (msg.type === 'QUICK_REPLIES') {
        const list = await authed(`/api/quick-replies?hotelId=${HOTEL_ID}`);
        sendResponse({ ok: true, data: list });
      } else if (msg.type === 'TRANSCREVER') {
        // Audio do WhatsApp -> texto. O servidor ja tinha essa capacidade;
        // faltava a extensao capturar o arquivo e mandar.
        const t = await authed('/api/assist/transcrever', {
          method: 'POST',
          body: JSON.stringify({ base64: msg.base64, mimeType: msg.mimeType }),
        });
        sendResponse({ ok: true, data: t });
      } else if (msg.type === 'DISPONIBILIDADE') {
        // Consulta feita daqui porque o servidor e barrado pelo Cloudflare.
        const r = await consultarDisponibilidadeSilbeck(msg);
        sendResponse({ ok: !r.erro, data: r });
      } else if (msg.type === 'FEEDBACK') {
        // O que a Bella sugeriu x o que o atendente realmente enviou.
        // Se falhar, nao atrapalha o atendimento: e so material de treino.
        await authed('/api/assist/feedback', {
          method: 'POST',
          body: JSON.stringify({
            hotelId: HOTEL_ID,
            conversa: msg.conversa,
            acao: msg.acao,
            sugestao: msg.sugestao,
            enviado: msg.enviado,
            modelo: msg.modelo,
          }),
        });
        sendResponse({ ok: true });
      } else if (msg.type === 'SUGGEST') {
        const out = await authed(`/api/assist/suggest`, {
          method: 'POST',
          body: JSON.stringify({
            hotelId: HOTEL_ID,
            conversation: msg.conversation,
            lastMessage: msg.lastMessage,
            disponibilidadeHtml: msg.disponibilidadeHtml,
            pularDisponibilidade: msg.pularDisponibilidade,
          }),
        });
        sendResponse({ ok: true, data: out });
      } else {
        sendResponse({ ok: false, error: 'Ação desconhecida' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // resposta assíncrona
});

/**
 * Mantem a API acordada durante o expediente.
 *
 * O plano free do Render hiberna o servico depois de ~15 min sem uso, e o
 * proximo pedido paga o tempo de subir tudo de novo - dezenas de segundos. Como
 * a recepcao usa a Bella em rajadas, essa espera caia justamente em quem
 * atendia. Um ping leve a cada 10 min enquanto o WhatsApp Web estiver aberto
 * resolve, sem custo.
 */
setInterval(async () => {
  try {
    const { apiUrl } = await getCfg();
    await fetch(`${apiUrl}/api/health`, { method: "GET" });
  } catch (_) {
    /* sem rede: tenta de novo no proximo ciclo */
  }
}, 10 * 60 * 1000);
