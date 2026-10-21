'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { CHANNEL_LABELS, SENDER_LABELS } from '../../lib/config';
import { apiFetch } from '../../lib/api';

type Guest = { id: string; name?: string; phone?: string; email?: string; city?: string; language?: string };
type Message = { id: string; sender: string; content: string; timestamp: string };
type Conversation = {
  id: string;
  channel: string;
  status: string;
  guest: Guest;
  messages: Message[];
  /** Preenchido quando foi a BELLA que pediu ajuda (null se o atendente assumiu). */
  escalationReason?: string | null;
};
type ConversationDetail = Conversation & {
  guest: Guest & { reservations?: any[]; leads?: any[] };
};

/** Guia de grupos e excursoes (pedido do dono, 21/10/2026): a Bella nao atende. */
type ContatoMarcado = { id: string; identificador?: string | null; nome?: string | null; tipo: string; cor: string };

const CORES_DE_GUIA = ['#7c3aed', '#db2777', '#ea580c', '#0284c7'];

/** Mesma comparacao do servidor (common/contatos-marcados.ts): DDD + 8 ultimos digitos. */
function telefoneCanonico(v?: string | null) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d;
}

function marcaDe(marcados: ContatoMarcado[], guest?: Guest): ContatoMarcado | null {
  if (!guest) return null;
  const tel = telefoneCanonico(guest.phone);
  const nome = (guest.name || '').trim().toLowerCase();
  return (
    marcados.find((m) => {
      const mTel = telefoneCanonico(m.identificador);
      if (tel.length >= 8 && mTel.length >= 8 && tel === mTel) return true;
      if (guest.phone && m.identificador && guest.phone === m.identificador) return true;
      return Boolean(nome && m.nome && m.nome.trim().toLowerCase() === nome);
    }) ?? null
  );
}

const bubbleClass = (sender: string) =>
  sender === 'GUEST' ? 'guest' : sender === 'HUMAN_AGENT' ? 'agent' : 'bella';

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [quickReplies, setQuickReplies] = useState<{ id: string; shortcut: string; title: string; content: string }[]>([]);
  // Em ref, e nao em estado: o temporizador e criado uma vez e precisa enxergar
  // a conversa ATUAL, nao a que estava aberta quando ele nasceu.
  const selectedId = useRef<string | null>(null);
  const [marcados, setMarcados] = useState<ContatoMarcado[]>([]);

  const loadMarcados = useCallback(async () => {
    try {
      const res = await apiFetch('/api/contatos-marcados', { cache: 'no-store' });
      if (res.ok) setMarcados(await res.json());
    } catch {
      /* sem a lista, as conversas so aparecem sem cor */
    }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const url = '/api/conversations' + (filter ? `?channel=${filter}` : '');
      const res = await apiFetch(url, { cache: 'no-store' });
      setConversations(res.ok ? await res.json() : []);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadList();
    loadMarcados();
  }, [loadList, loadMarcados]);

  // A lista so carregava ao abrir a pagina e no botao Atualizar: mensagem
  // nova NAO aparecia sozinha. Numa recepcao isso significa hospede
  // esperando sem ninguem saber. De 15 em 15 segundos a lista se refaz, e
  // a conversa aberta junto.
  useEffect(() => {
    const t = setInterval(() => {
      loadList();
      if (selectedId.current) refreshSelected(selectedId.current);
    }, 15000);
    return () => clearInterval(t);
  }, [loadList]);

  // Quantas conversas a Bella passou para a recepcao e ainda ninguem tocou.
  const aguardando = conversations.filter((c) => c.escalationReason).length;

  // O numero no titulo da aba: e o unico aviso que funciona com a aba em
  // segundo plano, que e exatamente onde o painel vai ficar o dia todo.
  useEffect(() => {
    document.title = (aguardando > 0 ? `(${aguardando}) ` : '') + 'Caixa de Entrada — Bella';
  }, [aguardando]);

  useEffect(() => {
    apiFetch('/api/quick-replies?hotelId=hotel-do-bosque', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setQuickReplies)
      .catch(() => {});
  }, []);

  // Sugestões quando o atendente digita "/atalho"
  const qrMatches =
    draft.startsWith('/')
      ? quickReplies.filter((q) => {
          const term = draft.slice(1).toLowerCase();
          return q.shortcut.toLowerCase().includes(term) || q.title.toLowerCase().includes(term);
        })
      : [];

  async function openConversation(id: string) {
    selectedId.current = id;
    await refreshSelected(id);
  }

  /** Recarrega a conversa aberta. Nao toca no campo de digitacao. */
  async function refreshSelected(id: string) {
    const res = await apiFetch(`/api/conversations/${id}`, { cache: 'no-store' });
    if (res.ok) setSelected(await res.json());
  }

  async function send() {
    if (!draft.trim() || !selected) return;
    setSending(true);
    try {
      await apiFetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: selected.id, content: draft.trim() }),
      });
      setDraft('');
      await openConversation(selected.id);
      await loadList();
    } finally {
      setSending(false);
    }
  }

  async function takeover() {
    if (!selected) return;
    await apiFetch(`/api/conversations/${selected.id}/takeover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    await openConversation(selected.id);
    await loadList();
  }

  /** Marca (ou desmarca) o contato aberto como guia de grupos e excursoes. */
  async function marcarGuia(cor: string | null) {
    if (!selected) return;
    const atual = marcaDe(marcados, selected.guest);
    if (cor === null) {
      if (atual) await apiFetch(`/api/contatos-marcados/${atual.id}`, { method: 'DELETE' });
    } else {
      await apiFetch('/api/contatos-marcados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identificador: selected.guest.phone || null,
          nome: selected.guest.name || null,
          tipo: 'guia',
          cor,
        }),
      });
    }
    await loadMarcados();
  }

  async function release() {
    if (!selected) return;
    await apiFetch(`/api/conversations/${selected.id}/release`, { method: 'POST' });
    await openConversation(selected.id);
    await loadList();
  }

  return (
    <>
      <h1>Caixa de Entrada Unificada</h1>
      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todos os canais</option>
          {Object.entries(CHANNEL_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button className="btn ghost" onClick={loadList}>Atualizar</button>
        {aguardando > 0 && (
          <span className="badge amber">
            {aguardando} {aguardando === 1 ? 'conversa esperando você' : 'conversas esperando você'}
          </span>
        )}
      </div>

      <div className="inbox">
        {/* Coluna 1 — conversas */}
        <div className="panel">
          <strong>Conversas {conversations.length > 0 && <span className="col-count">{conversations.length}</span>}</strong>
          {loading && <p className="muted" style={{ marginTop: 12 }}>Carregando…</p>}
          {!loading && conversations.length === 0 && (
            <p className="muted" style={{ marginTop: 12 }}>
              Nenhuma conversa ainda. Quando um hóspede escrever por qualquer canal, aparecerá aqui.
            </p>
          )}
          <div style={{ marginTop: 12 }}>
            {conversations.map((c) => {
              const guia = marcaDe(marcados, c.guest);
              return (
              <div
                key={c.id}
                className={`conv-item${selected?.id === c.id ? ' active' : ''}`}
                onClick={() => openConversation(c.id)}
                style={guia ? { borderLeft: `5px solid ${guia.cor}`, background: `${guia.cor}1f` } : undefined}
              >
                <div className="conv-name">
                  <span>{c.guest?.name || c.guest?.phone || 'Hóspede'}</span>
                  <span className="badge">{CHANNEL_LABELS[c.channel] ?? c.channel}</span>
                </div>
                {guia && (
                  <div className="badge" style={{ marginTop: 4, background: guia.cor, color: '#fff' }}>
                    🧭 Guia de grupos e excursões
                  </div>
                )}
                {c.escalationReason && (
                  <div className="badge amber" style={{ marginTop: 4 }}>
                    🔔 a Bella pediu ajuda — {c.escalationReason}
                  </div>
                )}
                <div className="conv-preview">{c.messages?.[0]?.content ?? '—'}</div>
              </div>
              );
            })}
          </div>
        </div>

        {/* Coluna 2 — chat */}
        <div className="panel chat-col">
          {!selected && <p className="muted">Selecione uma conversa para visualizar.</p>}
          {selected && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                <strong>
                  {selected.guest?.name || selected.guest?.phone}
                  {selected.status === 'PENDING_HUMAN' && (
                    <span className="badge amber" style={{ marginLeft: 8 }}>
                      {selected.escalationReason ? 'A Bella pediu ajuda' : 'Você no controle'}
                    </span>
                  )}
                </strong>
                {selected.status === 'PENDING_HUMAN' ? (
                  <button className="btn ghost" onClick={release} title="A Bella volta a responder automaticamente">
                    ↩️ Devolver para a Bella
                  </button>
                ) : (
                  <button className="btn" onClick={takeover} title="Você assume; a Bella para de responder aqui">
                    ✋ Assumir controle
                  </button>
                )}
              </div>
              <div className="chat-stream">
                {selected.messages.map((m) => (
                  <div key={m.id} className={`bubble ${bubbleClass(m.sender)}`}>
                    <div className="who">{SENDER_LABELS[m.sender] ?? m.sender}</div>
                    {m.content}
                  </div>
                ))}
              </div>
              {qrMatches.length > 0 && (
                <div className="qr-picker">
                  {qrMatches.slice(0, 6).map((q) => (
                    <div key={q.id} className="qr-item" onClick={() => setDraft(q.content)}>
                      <strong>/{q.shortcut}</strong> <span className="muted">{q.title}</span>
                      <div className="qr-preview">{q.content}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="chat-compose">
                <input
                  placeholder="Escreva como atendente… (digite / para respostas rápidas)"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                />
                <button className="btn" onClick={send} disabled={sending}>
                  {sending ? 'Enviando…' : 'Enviar'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Coluna 3 — perfil */}
        <div className="panel">
          <strong>Perfil do Hóspede</strong>
          {!selected && <p className="muted" style={{ marginTop: 12 }}>Histórico, reservas e preferências.</p>}
          {selected && (
            <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.8 }}>
              <div><span className="muted">Nome:</span> {selected.guest.name || '—'}</div>
              <div><span className="muted">Telefone:</span> {selected.guest.phone || '—'}</div>
              <div><span className="muted">E-mail:</span> {selected.guest.email || '—'}</div>
              <div><span className="muted">Cidade:</span> {selected.guest.city || '—'}</div>
              <div><span className="muted">Idioma:</span> {selected.guest.language || '—'}</div>
              <div style={{ marginTop: 12 }}>
                <span className="muted">Reservas:</span> {selected.guest.reservations?.length ?? 0}
              </div>
              <div>
                <span className="muted">Leads:</span> {selected.guest.leads?.length ?? 0}
              </div>
              {(() => {
                const guia = marcaDe(marcados, selected.guest);
                return (
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
                    <strong style={{ fontSize: 14 }}>🧭 Guia de grupos e excursões</strong>
                    <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: '4px 0 8px' }}>
                      {guia
                        ? 'Marcado. A Bella não responde a este contato: a conversa vai direto para a equipe.'
                        : 'Marque quem organiza grupos e excursões. A Bella passa direto para a equipe, e o contato ganha uma cor própria aqui e no WhatsApp Web.'}
                    </p>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {CORES_DE_GUIA.map((cor) => (
                        <button
                          key={cor}
                          onClick={() => marcarGuia(cor)}
                          title={guia ? 'Trocar a cor' : 'Marcar com esta cor'}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: cor,
                            border: guia?.cor === cor ? '3px solid #111827' : '2px solid #fff',
                            boxShadow: '0 0 0 1px #d1d5db',
                            cursor: 'pointer',
                          }}
                        />
                      ))}
                      {guia && (
                        <button className="btn ghost" onClick={() => marcarGuia(null)}>
                          Desmarcar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
