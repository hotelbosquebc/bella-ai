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
  panel.querySelector('#bella-suggest').onclick = async () => {
    const { conversation, lastMessage } = scrapeConversation();
    if (!conversation) {
      status('Abra uma conversa com mensagens primeiro.', true);
      return;
    }
    status('Pensando… (pode levar alguns segundos)');
    const r = await send('SUGGEST', { conversation, lastMessage });
    if (!r || !r.ok) {
      status(r ? r.error : 'Falha ao sugerir.', true);
      return;
    }
    status('');
    panel.querySelector('#bella-suggestion').style.display = 'block';
    panel.querySelector('#bella-sugtext').value = r.data.suggestion || '';
  };

  panel.querySelector('#bella-insert').onclick = () => {
    const t = panel.querySelector('#bella-sugtext').value;
    if (t) insertText(t);
  };

  loadQuickReplies();
})();
