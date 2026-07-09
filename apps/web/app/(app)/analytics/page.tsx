'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { CHANNEL_LABELS, STAGE_LABELS } from '../../lib/config';

type Overview = {
  channels: { channel: string; conversations: number }[];
  funnel: { stage: string; count: number }[];
  ai: { interactions: number; avgConfidence: number | null; escalated: number; autoResolvedRate: number | null };
  lossReasons: { reason: string; count: number }[];
};

export default function AnalyticsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/analytics/overview', { cache: 'no-store' });
        if (res.ok) setData(await res.json());
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return (<><h1>Analytics &amp; Inteligência Comercial</h1><p className="muted">Carregando…</p></>);
  if (!data) return (<><h1>Analytics &amp; Inteligência Comercial</h1><p className="muted">Não foi possível carregar os dados.</p></>);

  const maxChannel = Math.max(1, ...data.channels.map((c) => c.conversations));

  return (
    <>
      <h1>Analytics &amp; Inteligência Comercial</h1>

      <div className="cards" style={{ marginBottom: 24 }}>
        <div className="card"><div className="kpi-label">Interações da Bella</div><div className="kpi-value">{data.ai.interactions}</div></div>
        <div className="card"><div className="kpi-label">Confiança média</div><div className="kpi-value">{data.ai.avgConfidence != null ? `${data.ai.avgConfidence}%` : '—'}</div></div>
        <div className="card"><div className="kpi-label">Resolvido pela IA</div><div className="kpi-value">{data.ai.autoResolvedRate != null ? `${data.ai.autoResolvedRate}%` : '—'}</div></div>
        <div className="card"><div className="kpi-label">Encaminhado a humano</div><div className="kpi-value">{data.ai.escalated}</div></div>
      </div>

      <div className="form-card">
        <strong>Conversas por canal</strong>
        <div style={{ marginTop: 12 }}>
          {data.channels.length === 0 && <p className="muted">Sem conversas ainda.</p>}
          {data.channels.map((c) => (
            <div key={c.channel} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ width: 90, fontSize: 13 }}>{CHANNEL_LABELS[c.channel] ?? c.channel}</span>
              <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 6, overflow: 'hidden', height: 22 }}>
                <div style={{ width: `${(c.conversations / maxChannel) * 100}%`, background: 'var(--green)', height: '100%' }} />
              </div>
              <span style={{ width: 30, textAlign: 'right', fontSize: 13 }}>{c.conversations}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="form-card">
        <strong>Funil de vendas</strong>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Etapa</th><th>Leads</th></tr></thead>
          <tbody>
            {data.funnel.length === 0 && <tr><td colSpan={2} className="muted">Sem leads ainda.</td></tr>}
            {data.funnel.map((f) => (
              <tr key={f.stage}><td>{STAGE_LABELS[f.stage] ?? f.stage}</td><td>{f.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="form-card">
        <strong>Motivos de perda</strong>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Motivo</th><th>Ocorrências</th></tr></thead>
          <tbody>
            {data.lossReasons.length === 0 && <tr><td colSpan={2} className="muted">Nenhum lead perdido registrado.</td></tr>}
            {data.lossReasons.map((l, i) => (
              <tr key={i}><td>{l.reason}</td><td>{l.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
