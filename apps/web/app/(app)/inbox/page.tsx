export default function InboxPage() {
  // TODO: carregar conversas reais de /api/conversations (com filtros por canal)
  return (
    <>
      <h1>Caixa de Entrada Unificada</h1>
      <div className="inbox">
        <div className="panel">
          <strong>Conversas</strong>
          <p style={{ color: 'var(--muted)', marginTop: 12 }}>
            WhatsApp · Instagram · TikTok · Facebook · Site · E-mail
          </p>
        </div>
        <div className="panel">
          <strong>Chat</strong>
          <p style={{ color: 'var(--muted)', marginTop: 12 }}>Selecione uma conversa para visualizar.</p>
        </div>
        <div className="panel">
          <strong>Perfil do Hóspede</strong>
          <p style={{ color: 'var(--muted)', marginTop: 12 }}>
            Histórico, reservas, preferências e probabilidade de fechamento.
          </p>
        </div>
      </div>
    </>
  );
}
