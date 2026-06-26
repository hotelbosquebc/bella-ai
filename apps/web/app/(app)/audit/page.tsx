'use client';

import { useEffect, useState } from 'react';

type Audit = {
  id: string;
  question: string;
  response: string;
  policyUsed: string | null;
  model: string;
  confidence: number | null;
  guardrailLevel: number;
  escalated: boolean;
  createdAt: string;
};

const levelBadge = (lvl: number) =>
  lvl >= 3 ? 'red' : lvl === 2 ? 'amber' : 'green';

export default function AuditPage() {
  const [rows, setRows] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/audit', { cache: 'no-store' });
        setRows(res.ok ? await res.json() : []);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <>
      <h1>Auditoria Total</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Registro imutável de toda interação da Bella: pergunta, resposta, política consultada, modelo, confiança e nível anti-prejuízo.
      </p>
      {loading && <p className="muted">Carregando…</p>}
      {!loading && (
        <table>
          <thead>
            <tr>
              <th>Data/Hora</th>
              <th>Pergunta</th>
              <th>Resposta</th>
              <th>Política</th>
              <th>Modelo</th>
              <th>Confiança</th>
              <th>Nível</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="muted">Nenhuma interação registrada ainda.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                  {new Date(r.createdAt).toLocaleString('pt-BR')}
                </td>
                <td style={{ maxWidth: 220 }}>{r.question}</td>
                <td style={{ maxWidth: 280 }}>{r.response}</td>
                <td>{r.policyUsed ?? '—'}</td>
                <td style={{ fontSize: 12 }}>{r.model}</td>
                <td>{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'}</td>
                <td>
                  <span className={`badge ${levelBadge(r.guardrailLevel)}`}>Nível {r.guardrailLevel}</span>
                  {r.escalated && <span className="badge red" style={{ marginLeft: 4 }}>Escalado</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
