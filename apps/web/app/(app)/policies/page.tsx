const CATEGORIES = [
  'Cancelamento',
  'Reembolso',
  'No-show',
  'Pets',
  'Crianças',
  'Grupos',
  'Pagamento',
  'Check-in',
  'Check-out',
  'Alterações',
];

export default function PoliciesPage() {
  // TODO: listar políticas reais (GET /api/policies) com versão, autor e aprovação
  return (
    <>
      <h1>Políticas Operacionais</h1>
      <table>
        <thead>
          <tr>
            <th>Categoria</th>
            <th>Versão</th>
            <th>Autor</th>
            <th>Aprovação</th>
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((cat) => (
            <tr key={cat}>
              <td>{cat}</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
