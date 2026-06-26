'use client';

import { useEffect, useState, useCallback } from 'react';
import { STAGE_LABELS } from '../../lib/config';

const STAGES = Object.keys(STAGE_LABELS);

type Lead = {
  id: string;
  stage: string;
  probability: number;
  estimatedValue: string | number;
  guest?: { name?: string; phone?: string };
};

export default function CrmPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/leads', { cache: 'no-store' });
      setLeads(res.ok ? await res.json() : []);
    } catch {
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function moveTo(stage: string) {
    if (!dragId) return;
    const lead = leads.find((l) => l.id === dragId);
    setOverStage(null);
    setDragId(null);
    if (!lead || lead.stage === stage) return;

    // Atualização otimista + persistência
    setLeads((prev) => prev.map((l) => (l.id === dragId ? { ...l, stage } : l)));
    await fetch(`/api/leads/${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    }).catch(() => load());
  }

  const fmtMoney = (v: string | number) =>
    Number(v) > 0 ? `R$ ${Number(v).toLocaleString('pt-BR')}` : null;

  return (
    <>
      <h1>Pipeline Comercial</h1>
      {loading && <p className="muted">Carregando leads…</p>}
      {!loading && leads.length === 0 && (
        <p className="muted">
          Nenhum lead ainda. Cada hóspede que inicia uma conversa vira um lead automaticamente no funil.
        </p>
      )}
      <div className="kanban">
        {STAGES.map((stage) => {
          const items = leads.filter((l) => l.stage === stage);
          return (
            <div
              key={stage}
              className={`column${overStage === stage ? ' drop-target' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={() => moveTo(stage)}
            >
              <h3>
                {STAGE_LABELS[stage]} <span className="col-count">{items.length}</span>
              </h3>
              {items.map((lead) => (
                <div
                  key={lead.id}
                  className="lead-card"
                  draggable
                  onDragStart={() => setDragId(lead.id)}
                >
                  <div className="lead-name">{lead.guest?.name || lead.guest?.phone || 'Lead'}</div>
                  <div className="lead-meta">
                    {fmtMoney(lead.estimatedValue) && <span>{fmtMoney(lead.estimatedValue)} · </span>}
                    {lead.probability}% chance
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
