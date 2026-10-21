-- Guias de grupos e excursoes: a Bella passa direto para uma pessoa.
CREATE TABLE "contatos_marcados" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "identificador" TEXT,
    "nome" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'guia',
    "cor" TEXT NOT NULL DEFAULT '#7c3aed',
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contatos_marcados_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contatos_marcados_hotelId_idx" ON "contatos_marcados"("hotelId");
