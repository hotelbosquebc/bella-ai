'use client';

import { useEffect, useState, useCallback } from 'react';
import { HOTEL_ID, POLICY_LABELS } from '../../lib/config';

type Policy = {
  id: string;
  category: string;
  title: string;
  version: number;
  content: string;
  active: boolean;
  approved: boolean;
  createdAt: string;
};

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: 'CANCELLATION', title: '', content: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/policies?hotelId=${HOTEL_ID}`, { cache: 'no-store' });
      setPolicies(res.ok ? await res.json() : []);
    } catch {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotelId: HOTEL_ID, ...form }),
      });
      setForm({ category: 'CANCELLATION', title: '', content: '' });
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function approve(id: string) {
    await fetch(`/api/policies/${id}/approve`, { method: 'POST' });
    await load();
  }

  return (
    <>
      <h1>Políticas Operacionais</h1>
      <div className="toolbar">
        <button className="btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancelar' : '+ Nova política'}
        </button>
        <span className="muted">Toda resposta da Bella consulta apenas políticas aprovadas e ativas.</span>
      </div>

      {showForm && (
        <div className="form-card">
          <div className="form-row">
            <div className="form-field">
              <label>Categoria</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Object.entries(POLICY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ flex: 2 }}>
              <label>Título</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Política de Cancelamento" />
            </div>
          </div>
          <div className="form-field">
            <label>Conteúdo</label>
            <textarea
              rows={4}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="Descreva a regra oficial…"
            />
          </div>
          <button className="btn" onClick={create} disabled={saving}>
            {saving ? 'Salvando…' : 'Criar versão (requer aprovação)'}
          </button>
        </div>
      )}

      {loading && <p className="muted">Carregando…</p>}
      {!loading && (
        <table>
          <thead>
            <tr>
              <th>Categoria</th>
              <th>Título</th>
              <th>Versão</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 && (
              <tr><td colSpan={5} className="muted">Nenhuma política cadastrada.</td></tr>
            )}
            {policies.map((p) => (
              <tr key={p.id}>
                <td>{POLICY_LABELS[p.category] ?? p.category}</td>
                <td>
                  {p.title}
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{p.content}</div>
                </td>
                <td>v{p.version}</td>
                <td>
                  {p.approved
                    ? <span className="badge green">Aprovada</span>
                    : <span className="badge amber">Pendente</span>}
                  {!p.active && <span className="badge" style={{ marginLeft: 4 }}>Inativa</span>}
                </td>
                <td>
                  {!p.approved && (
                    <button className="btn ghost" onClick={() => approve(p.id)}>Aprovar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
