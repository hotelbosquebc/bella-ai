'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

type Kpis = {
  messagesToday: number;
  reservationsGenerated: number;
  revenue: number | string;
  conversionRate: number;
  quotesSent: number;
  bellaVsHumans: { bella: number; humans: number };
  activeLeads: number;
};

export default function DashboardPage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/analytics/kpis', { cache: 'no-store' });
        if (res.ok) setKpis(await res.json());
      } catch {
        setKpis(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const cards = [
    { label: 'Mensagens recebidas hoje', value: kpis?.messagesToday ?? '—' },
    { label: 'Reservas geradas', value: kpis?.reservationsGenerated ?? '—' },
    { label: 'Receita gerada', value: kpis ? `R$ ${Number(kpis.revenue).toLocaleString('pt-BR')}` : '—' },
    { label: 'Conversão', value: kpis ? `${kpis.conversionRate}%` : '—' },
    { label: 'Cotações enviadas', value: kpis?.quotesSent ?? '—' },
    {
      label: 'Bella x Humanos',
      value: kpis ? `${kpis.bellaVsHumans.bella} x ${kpis.bellaVsHumans.humans}` : '—',
    },
    { label: 'Leads ativos', value: kpis?.activeLeads ?? '—' },
    { label: 'Ocupação prevista', value: '—' },
  ];

  return (
    <>
      <h1>Dashboard Executivo</h1>
      {loading && <p className="muted" style={{ marginBottom: 16 }}>Carregando indicadores…</p>}
      {!loading && !kpis && (
        <p className="muted" style={{ marginBottom: 16 }}>
          Não foi possível carregar os indicadores — verifique sua conexão ou faça login novamente.
        </p>
      )}
      <div className="cards">
        {cards.map((kpi) => (
          <div className="card" key={kpi.label}>
            <div className="kpi-label">{kpi.label}</div>
            <div className="kpi-value">{kpi.value}</div>
          </div>
        ))}
      </div>
    </>
  );
}
