async function getKpis() {
  try {
    const res = await fetch(`${process.env.API_URL ?? 'http://localhost:3002'}/api/analytics/kpis`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const kpis = await getKpis();

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
      {!kpis && (
        <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
          API indisponível — inicie o backend para ver os indicadores em tempo real.
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
