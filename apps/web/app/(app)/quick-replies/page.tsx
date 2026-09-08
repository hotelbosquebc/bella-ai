'use client';

import { useEffect, useState, useCallback } from 'react';
import { HOTEL_ID } from '../../lib/config';
import { apiFetch } from '../../lib/api';

type QuickReply = { id: string; shortcut: string; title: string; content: string };

type Sugerido = { tema: string; atalhoSugerido: string; vezes: number; texto: string };
type Sugeridos = { periodoDias: number; analisadas: number; sugestoes: Sugerido[] };

export default function QuickRepliesPage() {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ shortcut: '', title: '', content: '' });
  const [saving, setSaving] = useState(false);
  const [sugeridos, setSugeridos] = useState<Sugeridos | null>(null);
  const [adicionando, setAdicionando] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/quick-replies?hotelId=${HOTEL_ID}`, { cache: 'no-store' });
      setItems(res.ok ? await res.json() : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSugeridos = useCallback(async () => {
    try {
      const res = await apiFetch('/api/assist/atalhos-sugeridos?dias=60', { cache: 'no-store' });
      setSugeridos(res.ok ? await res.json() : { periodoDias: 60, analisadas: 0, sugestoes: [] });
    } catch {
      setSugeridos({ periodoDias: 60, analisadas: 0, sugestoes: [] });
    }
  }, []);

  useEffect(() => {
    load();
    loadSugeridos();
  }, [load, loadSugeridos]);

  /** Vira atalho de verdade. Some da lista de sugeridos porque ja existe. */
  async function adicionarSugerido(s: Sugerido, i: number) {
    setAdicionando(i);
    try {
      await apiFetch('/api/quick-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotelId: HOTEL_ID, shortcut: s.atalhoSugerido, title: s.tema, content: s.texto }),
      });
      await load();
      await loadSugeridos();
    } finally {
      setAdicionando(null);
    }
  }

  async function save() {
    if (!form.shortcut.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/api/quick-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotelId: HOTEL_ID, ...form, title: form.title || form.shortcut }),
      });
      setForm({ shortcut: '', title: '', content: '' });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await apiFetch(`/api/quick-replies/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <>
      <h1>Respostas Rápidas</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Atalhos de texto pronto. Na Caixa de Entrada, digite <strong>/</strong> seguido do atalho (ex.: <strong>/cafe</strong>) para inserir a mensagem.
      </p>

      <div className="form-card">
        <strong>Sugeridos pelo uso</strong>
        <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
          Respostas que a recepção já enviou várias vezes, quase iguais, para hóspedes diferentes —
          ou seja, já são atalhos, só não têm botão. Orçamentos com link e mensagens com valores
          ficam de fora de propósito: mudam a cada hóspede e envelhecem.
        </p>
        {!sugeridos && <p className="muted">Carregando…</p>}
        {sugeridos && sugeridos.sugestoes.length === 0 && (
          <p className="muted">
            Nada repetido o bastante ainda. Conforme a Bella for usada, as respostas que se repetem aparecem aqui.
          </p>
        )}
        {sugeridos?.sugestoes.map((s, i) => (
          <div key={i} style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <strong style={{ fontSize: 14 }}>{s.tema}</strong>
              <span className="muted" style={{ fontSize: 12 }}>enviada {s.vezes}x</span>
              <button
                style={{ marginLeft: 'auto' }}
                disabled={adicionando === i}
                onClick={() => adicionarSugerido(s, i)}
              >
                {adicionando === i ? 'Adicionando…' : `Criar /${s.atalhoSugerido}`}
              </button>
            </div>
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 13, margin: 0 }}>{s.texto}</p>
          </div>
        ))}
      </div>

      <div className="form-card">
        <strong>Novo atalho</strong>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="form-field">
            <label>Atalho (sem a barra)</label>
            <input value={form.shortcut} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} placeholder="ex.: cafe" />
          </div>
          <div className="form-field" style={{ flex: 2 }}>
            <label>Título (opcional)</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ex.: Horário do café" />
          </div>
        </div>
        <div className="form-field">
          <label>Mensagem</label>
          <textarea rows={3} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Texto que será inserido no chat…" />
        </div>
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar atalho'}
        </button>
      </div>

      {loading && <p className="muted">Carregando…</p>}
      {!loading && (
        <table>
          <thead>
            <tr><th>Atalho</th><th>Mensagem</th><th></th></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={3} className="muted">Nenhum atalho ainda.</td></tr>}
            {items.map((q) => (
              <tr key={q.id}>
                <td><strong>/{q.shortcut}</strong><div className="muted" style={{ fontSize: 12 }}>{q.title}</div></td>
                <td style={{ maxWidth: 480, fontSize: 13 }}>{q.content}</td>
                <td><button className="btn ghost" onClick={() => remove(q.id)}>Remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
