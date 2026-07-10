'use client';

import { useEffect, useState, useCallback } from 'react';
import { HOTEL_ID } from '../../lib/config';
import { apiFetch } from '../../lib/api';

type Contact = { id: string; name?: string; phone?: string; email?: string; city?: string };

const EMPTY = { id: '', name: '', phone: '', email: '', city: '' };

export default function ContactsPage() {
  const [items, setItems] = useState<Contact[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/guests?hotelId=${HOTEL_ID}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { cache: 'no-store' });
      setItems(res.ok ? await res.json() : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!form.name?.trim() && !form.phone?.trim()) return;
    setSaving(true);
    try {
      if (form.id) {
        await apiFetch(`/api/guests/${form.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.name, phone: form.phone, email: form.email, city: form.city }),
        });
      } else {
        await apiFetch('/api/guests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hotelId: HOTEL_ID, ...form }),
        });
      }
      setForm({ ...EMPTY });
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1>Contatos</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Agenda do painel: cadastre e edite contatos. Toda pessoa que escreve para a Bella também vira um contato automaticamente.
      </p>

      <div className="form-card">
        <strong>{form.id ? 'Editar contato' : 'Novo contato'}</strong>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="form-field"><label>Nome</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="form-field"><label>Telefone / WhatsApp</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="5547999999999" /></div>
        </div>
        <div className="form-row">
          <div className="form-field"><label>E-mail</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="form-field"><label>Cidade</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={save} disabled={saving}>{saving ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Adicionar contato'}</button>
          {form.id && <button className="btn ghost" onClick={() => setForm({ ...EMPTY })}>Cancelar edição</button>}
        </div>
      </div>

      <div className="toolbar">
        <input placeholder="Buscar por nome, telefone ou e-mail…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 280 }} />
      </div>

      {loading && <p className="muted">Carregando…</p>}
      {!loading && (
        <table>
          <thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Cidade</th><th></th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="muted">Nenhum contato encontrado.</td></tr>}
            {items.map((c) => (
              <tr key={c.id}>
                <td>{c.name || '—'}</td>
                <td>{c.phone || '—'}</td>
                <td>{c.email || '—'}</td>
                <td>{c.city || '—'}</td>
                <td><button className="btn ghost" onClick={() => setForm({ id: c.id, name: c.name ?? '', phone: c.phone ?? '', email: c.email ?? '', city: c.city ?? '' })}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
