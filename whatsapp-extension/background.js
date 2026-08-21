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
          body: JSON.stringify({ hotelId: HOTEL_ID, conversation: msg.conversation, lastMessage: msg.lastMessage }),
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
