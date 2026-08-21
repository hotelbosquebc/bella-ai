/* Painel co-piloto dentro do WhatsApp Web. NÃO envia nada — só ajuda o atendente. */
(function () {
  if (window.__bellaPanel) return;
  window.__bellaPanel = true;

  // ---------- utilidades ----------

  /**
   * Ao recarregar a extensão, ESTE script continua vivo na aba já aberta, mas
   * perde a ponte com o service worker ("Extension context invalidated"). Como
   * ele reconsulta o modo de minuto em minuto, isso virava um erro por minuto
   * até alguém dar F5 — enchendo o botão "Erros" do Chrome de ruído.
   * Ao detectar o contexto morto paramos os timers e avisamos na tela.
   */
  let contextoMorto = false;

  function encerrarPorContextoMorto() {
    if (contextoMorto) return;
    contextoMorto = true;
    clearInterval(window.__bellaTimerModo);
    const el = document.getElementById('bella-modo');
    if (el) el.textContent = '⚠️ Extensão atualizada — recarregue a página (F5)';
  }

  function send(type, extra) {
    return new Promise((resolve) => {
      // chrome.runtime.id some quando o contexto é invalidado.
      if (contextoMorto || !chrome.runtime || !chrome.runtime.id) {
        encerrarPorContextoMorto();
        return resolve(null);
      }
      try {
        chrome.runtime.sendMessage({ type, ...extra }, (resposta) => {
          if (chrome.runtime.lastError) {
            encerrarPorContextoMorto();
            return resolve(null);
          }
          resolve(resposta);
        });
      } catch (_) {
        encerrarPorContextoMorto();
        resolve(null);
      }
    });
  }

  function composeBox() {
    return (
      document.querySelector('footer div[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"][data-tab]')
    );
  }

  /**
   * Insere o texto na caixa de mensagem PRESERVANDO as quebras de linha.
   *
   * `execCommand('insertText')` sozinho DESCARTA os "\n" no contenteditable do
   * WhatsApp Web: a mensagem chegava certa no painel da Bella e virava um bloco
   * corrido depois de inserida, sem as linhas em branco entre os parágrafos.
   *
   * Caminho principal: evento de colagem com text/plain — o editor do WhatsApp
   * trata o paste e cria as quebras sozinho. Se ele ignorar o evento, caímos
   * para a inserção linha a linha, criando cada quebra explicitamente.
   */
  function insertText(text) {
    const box = composeBox();
    if (!box) {
      alert('Abra uma conversa no WhatsApp antes de inserir a mensagem.');
      return;
    }
    box.focus();

    const normalizado = String(text).replace(/\r\n?/g, '\n');

    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', normalizado);
      const ev = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      box.dispatchEvent(ev);
      // O WhatsApp cancela o evento quando de fato o processou.
      if (ev.defaultPrevented) return;
    } catch (_) {
      /* navegador barrou o ClipboardEvent — usa o caminho abaixo */
    }

    const linhas = normalizado.split('\n');
    linhas.forEach((linha, i) => {
      if (i > 0) document.execCommand('insertLineBreak');
      if (linha) document.execCommand('insertText', false, linha);
    });
  }

  /**
   * Memoria local da conversa.
   *
   * O WhatsApp Web NAO mantem o historico: em muitas conversas ele guarda uma
   * unica mensagem e o resto fica so no celular, sem nem oferecer o aviso de
   * carregar mensagens antigas. A Bella respondia sem ter visto o que o hospede
   * escreveu - nem ajuste de prompt nem rolagem resolvem isso.
   *
   * Aqui a extensao guarda o que JA passou pela tela, por conversa, e devolve
   * isso como contexto. Nao recupera o passado, mas a partir de agora nada do
   * que aparece se perde. Leitura local: nada e enviado ao hospede.
   */
  const HIST_MAX = 80;

  /**
   * Chave da conversa no storage.
   *
   * ATENCAO - bug corrigido na 1.1.6: antes isso caia em 'hist:desconhecida'
   * quando o titulo nao era lido, e TODAS as conversas passavam a dividir o
   * mesmo balde. O resultado foi a Bella citar, para um contato, a estadia de
   * outro hospede. Sem identificacao segura da conversa nao se grava nada.
   */
  function chaveConversa() {
    const t = tituloDaConversa();
    return t ? 'hist:' + t : null;
  }

  /** '13/08/2026' + '10:02' -> '202608131002', para ordenar cronologicamente. */
  function ordemDe(d, h) {
    if (!d) return '999999999999';
    const p = d.split('/');
    const ano = p[2] && p[2].length === 2 ? '20' + p[2] : p[2];
    return ano + p[1].padStart(2, '0') + p[0].padStart(2, '0') + (h || '00:00').replace(':', '');
  }

  function lerHistorico(chave) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.get([chave], function (o) { resolve((o && o[chave]) || []); }); }
      catch (_) { resolve([]); }
    });
  }

  function gravarHistorico(chave, lista) {
    return new Promise(function (resolve) {
      try { var d = {}; d[chave] = lista.slice(-HIST_MAX); chrome.storage.local.set(d, resolve); }
      catch (_) { resolve(); }
    });
  }

  /** Junta o que esta na tela com o que ja foi visto antes, sem duplicar. */
  async function mesclarHistorico(atuais) {
    if (!document.querySelector('#main')) return atuais || [];
    const chave = chaveConversa();
    if (!chave) return atuais || [];
    const anterior = await lerHistorico(chave);
    const mapa = new Map();
    anterior.concat(atuais || []).forEach(function (m) { if (m && m.linha) mapa.set(m.linha, m); });
    const juntas = [...mapa.values()].sort(function (a, b) { return a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : 0; });
    await gravarHistorico(chave, juntas);
    return juntas;
  }

  /** Nome/título do contato da conversa aberta (usado para saber quem falou). */
  function tituloDaConversa() {
    const hdr = document.querySelector('#main header');
    if (!hdr) return null;
    const generico = /clique para|conta comercial|^online$|digitando|adicionar a lista|adicionar à lista|salvar contato/i;
    // O span[title] sumiu em versoes recentes do WhatsApp Web; a 1a linha do
    // cabecalho e o nome da conversa e sobreviveu as mudancas de marcacao.
    const linhas = (hdr.innerText || '').split(String.fromCharCode(10))
      .map((x) => x.trim())
      .filter((x) => x && !generico.test(x));
    if (linhas[0]) return linhas[0];
    const cands = [...hdr.querySelectorAll('span[title]')]
      .map((s) => s.getAttribute('title'))
      .filter((t) => t && !generico.test(t));
    return cands[0] || null;
  }

  /**
   * Carrega o histórico da conversa antes de ler.
   *
   * O WhatsApp Web só mantém no DOM as mensagens visíveis: ao abrir um chat,
   * costuma haver UMA mensagem renderizada. Sem rolar para cima, a Bella recebia
   * praticamente só a última linha e respondia sem contexto — era por isso que
   * ela repetia perguntas já respondidas.
   *
   * Rolamos para o topo algumas vezes para o WhatsApp trazer o histórico e
   * DEVOLVEMOS a rolagem ao fim, para o atendente não perder o lugar.
   */
  async function carregarHistorico(minimo) {
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));
    const conta = () => document.querySelectorAll('#main .copyable-text[data-pre-plain-text]').length;
    const alvo = minimo || 25;

    /**
     * O WhatsApp Web NÃO sincroniza o histórico sozinho: em muitas conversas
     * ele mostra uma mensagem só e um aviso "Clique neste aviso para carregar
     * mensagens mais antigas do seu celular". Sem clicar, não há nada para
     * rolar — e a Bella respondia sem contexto nenhum. Clicar traz o histórico
     * do celular (só leitura, não envia nada).
     */
    const clicarCarregarAntigas = async () => {
      const btn = [...document.querySelectorAll('#main button')].find((b) =>
        /mensagens mais antigas|older messages|mensajes m[áa]s antiguos/i.test(b.textContent || ''),
      );
      if (!btn) return false;
      const antes = conta();
      btn.click();
      await espera(1800);
      return conta() > antes;
    };

    await clicarCarregarAntigas();

    const acharScroller = () =>
      [...document.querySelectorAll('#main div')].filter((d) => d.scrollHeight > d.clientHeight + 150)[0];

    let posicaoOriginal = null;
    let semGanho = 0;
    for (let i = 0; i < 8 && conta() < alvo; i++) {
      const scroller = acharScroller();
      if (!scroller) {
        // Sem barra de rolagem ainda: pode ser que o histórico só venha pelo aviso.
        if (!(await clicarCarregarAntigas())) break;
        continue;
      }
      if (posicaoOriginal === null) posicaoOriginal = scroller.scrollTop;
      const antes = conta();
      scroller.scrollTop = 0;
      await espera(700);
      if (conta() === antes) {
        // Rolar não trouxe nada — talvez o resto esteja no celular.
        if (await clicarCarregarAntigas()) continue;
        semGanho++;
        if (semGanho >= 2) break; // chegou ao começo da conversa
      } else {
        semGanho = 0;
      }
    }

    // Devolve a rolagem para onde o atendente estava (normalmente o fim).
    const scroller = acharScroller();
    if (scroller) scroller.scrollTop = posicaoOriginal || scroller.scrollHeight;
  }

  /**
   * Lê as mensagens da conversa aberta.
   *
   * O WhatsApp Web troca classes e estrutura sem aviso — a versão anterior
   * dependia só de `div.message-in`/`span.selectable-text` e parou de achar
   * qualquer mensagem, fazendo a Bella nunca ser consultada. Aqui vamos por
   * camadas: se uma estratégia falhar, a próxima assume.
   */
  function scrapeConversation() {
    // #main é o painel da conversa aberta; evita varrer a lista de contatos
    // e o próprio painel da Bella.
    const main = document.querySelector('#main') || document.body;

    let rows = [...main.querySelectorAll('div.message-in, div.message-out')];
    if (!rows.length) rows = [...main.querySelectorAll('div[role="row"]')];
    if (!rows.length) rows = [...main.querySelectorAll('div[data-id]')];

    /** A mensagem é do hóspede (entrada) ou nossa (saída)? */
    const ehEntrada = (r) => {
      if (r.classList.contains('message-in')) return true;
      if (r.classList.contains('message-out')) return false;
      if (r.querySelector('.message-in')) return true;
      if (r.querySelector('.message-out')) return false;
      if (r.closest && r.closest('.message-in')) return true;
      if (r.closest && r.closest('.message-out')) return false;
      // Sem as classes: só mensagens NOSSAS exibem o status de entrega.
      if (r.querySelector('[data-icon^="msg-"], [aria-label*="Entregue"], [aria-label*="Lida"]')) return false;
      // data-id de mensagem própria começa com "true_" no WhatsApp.
      const id = r.getAttribute && r.getAttribute('data-id');
      if (id) return !id.startsWith('true_');
      return true;
    };

    /** Texto da mensagem, ignorando hora, nome e status. */
    const textoDe = (r) => {
      const alvo =
        r.querySelector('span.selectable-text') ||
        r.querySelector('.copyable-text span[dir]') ||
        r.querySelector('span[dir="ltr"], span[dir="auto"]') ||
        r.querySelector('.copyable-text');
      let t = alvo ? alvo.innerText : '';
      if (!t && r.innerText) t = r.innerText;
      return (t || '')
        .replace(/ /g, ' ')
        .replace(/^\s*\d{1,2}:\d{2}\s*/, '')
        .trim();
    };

    /**
     * Data da mensagem (DD/MM/AAAA), lida do atributo que o WhatsApp usa para
     * montar o texto de cópia: data-pre-plain-text="[10:02, 13/08/2026] Fulano: ".
     * É daí que sai a marcação "(hoje)", usada para a Bella se apresentar uma
     * vez por dia — a thread do WhatsApp é contínua e, sem a data, ela nunca
     * mais se apresentava depois da primeira vez.
     */
    const dataDe = (r) => {
      const el = r.querySelector('.copyable-text[data-pre-plain-text]') ||
        (r.closest && r.closest('.copyable-text[data-pre-plain-text]'));
      const attr = el && el.getAttribute('data-pre-plain-text');
      const m = attr && attr.match(/\[\d{1,2}:\d{2},\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\]/);
      return m ? m[1] : null;
    };

    const hoje = new Date().toLocaleDateString('pt-BR'); // DD/MM/AAAA

    // Caminho preferencial: cada balão de texto tem .copyable-text com o
    // atributo data-pre-plain-text="[10:02, 13/08/2026] Fulano: ", que traz
    // remetente, data e hora prontos. É mais estável que as classes
    // message-in/message-out, que esta versão do WhatsApp NÃO usa mais.
    const baloes = [...main.querySelectorAll('.copyable-text[data-pre-plain-text]')];
    if (baloes.length) {
      const titulo = tituloDaConversa();
      const msgs = [];
      const estruturado = [];
      let lastIn = '';
      for (const el of baloes) {
        const attr = el.getAttribute('data-pre-plain-text') || '';
        const m = attr.match(/\[(\d{1,2}:\d{2}),\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\]\s*(.*?):\s*$/);
        const remetente = m ? m[3] : '';
        const t = (el.innerText || '').replace(/ /g, ' ').trim();
        if (!t || t.length > 4000) continue;
        // É do hóspede quando o remetente é o próprio contato da conversa.
        const isIn = titulo ? remetente === titulo : !/hotel do bosque|recep|reserva/i.test(remetente);
        const ehHoje = m && m[2] === hoje;
        msgs.push((isIn ? 'Hóspede' : 'Nós') + (ehHoje ? ' (hoje)' : '') + ': ' + t);
        estruturado.push({ linha: msgs[msgs.length - 1], ord: ordemDe(m ? m[2] : null, m ? m[1] : null) });
        if (isIn) lastIn = t;
      }
      if (msgs.length) {
        return { conversation: msgs.slice(-30).join('\n'), lastMessage: lastIn, lidas: msgs.length, estruturado: estruturado };
      }
    }

    const msgs = [];
    let lastIn = '';
    for (const r of rows) {
      const t = textoDe(r);
      if (!t || t.length > 4000) continue;
      const isIn = ehEntrada(r);
      const ehHoje = dataDe(r) === hoje;
      msgs.push((isIn ? 'Hóspede' : 'Nós') + (ehHoje ? ' (hoje)' : '') + ': ' + t);
      if (isIn) lastIn = t;
    }

    // Se nada casou, ainda dá para mandar o texto cru do painel: é melhor a
    // Bella responder com contexto imperfeito do que não responder nada.
    if (!msgs.length && main !== document.body) {
      const cru = (main.innerText || '').trim();
      if (cru.length > 20) {
        const linhas = cru.split('\n').map((l) => l.trim()).filter(Boolean).slice(-25);
        return { conversation: linhas.join('\n'), lastMessage: linhas[linhas.length - 1] || '', bruto: true };
      }
    }

    return { conversation: msgs.slice(-25).join('\n'), lastMessage: lastIn, lidas: msgs.length };
  }

  // Diagnóstico rápido no console do WhatsApp Web: __bellaDebug()
  window.__bellaDebug = () => {
    const r = scrapeConversation();
    console.log('[Bella] mensagens lidas:', r.lidas ?? '(modo bruto)', '\n', r.conversation);
    return r;
  };

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
      <div id="bella-anexos" style="display:none"></div>
      <div id="bella-qr-title">⚡ Respostas rápidas</div>
      <div id="bella-qr">Carregando…</div>
      <div id="bella-status"></div>
    </div>`;
  document.body.appendChild(panel);

  const body = panel.querySelector('#bella-body');
  panel.querySelector('#bella-toggle').onclick = () => {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  };

  // ---------- arrastar o painel ----------
  // No canto inferior direito (posição padrão do CSS) o painel cobre o botão
  // de enviar do WhatsApp. Arrastando pelo cabeçalho o atendente o tira da
  // frente, e a posição fica guardada para as próximas vezes.
  (function tornarArrastavel() {
    const head = panel.querySelector('#bella-head');
    const CHAVE = 'bella-panel-pos';

    /** Mantém o painel dentro da tela (a janela pode ter mudado de tamanho). */
    function aplicar(left, top) {
      const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
      const l = Math.min(Math.max(0, left), maxLeft);
      const t = Math.min(Math.max(0, top), maxTop);
      // O CSS posiciona por right/bottom; ao arrastar passamos a usar left/top.
      panel.style.left = l + 'px';
      panel.style.top = t + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      return { left: l, top: t };
    }

    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (salvo && typeof salvo.left === 'number' && typeof salvo.top === 'number') {
        aplicar(salvo.left, salvo.top);
      }
    } catch (_) {
      /* posição inválida no storage — mantém o canto padrão */
    }

    let dx = 0;
    let dy = 0;
    let arrastando = false;

    // Os listeners de movimento ficam no DOCUMENT e em fase de CAPTURA: o
    // WhatsApp Web tem os próprios handlers de ponteiro (arrastar arquivo para
    // a conversa) e uma versão anterior, presa ao cabeçalho com
    // setPointerCapture, podia nunca receber o evento. Na captura nós vemos o
    // evento antes da página, então o arrasto funciona de qualquer jeito.
    function mover(e) {
      if (!arrastando) return;
      aplicar(e.clientX - dx, e.clientY - dy);
      e.preventDefault();
      e.stopPropagation();
    }

    function soltar() {
      if (!arrastando) return;
      arrastando = false;
      head.classList.remove('bella-arrastando');
      document.removeEventListener('mousemove', mover, true);
      document.removeEventListener('mouseup', soltar, true);
      const r = panel.getBoundingClientRect();
      try {
        localStorage.setItem(CHAVE, JSON.stringify({ left: r.left, top: r.top }));
      } catch (_) {
        /* storage indisponível — a posição só não persiste */
      }
    }

    head.addEventListener(
      'mousedown',
      (e) => {
        // Clique no botão de recolher não deve iniciar arrasto.
        if (e.target.closest('button')) return;
        if (e.button !== 0) return; // só botão esquerdo
        const r = panel.getBoundingClientRect();
        dx = e.clientX - r.left;
        dy = e.clientY - r.top;
        arrastando = true;
        head.classList.add('bella-arrastando');
        document.addEventListener('mousemove', mover, true);
        document.addEventListener('mouseup', soltar, true);
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );

    // Janela redimensionada: traz o painel de volta para dentro da tela.
    window.addEventListener('resize', () => {
      if (panel.style.left) {
        const r = panel.getBoundingClientRect();
        aplicar(r.left, r.top);
      }
    });
  })();

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

  // ---------- anexos (regras de pets, catálogo de ingressos) ----------

  /**
   * Coloca o arquivo no campo de anexo do WhatsApp Web.
   *
   * IMPORTANTE — por que preferimos o campo de DOCUMENTO:
   * o WhatsApp COMPRIME o que entra como "foto". As regras para pets e o
   * catalogo de ingressos sao folhas cheias de texto miudo, e chegavam
   * ilegiveis do outro lado. Enviado como documento, o arquivo vai intacto e o
   * hospede consegue ampliar. Por isso ordenamos os campos: primeiro os que
   * aceitam qualquer coisa (documento), depois os de midia.
   *
   * Em ambas as estrategias quem confirma o envio e o atendente.
   */
  function inserirArquivo(file) {
    const dt = new DataTransfer();
    dt.items.add(file);

    const candidatos = [...document.querySelectorAll('input[type="file"]')].filter((i) => {
      const aceita = (i.accept || '').toLowerCase();
      return !aceita || aceita.includes('*') || aceita.includes(file.type) || aceita.includes(file.type.split('/')[0]);
    });

    // Campo de documento primeiro; o de imagem/video fica como reserva.
    const ehMidia = (i) => /image|video/.test((i.accept || '').toLowerCase());
    candidatos.sort((a, b) => Number(ehMidia(a)) - Number(ehMidia(b)));

    for (const input of candidatos) {
      try {
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return ehMidia(input) ? 'input-midia' : 'input-documento';
      } catch (_) {
        /* tenta o proximo */
      }
    }

    // Ultimo recurso: colar na caixa de texto. So funciona para imagem, e aqui
    // o WhatsApp trata como foto - ou seja, comprime.
    if (file.type.startsWith('image/')) {
      const box = composeBox();
      if (box) {
        box.focus();
        box.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        return 'paste';
      }
    }
    return null;
  }

  async function anexar(a) {
    status(`Baixando "${a.title}"…`);
    const r = await send('FETCH_FILE', { id: a.id });
    if (!r || !r.ok) {
      status(r ? r.error : 'Falha ao baixar o anexo.', true);
      return;
    }
    const bin = atob(r.data.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const tipo = r.data.mimeType || a.mimeType;
    const ext = tipo.includes('pdf') ? '.pdf' : tipo.includes('png') ? '.png' : '.jpg';
    const file = new File([bytes], a.title.replace(/[\\/:*?"<>|]/g, '') + ext, { type: tipo });

    const via = inserirArquivo(file);
    if (via) {
      status('Arquivo anexado — confira e envie.');
    } else {
      status('Não consegui anexar automaticamente. Abra o clipe 📎 do WhatsApp e escolha o arquivo.', true);
    }
  }

  function mostrarAnexos(lista) {
    const box = panel.querySelector('#bella-anexos');
    box.innerHTML = '';
    if (!lista || !lista.length) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    lista.forEach((a) => {
      const b = document.createElement('button');
      b.className = 'bella-btn';
      b.textContent = '📎 Anexar: ' + a.title;
      b.onclick = () => anexar(a);
      box.appendChild(b);
    });
  }

  // ---------- sugerir resposta ----------
  let sugerindo = false;

  async function sugerir(automatica) {
    if (sugerindo) return; // evita duas chamadas simultâneas (clique + automática)
    // Puxa o histórico antes de ler: sem isso a Bella vê só a última mensagem.
    await carregarHistorico(25);
    const lido = scrapeConversation();
    let { conversation, lastMessage, lidas } = lido;

    // Junta com o que a extensão já viu antes nesta conversa. O WhatsApp Web
    // descarta o histórico, então sem isso a Bella responde sem saber o que o
    // hóspede escreveu ontem — ou até horas atrás.
    try {
      const juntas = await mesclarHistorico(lido.estruturado);
      if (juntas.length > (lido.estruturado || []).length) {
        conversation = juntas.slice(-40).map(function (m) { return m.linha; }).join(String.fromCharCode(10));
        lidas = juntas.length;
      }
    } catch (_) {
      /* storage indisponível — segue com o que está na tela */
    }
    if (!conversation) {
      if (!automatica) {
        // Distingue "nenhuma conversa aberta" de "não consegui LER a conversa",
        // que é falha da extensão e não do usuário.
        const temConversaAberta = Boolean(document.querySelector('#main'));
        status(
          temConversaAberta
            ? 'Não consegui ler as mensagens desta conversa — o WhatsApp Web mudou. Avise para ajustarmos.'
            : 'Abra uma conversa primeiro.',
          true,
        );
      }
      return;
    }
    sugerindo = true;
    status(
      (automatica ? 'Bella preparando sugestão…' : 'Pensando… (pode levar alguns segundos)') +
        (lidas ? ` (${lidas} msgs)` : ''),
    );
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
      mostrarAnexos(r.data.attachments);
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
    const lido = scrapeConversation();
    const { conversation } = lido;

    // Grava o que apareceu na tela mesmo que ninguém peça sugestão agora: o
    // WhatsApp Web descarta o histórico, então o que não for guardado quando
    // passa, some.
    if (conversation) {
      mesclarHistorico(lido.estruturado).catch(function () {});
    }
    if (!conversation || conversation === ultimaConversa) return;
    ultimaConversa = conversation;
    panel.querySelector('#bella-suggestion').style.display = 'none';
    panel.querySelector('#bella-sugtext').value = '';
    mostrarAnexos([]);
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
  window.__bellaTimerModo = setInterval(carregarModo, 60000);

  // Remove o balde comum criado pelo bug da 1.1.5, que misturava conversas.
  try { chrome.storage.local.remove('hist:desconhecida'); } catch (_) {}

  loadQuickReplies();
})();
