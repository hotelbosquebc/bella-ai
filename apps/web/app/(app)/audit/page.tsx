export default function AuditPage() {
  // TODO: listar registros reais (GET /api/audit)
  return (
    <>
      <h1>Auditoria Total</h1>
      <table>
        <thead>
          <tr>
            <th>Data/Hora</th>
            <th>Pergunta</th>
            <th>Resposta</th>
            <th>Política</th>
            <th>Modelo</th>
            <th>Confiança</th>
            <th>Escalado</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={7} style={{ color: 'var(--muted)' }}>
              Nenhuma interação registrada ainda.
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
