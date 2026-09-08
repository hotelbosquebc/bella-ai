-- Licoes: regras aprendidas com a correcao do atendente, pendentes de aprovacao.
CREATE TABLE "licoes" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "tema" TEXT,
    "exemplos" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "licoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "licoes_hotelId_status_idx" ON "licoes"("hotelId", "status");

-- Marca o que a analise diaria ja leu.
ALTER TABLE "suggestion_feedback" ADD COLUMN "analisado" BOOLEAN NOT NULL DEFAULT false;
