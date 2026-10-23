const $ = (id) => document.getElementById(id);

chrome.storage.local.get(['apiUrl', 'email'], (c) => {
  if (c.apiUrl) $('apiUrl').value = c.apiUrl;
  if (c.email) $('email').value = c.email;
});

$('save').onclick = async () => {
  const st = $('st');
  st.textContent = 'Entrando…';
  st.style.color = '#6b7a73';
  const resp = await new Promise((r) =>
    chrome.runtime.sendMessage(
      { type: 'LOGIN', apiUrl: $('apiUrl').value.trim(), email: $('email').value.trim(), password: $('password').value },
      r,
    ),
  );
  if (resp && resp.ok) {
    st.textContent = '✅ Conectado! Pode fechar esta aba e abrir o WhatsApp Web.';
    st.style.color = '#1f6f43';
  } else {
    st.textContent = '❌ ' + (resp ? resp.error : 'Falha ao entrar.');
    st.style.color = '#c0392b';
  }
};
