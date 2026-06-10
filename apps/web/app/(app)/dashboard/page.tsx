const KPIS = [
  { label: 'Mensagens recebidas hoje', value: '—' },
  { label: 'Reservas geradas', value: '—' },
  { label: 'Receita gerada', value: '—' },
  { label: 'Conversão', value: '—' },
  { label: 'Tempo médio de resposta', value: '—' },
  { label: 'Bella x Humanos', value: '—' },
  { label: 'Leads ativos', value: '—' },
  { label: 'Ocupação prevista', value: '—' },
];

export default function DashboardPage() {
  // TODO: buscar KPIs reais de /api/analytics/kpis
  return (
    <>
      <h1>Dashboard Executivo</h1>
      <div className="cards">
        {KPIS.map((kpi) => (
          <div className="card" key={kpi.label}>
            <div className="kpi-label">{kpi.label}</div>
            <div className="kpi-value">{kpi.value}</div>
          </div>
        ))}
      </div>
    </>
  );
}
