'use client';

import { useEffect, useState, useCallback } from 'react';
import { HOTEL_ID } from '../../lib/config';

type Doc = {
  id: string;
  title: string;
  type: string;
  fileUrl?: string;
  embeddingStatus: string;
  createdAt: string;
};

const DOC_TYPES = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word (DOCX)' },
  { value: 'txt', label: 'Texto (TXT)' },
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'Planilha (XLSX)' },
  { value: 'whatsapp_export', label: 'Conversa WhatsApp' },
  { value: 'instagram_export', label: 'Conversa Instagram' },
  { value: 'faq', label: 'FAQ' },
];

const statusBadge = (s: string) =>
  s === 'INDEXED' ? 'green' : s === 'FAILED' ? 'red' : 'amber';
const statusLabel = (s: string) =>
  ({ PENDING: 'Pendente', PROCESSING: 'Processando', INDEXED: 'Indexado', FAILED: 'Falhou' }[s] ?? s);

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', type: 'pdf', fileUrl: '' });
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

  async function register() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/knowledge/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotelId: HOTEL_ID, ...form }),
      });
      setForm({ title: '', type: 'pdf', fileUrl: '' });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function reindex() {
    await fetch('/api/knowledge/reindex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotelId: HOTEL_ID }),
    });
    await load();
  }

  return (
    <>
      <h1>Centro de Conhecimento</h1>

      <div className="form-card">
        <strong>Registrar documento</strong>
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>
          A Bella aprende com estes materiais (chunking → embeddings → indexação no Qdrant por hotel).
        </p>
        <div className="form-row">
          <div className="form-field" style={{ flex: 2 }}>
            <label>Título</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Manual do hóspede 2026" />
          </div>
          <div className="form-field">
            <label>Tipo</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-field">
          <label>URL do arquivo (opcional)</label>
          <input value={form.fileUrl} onChange={(e) => setForm({ ...form, fileUrl: e.target.value })} placeholder="https://…" />
        </div>
        <button className="btn" onClick={register} disabled={saving}>
          {saving ? 'Registrando…' : 'Registrar para indexação'}
        </button>
      </div>

      <div className="toolbar">
        <strong>Documentos {docs.length > 0 && <span className="col-count">{docs.length}</span>}</strong>
        <button className="btn ghost" onClick={reindex}>Reindexar tudo</button>
      </div>

      {loading && <p className="muted">Carregando…</p>}
      {!loading && (
        <table>
          <thead>
            <tr><th>Título</th><th>Tipo</th><th>Status</th><th>Criado em</th></tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr><td colSpan={4} className="muted">Nenhum documento registrado ainda.</td></tr>
            )}
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.title}</td>
                <td>{DOC_TYPES.find((t) => t.value === d.type)?.label ?? d.type}</td>
                <td><span className={`badge ${statusBadge(d.embeddingStatus)}`}>{statusLabel(d.embeddingStatus)}</span></td>
                <td style={{ fontSize: 12 }}>{new Date(d.createdAt).toLocaleDateString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
