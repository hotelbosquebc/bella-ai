-- Medicao do atendimento que sobrevive ao deploy.
--
-- Os diagnosticos viviam na memoria do servidor e cada publicacao apagava
-- tudo. Com varias publicacoes por dia, nao havia como saber se uma correcao
-- melhorou alguma coisa.
--
-- So percurso: motivo, canal e tempo. Nenhum texto de conversa.
CREATE TABLE "diagnosticos" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "canal" TEXT,
    "ms" INTEGER,
    "detalhe" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnosticos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "diagnosticos_tipo_createdAt_idx" ON "diagnosticos"("tipo", "createdAt");
