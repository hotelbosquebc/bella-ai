-- Arquivos que a Bella anexa às sugestões (regras de pets, catálogo de ingressos).
-- Guardados em base64 no próprio banco: a regra do hotel é custo ZERO, então não
-- há bucket/CDN contratado. São poucos arquivos e raramente mudam.
CREATE TABLE IF NOT EXISTS "attachments" (
  "id"        TEXT NOT NULL,
  "hotelId"   TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "mimeType"  TEXT NOT NULL,
  "data"      TEXT NOT NULL,
  "keywords"  TEXT NOT NULL,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "attachments_hotelId_idx" ON "attachments"("hotelId");
