export default function BellaConfigPage() {
  // TODO: carregar/salvar AiSettings via API
  return (
    <>
      <h1>Central da Bella</h1>
      <div className="cards">
        <div className="card">
          <div className="kpi-label">Identidade</div>
          <p>Nome da IA, personalidade, tom de voz e idioma padrão.</p>
        </div>
        <div className="card">
          <div className="kpi-label">Modelos de IA</div>
          <p>Roteamento por tarefa: reservas (econômico), políticas (preciso), vendas (avançado). Temperatura configurável.</p>
        </div>
        <div className="card">
          <div className="kpi-label">Prompts</div>
          <p>Prompt Mestre, Comercial, Operacional, Reservas e Cancelamentos.</p>
        </div>
      </div>
    </>
  );
}
