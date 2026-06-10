const STAGES = [
  'Novo Lead',
  'Consulta',
  'Cotação Enviada',
  'Em Negociação',
  'Reserva Confirmada',
  'Check-in',
  'Pós Venda',
  'Cliente Recorrente',
];

export default function CrmPage() {
  // TODO: carregar leads de /api/leads e habilitar drag and drop (PATCH /api/leads/:id)
  return (
    <>
      <h1>Pipeline Comercial</h1>
      <div className="kanban">
        {STAGES.map((stage) => (
          <div className="column" key={stage}>
            <h3>{stage}</h3>
          </div>
        ))}
      </div>
    </>
  );
}
