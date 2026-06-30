'use client';

import { useEffect, useState, useCallback } from 'react';
import { HOTEL_ID } from '../../lib/config';

type Doc = {
  id: string;
  title: string;
  type: string;
  content?: string;
  active: boolean;
  embeddingStatus: string;
  createdAt: string;
};

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', content: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/knowledge?hotelId=${HOTEL_ID}`, { cache: 'no-store' });
      setDocs(res.ok ? await res.json() : []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/knowledge/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotelId: HOTEL_ID, title: form.title, type: 'manual', content: form.content }),
      });
      setForm({ title: '', content: '' });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Remover este conhecimento? A Bella deixará de usá-lo.')) return;
    await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    await load();
  }

  async function toggleActive(d: Doc) {
    await fetch(`/api/knowledge/${d.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !d.active }),
    });
    await load();
  }

  return (
    <>
      <h1>Centro de Conhecimento</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Tudo que você cadastrar aqui a Bella usa para responder aos hóspedes — sem inventar.
        Ex.: café da manhã, estrutura, Wi-Fi, estacionamento, passeios, localização.
      </p>

      <div className="form-card">
        <strong>Adicionar conhecimento</strong>
        <div className="form-field" style={{ marginTop: 12 }}>
          <label>Título (assunto)</label>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Ex.: Café da manhã"
          />
        </div>
        <div className="form-field">
          <label>Conteúdo</label>
          <textarea
            rows={5}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="Ex.: O café da manhã é servido das 7h às 10h, incluso na diária, com buffet de pães, frutas, frios, ovos e sucos."
          />
        </div>
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar conhecimento'}
        </button>
      </div>

      <div className="toolbar">
        <strong>Conhecimentos cadastrados {docs.length > 0 && <span className="col-count">{docs.length}</span>}</strong>
      </div>

      {loading && <p className="muted">Carregando…</p>}
      {!loading && (
        <table>
          <thead>
            <tr><th>Assunto</th><th>Conteúdo</th><th>Ativo</th><th></th></tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr><td colSpan={4} className="muted">Nenhum conhecimento ainda. Comece cadastrando o café da manhã, a estrutura e os passeios.</td></tr>
            )}
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.title}</td>
                <td style={{ maxWidth: 420, fontSize: 13 }}>{d.content}</td>
                <td>
                  <button className="btn ghost" onClick={() => toggleActive(d)}>
                    {d.active ? 'Sim' : 'Não'}
                  </button>
                </td>
                <td><button className="btn ghost" onClick={() => remove(d.id)}>Remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
