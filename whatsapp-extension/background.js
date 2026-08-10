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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'LOGIN') {
        await chrome.storage.local.set({ apiUrl: msg.apiUrl, email: msg.email, password: msg.password });
        await login();
        sendResponse({ ok: true });
      } else if (msg.type === 'QUICK_REPLIES') {
        const list = await authed(`/api/quick-replies?hotelId=${HOTEL_ID}`);
        sendResponse({ ok: true, data: list });
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
