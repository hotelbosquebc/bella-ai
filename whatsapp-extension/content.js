/* Painel co-piloto dentro do WhatsApp Web. NÃO envia nada — só ajuda o atendente. */
(function () {
  if (window.__bellaPanel) return;
  window.__bellaPanel = true;

  // ---------- utilidades ----------
  function send(type, extra) {
    return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...extra }, resolve));
  }

  function composeBox() {
    return (
      document.querySelector('footer div[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"][data-tab]')
    );
  }

  function insertText(text) {
    const box = composeBox();
    if (!box) {
      alert('Abra uma conversa no WhatsApp antes de inserir a mensagem.');
      return;
    }
    box.focus();
    // execCommand insere no contenteditable e dispara os eventos do WhatsApp
    document.execCommand('insertText', false, text);
  }

  function scrapeConversation() {
    const rows = document.querySelectorAll('div.message-in, div.message-out');
    const msgs = [];
    let lastIn = '';
    rows.forEach((r) => {
      const isIn = r.classList.contains('message-in');
      const el = r.querySelector('span.selectable-text');
      const t = el ? el.innerText.trim() : '';
      if (!t) return;
      msgs.push((isIn ? 'Hóspede: ' : 'Nós: ') + t);
      if (isIn) lastIn = t;
    });
    return { conversation: msgs.slice(-25).join('\n'), lastMessage: lastIn };
  }

  // ---------- painel ----------
  const panel = document.createElement('div');
  panel.id = 'bella-panel';
  panel.innerHTML = `
    <div id="bella-head">
      <span>🌿 Bella — assistente</span>
      <button id="bella-toggle" title="Recolher/expandir">—</button>
    </div>
    <div id="bella-body">
      <div id="bella-modo">…</div>
      <button id="bella-suggest" class="bella-btn">🤖 Sugerir resposta da Bella</button>
      <div id="bella-suggestion" style="display:none">
        <textarea id="bella-sugtext" rows="5"></textarea>
        <button id="bella-insert" class="bella-btn">Inserir no chat</button>
      </div>
      <div id="bella-qr-title">⚡ Respostas rápidas</div>
      <div id="bella-qr">Carregando…</div>
      <div id="bella-status"></div>
    </div>`;
  document.body.appendChild(panel);

  const body = panel.querySelector('#bella-body');
  panel.querySelector('#bella-toggle').onclick = () => {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  };

  const statusEl = panel.querySelector('#bella-status');
  function status(msg, err) {
    statusEl.textContent = msg || '';
    statusEl.style.color = err ? '#c0392b' : '#6b7a73';
  }

  // ---------- respostas rápidas ----------
  async function loadQuickReplies() {
    const box = panel.querySelector('#bella-qr');
    const r = await send('QUICK_REPLIES');
    if (!r || !r.ok) {
      box.innerHTML = '<span style="color:#c0392b">Configure a extensão (clique no ícone da Bella).</span>';
      return;
    }
    if (!r.data.length) {
      box.innerHTML = '<span style="opacity:.7">Nenhum atalho cadastrado.</span>';
      return;
    }
    box.innerHTML = '';
    r.data.forEach((q) => {
      const chip = document.createElement('button');
      chip.className = 'bella-chip';
      chip.textContent = '/' + q.shortcut;
      chip.title = q.content;
      chip.onclick = () => insertText(q.content);
      box.appendChild(chip);
    });
  }

  // ---------- sugerir resposta ----------
  let sugerindo = false;

  async function sugerir(automatica) {
    if (sugerindo) return; // evita duas chamadas simultâneas (clique + automática)
    const { conversation, lastMessage } = scrapeConversation();
    if (!conversation) {
      if (!automatica) status('Abra uma conversa com mensagens primeiro.', true);
      return;
    }
    sugerindo = true;
    status(automatica ? 'Bella preparando sugestão…' : 'Pensando… (pode levar alguns segundos)');
    try {
      const r = await send('SUGGEST', { conversation, lastMessage });
      if (!r || !r.ok) {
        status(r ? r.error : 'Falha ao sugerir.', true);
        return;
      }
      if (r.data.model === 'desligada') {
        status('A Bella está desligada no painel.', true);
        return;
      }
      status(automatica ? 'Sugestão pronta — revise antes de enviar.' : '');
      panel.querySelector('#bella-suggestion').style.display = 'block';
      panel.querySelector('#bella-sugtext').value = r.data.suggestion || '';
    } finally {
      sugerindo = false;
    }
  }

  panel.querySelector('#bella-suggest').onclick = () => sugerir(false);

  panel.querySelector('#bella-insert').onclick = () => {
    const t = panel.querySelector('#bella-sugtext').value;
    if (t) insertText(t);
  };

  // ---------- modo de operação (ligada / desligada / automática) ----------
  let modo = null;

  async function carregarModo() {
    const r = await send('STATUS');
    if (!r || !r.ok) return null;
    modo = r.data;
    const rotulo = { on: '🟢 Bella ligada', off: '🔴 Bella desligada', auto: '🌙 Bella automática' }[modo.mode];
    const detalhe =
      modo.mode === 'auto'
        ? modo.dentroDoHorario
          ? ' — no horário, quem atende é a equipe'
          : ' — fora do horário, sugerindo sozinha'
        : '';
    panel.querySelector('#bella-modo').textContent = rotulo + detalhe;
    panel.querySelector('#bella-suggest').style.display = modo.manualDisponivel ? 'block' : 'none';
    return modo;
  }

  /**
   * Sugere sozinha ao abrir uma conversa, quando o modo permitir. O envio
   * continua SEMPRE manual: a Bella escreve, quem manda é o atendente.
   */
  let ultimaConversa = '';
  async function aoTrocarDeConversa() {
    const { conversation } = scrapeConversation();
    if (!conversation || conversation === ultimaConversa) return;
    ultimaConversa = conversation;
    panel.querySelector('#bella-suggestion').style.display = 'none';
    panel.querySelector('#bella-sugtext').value = '';
    if (modo && modo.autoSuggest) sugerir(true);
  }

  // O WhatsApp Web troca de conversa sem recarregar a página; observamos o DOM.
  let debounce;
  new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(aoTrocarDeConversa, 1200);
  }).observe(document.body, { childList: true, subtree: true });

  carregarModo().then(() => aoTrocarDeConversa());
  // O modo muda no painel a qualquer momento — reconsulta de minuto em minuto,
  // e assim a virada do horário também entra sozinha.
  setInterval(carregarModo, 60000);

  loadQuickReplies();
})();
