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
    // Percorremos os BALOES da conversa, nao so os textos: mensagem de voz nao
    // tem .copyable-text e, se olhassemos so por ela, o audio sumiria da
    // conversa - foi por isso que a Bella parecia ignorar quem mandava audio.
    const linhasDaConversa = [...main.querySelectorAll('div[role="row"]')];
    const temTexto = main.querySelector('.copyable-text[data-pre-plain-text]');
    if (temTexto || linhasDaConversa.length) {
      const titulo = tituloDaConversa();
      const msgs = [];
      const estruturado = [];
      let lastIn = '';

      for (const row of linhasDaConversa) {
        const el = row.querySelector('.copyable-text[data-pre-plain-text]');

        let t = null;
        let m = null;
        let isIn = null;

        if (el) {
          const attr = el.getAttribute('data-pre-plain-text') || '';
          m = attr.match(/\[(\d{1,2}:\d{2}),\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\]\s*(.*?):\s*$/);
          const remetente = m ? m[3] : '';
          t = (el.innerText || '').replace(/ /g, ' ').trim();
          isIn = titulo ? remetente === titulo : !/hotel do bosque|recep|reserva/i.test(remetente);
        } else if (audiosLidos.has(row)) {
          t = audiosLidos.get(row);
          // Sem data-pre-plain-text no audio: quem envia e identificado pelo
          // data-id, que comeca com "true_" nas mensagens proprias.
          const id = row.getAttribute('data-id') || '';
          isIn = id ? !id.startsWith('true_') : !row.querySelector('[data-icon^="msg-"]');
        }

        if (!t || t.length > 4000) continue;
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



  /* ---------- audios ---------- */

  /**
   * A Bella lia apenas .copyable-text, que so existe em mensagem de TEXTO.
   * Audio chegava invisivel para ela: nem sabia que o hospede tinha falado, e
   * parecia estar ignorando. Aqui detectamos o balao de audio, capturamos o
   * arquivo e mandamos transcrever no servidor (que ja sabia fazer isso).
   *
   * Cache por src: o mesmo audio nao e transcrito duas vezes.
   */
  const transcricoes = new Map();

  /**
   * O balao e uma mensagem de voz?
   *
   * Marcacao real do WhatsApp Web (inspecionada em 22/08/2026): NAO existe
   * elemento <audio> no balao - ele so e criado quando alguem aperta play. O que
   * sempre esta la e o icone data-icon="ptt-status" e os rotulos "Mensagem de
   * voz" / "Reproduzir mensagem de voz".
   */
  function ehAudio(row) {
    const icones = [...row.querySelectorAll('[data-icon]')].map((e) => e.getAttribute('data-icon') || '');
    if (icones.some((ic) => /ptt|audio|mic/i.test(ic))) return true;
    const rotulos = [...row.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') || '');
    if (rotulos.some((r) => /mensagem de voz|recado de voz|voice message|reproduzir/i.test(r))) return true;
    return Boolean(row.querySelector('audio'));
  }

  /** Duracao que aparece no player ("0:07"), quando houver. */
  function duracaoDoAudio(row) {
    const m = (row.innerText || '').match(/\b(\d{1,2}:\d{2})\b/);
    return m ? m[1] : null;
  }

  /**
   * Converte o audio em base64 - so funciona se o WhatsApp JA tiver carregado o
   * arquivo (ou seja, se alguem tocou o audio nesta sessao).
   */
  async function audioEmBase64(row) {
    const el = row.querySelector('audio');
    const src = el && el.src;
    if (!src) return null;
    try {
      const resp = await fetch(src);
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      }
      return { base64: btoa(bin), mimeType: resp.headers.get('Content-Type') || 'audio/ogg', src: src };
    } catch (_) {
      return null;
    }
  }

  /**
   * Texto do audio para a conversa.
   *
   * Se o arquivo estiver carregado, transcreve. Se nao estiver - o caso comum,
   * porque o WhatsApp so baixa ao tocar - devolve um marcador com a duracao. O
   * importante e que a Bella SAIBA que houve um audio: antes ele era invisivel e
   * ela respondia como se o hospede nao tivesse falado nada.
   */
  async function textoDoAudio(row) {
    const dur = duracaoDoAudio(row);
    const dados = await audioEmBase64(row);

    if (!dados) {
      return '[mensagem de voz' + (dur ? ' de ' + dur : '') + ' — conteúdo não disponível]';
    }
    if (transcricoes.has(dados.src)) return transcricoes.get(dados.src);

    const r = await send('TRANSCREVER', { base64: dados.base64, mimeType: dados.mimeType });
    const texto =
      r && r.ok && r.data && r.data.texto
        ? '[áudio transcrito] ' + r.data.texto
        : '[mensagem de voz' + (dur ? ' de ' + dur : '') + ' — não foi possível transcrever]';
    transcricoes.set(dados.src, texto);
    return texto;
  }

  /**
   * Guarda o texto dos audios que estao na tela, indexado pelo balao, para que
   * o leitor da conversa possa inclui-los na ordem certa.
   */
  const audiosLidos = new Map();

  async function incluirAudios() {
    const main = document.querySelector('#main');
    if (!main) return;
    const rows = [...main.querySelectorAll('div[role="row"]')];
    for (const row of rows) {
      if (row.querySelector('.copyable-text[data-pre-plain-text]')) continue; // e texto
      if (!ehAudio(row)) continue;
      if (audiosLidos.has(row)) continue;
      audiosLidos.set(row, await textoDoAudio(row));
    }
  }

  /**
   * Escuta junto com o atendente.
   *
   * O WhatsApp so baixa a mensagem de voz quando alguem aperta play - por isso
   * nao ha <audio> no balao ate esse momento. Em vez de forcar a reproducao (o
   * que faria barulho no computador de quem atende), pegamos carona: quando o
   * atendente toca o audio para ouvir, o arquivo passa a existir e nos o
   * capturamos ali mesmo e mandamos transcrever.
   *
   * Ou seja: o atendente ouve, a Bella ouve junto. Nada e reproduzido sozinho.
   */
  document.addEventListener(
    'play',
    async function (e) {
      const el = e.target;
      if (!el || el.tagName !== 'AUDIO' || !el.src) return;
      const row = el.closest('div[role="row"]');
      if (!row) return;

      const jaTemTexto = audiosLidos.get(row);
      if (jaTemTexto && jaTemTexto.indexOf('[áudio transcrito]') === 0) return;

      status('Ouvindo o áudio junto com você…');
      const dados = await audioEmBase64(row);
      if (!dados) {
        status('');
        return;
      }
      const r = await send('TRANSCREVER', { base64: dados.base64, mimeType: dados.mimeType });
      if (r && r.ok && r.data && r.data.texto) {
        const texto = '[áudio transcrito] ' + r.data.texto;
        transcricoes.set(dados.src, texto);
        audiosLidos.set(row, texto);
        status('Áudio entendido — clique em Sugerir para a Bella responder.');
      } else {
        status('Não consegui transcrever este áudio.', true);
      }
    },
    true,
  );
  /* ---------- aprendizado: sugerido x enviado ---------- */

  /**
   * Guarda o que a Bella sugeriu e compara com o que o atendente realmente
   * mandou. E o retorno mais honesto que existe: quando o humano reescreve
   * antes de enviar, a diferenca aponta onde ela erra - sem depender de alguem
   * notar e avisar.
   *
   * Nada e enviado ao hospede por causa disso. Vai para a nossa API apenas o
   * par de textos e uma etiqueta da conversa, que o servidor guarda em hash.
   */
  let sugestaoPendente = null; // { texto, inserida, modelo }
  let ultimaNossaConhecida = null;

  function normalizarTexto(t) {
    return String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /** Quanto do texto sugerido sobreviveu ao que foi enviado (0 a 1). */
  function semelhanca(a, b) {
    const A = new Set(normalizarTexto(a).split(' ').filter(Boolean));
    const B = new Set(normalizarTexto(b).split(' ').filter(Boolean));
    if (!A.size || !B.size) return 0;
    let comuns = 0;
    A.forEach((p) => { if (B.has(p)) comuns++; });
    return comuns / Math.max(A.size, B.size);
  }

  function registrarEnvio(textoEnviado) {
    if (!sugestaoPendente || !textoEnviado) return;
    const sug = sugestaoPendente.texto;
    const sim = semelhanca(sug, textoEnviado);

    // Igual: praticamente o mesmo texto. Editada: aproveitou parte.
    // Descartada: escreveu outra coisa (ou nem inseriu a sugestao).
    let acao = 'descartada';
    if (sim >= 0.95) acao = 'igual';
    else if (sim >= 0.35 || sugestaoPendente.inserida) acao = 'editada';

    send('FEEDBACK', {
      conversa: tituloDaConversa(),
      acao: acao,
      sugestao: sug,
      enviado: textoEnviado,
      modelo: sugestaoPendente.modelo,
    });
    sugestaoPendente = null;
  }

  /**
   * Ultima mensagem NOSSA da conversa aberta.
   *
   * Le apenas o ULTIMO balao, sem remontar a conversa: esta funcao roda a cada
   * ciclo do observador e, varrendo tudo, chegou a travar o WhatsApp Web.
   */
  function ultimaNossa() {
    const baloes = document.querySelectorAll('#main .copyable-text[data-pre-plain-text]');
    if (!baloes.length) return null;
    const el = baloes[baloes.length - 1];
    const attr = el.getAttribute('data-pre-plain-text') || '';
    const m = attr.match(/]s*(.*?):s*$/);
    const remetente = m ? m[1] : '';
    const titulo = tituloDaConversa();
    const nossa = titulo ? remetente !== titulo : /hotel do bosque|recep|reserva/i.test(remetente);
    if (!nossa) return null;
    return (el.innerText || '').trim() || null;
  }

  /** Chamado quando o DOM muda: detecta que uma mensagem nossa foi enviada. */
  function verificarEnvio() {
    const atual = ultimaNossa();
    if (!atual) return;
    if (ultimaNossaConhecida === null) { ultimaNossaConhecida = atual; return; }
    if (atual !== ultimaNossaConhecida) {
      ultimaNossaConhecida = atual;
      registrarEnvio(atual);
    }
  }
  // ---------- sugerir resposta ----------
  const historicoCarregado = new Set();
  let sugerindo = false;

  async function sugerir(automatica) {
    if (sugerindo) return; // evita duas chamadas simultâneas (clique + automática)
    // Puxa o histórico antes de ler: sem isso a Bella vê só a última mensagem.
    // Rolar o historico e caro (varias rolagens de ~700ms) e so precisa ser
    // feito UMA vez por conversa: depois disso a memoria local ja guarda tudo.
    // Antes rodava a cada clique em Sugerir e sozinho respondia por boa parte
    // da demora.
    const chaveHist = tituloDaConversa();
    if (chaveHist && !historicoCarregado.has(chaveHist)) {
      historicoCarregado.add(chaveHist);
      await carregarHistorico(25);
    }
    // Traz os audios para a conversa antes de ler: sem isso a Bella nao ve
    // que o hospede mandou voz e responde como se nada tivesse chegado.
    await incluirAudios();
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

      // Segunda passagem: o servidor pede a disponibilidade porque ele proprio
      // nao alcanca o Silbeck (o Cloudflare bloqueia o datacenter). Daqui, do
      // navegador do hotel, a consulta passa normalmente.
      // O servidor devolve o pedido de disponibilidade ANTES de escrever, para
      // nao gerar o texto duas vezes. Consultamos e pedimos a resposta final.
      if (r && r.ok && r.data && r.data.precisaDisponibilidade) {
        status('Consultando disponibilidade real…');
        const d = await send('DISPONIBILIDADE', r.data.precisaDisponibilidade);
        const html = d && d.ok && d.data ? d.data.html : null;
        const r2 = await send('SUGGEST', {
          conversation: conversation,
          lastMessage: lastMessage,
          disponibilidadeHtml: html || undefined,
          // Se a consulta falhou, escreve mesmo assim - sem falar de procura.
          pularDisponibilidade: html ? undefined : true,
        });
        if (r2 && r2.ok && r2.data) r.data = r2.data;
      }
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
      // Guarda para comparar depois com o que o atendente realmente enviar.
      sugestaoPendente = r.data.suggestion
        ? { texto: r.data.suggestion, inserida: false, modelo: r.data.model }
        : null;
      mostrarAnexos(r.data.attachments);
    } finally {
      sugerindo = false;
    }
  }

  panel.querySelector('#bella-suggest').onclick = () => sugerir(false);

  panel.querySelector('#bella-insert').onclick = () => {
    const t = panel.querySelector('#bella-sugtext').value;
    if (t) {
      insertText(t);
      // O atendente pode editar depois de inserir; a comparacao final e no envio.
      if (sugestaoPendente) sugestaoPendente.inserida = true;
      else sugestaoPendente = { texto: t, inserida: true, modelo: null };
    }
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
    // Conversa nova: descarta rastreamento da anterior para nao cruzar dados.
    sugestaoPendente = null;
    ultimaNossaConhecida = null;
    panel.querySelector('#bella-suggestion').style.display = 'none';
    panel.querySelector('#bella-sugtext').value = '';
    mostrarAnexos([]);
    if (modo && modo.autoSuggest) sugerir(true);
  }

  // O WhatsApp Web troca de conversa sem recarregar a página; observamos o DOM.
  let debounce;
  new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(function () {
      verificarEnvio();
      aoTrocarDeConversa();
    }, 1200);
  }).observe(document.body, { childList: true, subtree: true });

  carregarModo().then(() => aoTrocarDeConversa());
  // O modo muda no painel a qualquer momento — reconsulta de minuto em minuto,
  // e assim a virada do horário também entra sozinha.
  window.__bellaTimerModo = setInterval(carregarModo, 60000);

  // Remove o balde comum criado pelo bug da 1.1.5, que misturava conversas.
  try { chrome.storage.local.remove('hist:desconhecida'); } catch (_) {}

  loadQuickReplies();
})();
