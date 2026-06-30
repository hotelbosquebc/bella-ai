-- Conhecimento utilizável pela Bella: texto + flag de ativo
ALTER TABLE "knowledge_base" ADD COLUMN "content" TEXT;
ALTER TABLE "knowledge_base" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
