export default function KnowledgePage() {
  // TODO: upload real (POST /api/knowledge/upload) e status de indexação
  return (
    <>
      <h1>Centro de Conhecimento</h1>
      <div className="cards">
        <div className="card">
          <div className="kpi-label">Upload de documentos</div>
          <p>PDF, DOCX, TXT, CSV, XLSX, conversas exportadas do WhatsApp/Instagram e FAQ.</p>
        </div>
        <div className="card">
          <div className="kpi-label">Processamento</div>
          <p>Chunking → Embeddings → Vetorização (Qdrant) → Indexação por hotel.</p>
        </div>
      </div>
    </>
  );
}
