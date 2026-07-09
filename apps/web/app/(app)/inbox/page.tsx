'use client';

import { useEffect, useState, useCallback } from 'react';
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
};
type ConversationDetail = Conversation & {
  guest: Guest & { reservations?: any[]; leads?: any[] };
};

const bubbleClass = (sender: string) =>
  sender === 'GUEST' ? 'guest' : sender === 'HUMAN_AGENT' ? 'agent' : 'bella';

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

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
  }, [loadList]);

  async function openConversation(id: string) {
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
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`conv-item${selected?.id === c.id ? ' active' : ''}`}
                onClick={() => openConversation(c.id)}
              >
                <div className="conv-name">
                  <span>{c.guest?.name || c.guest?.phone || 'Hóspede'}</span>
                  <span className="badge">{CHANNEL_LABELS[c.channel] ?? c.channel}</span>
                </div>
                <div className="conv-preview">{c.messages?.[0]?.content ?? '—'}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Coluna 2 — chat */}
        <div className="panel chat-col">
          {!selected && <p className="muted">Selecione uma conversa para visualizar.</p>}
          {selected && (
            <>
              <strong style={{ marginBottom: 12 }}>
                {selected.guest?.name || selected.guest?.phone}
                {selected.status === 'PENDING_HUMAN' && <span className="badge amber" style={{ marginLeft: 8 }}>Aguardando atendente</span>}
              </strong>
              <div className="chat-stream">
                {selected.messages.map((m) => (
                  <div key={m.id} className={`bubble ${bubbleClass(m.sender)}`}>
                    <div className="who">{SENDER_LABELS[m.sender] ?? m.sender}</div>
                    {m.content}
                  </div>
                ))}
              </div>
              <div className="chat-compose">
                <input
                  placeholder="Escreva como atendente…"
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
            </div>
          )}
        </div>
      </div>
    </>
  );
}
