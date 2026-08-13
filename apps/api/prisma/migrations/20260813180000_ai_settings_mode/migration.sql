-- Modo de operação da Bella: "on" (sempre), "off" (desligada) ou
-- "auto" (ativa só fora do horário do setor de reservas).
-- Default "auto": ao subir, a Bella cobre o fora-do-expediente sem que
-- ninguém precise ligar nada, e a equipe segue atendendo no horário.
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'auto';
