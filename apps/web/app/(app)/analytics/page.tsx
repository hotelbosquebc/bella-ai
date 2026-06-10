export default function AnalyticsPage() {
  // TODO: gráficos reais (motivos de perda, funil, canais, mapa de calor)
  return (
    <>
      <h1>Analytics &amp; Inteligência Comercial</h1>
      <div className="cards">
        <div className="card"><div className="kpi-label">Motivos de perda</div><div className="kpi-value">—</div></div>
        <div className="card"><div className="kpi-label">Principais perguntas</div><div className="kpi-value">—</div></div>
        <div className="card"><div className="kpi-label">Datas mais procuradas</div><div className="kpi-value">—</div></div>
        <div className="card"><div className="kpi-label">Canal com maior conversão</div><div className="kpi-value">—</div></div>
        <div className="card"><div className="kpi-label">Taxa de fechamento</div><div className="kpi-value">—</div></div>
        <div className="card"><div className="kpi-label">Canal mais lucrativo</div><div className="kpi-value">—</div></div>
      </div>
    </>
  );
}
