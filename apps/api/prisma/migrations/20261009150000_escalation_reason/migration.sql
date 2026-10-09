-- Por que a conversa foi parar com um humano.
--
-- PENDING_HUMAN hoje significa duas coisas diferentes: "o atendente assumiu"
-- e "a Bella nao deu conta e pediu ajuda". Para a recepcao sao situacoes
-- opostas - uma ela ja sabe, a outra esta esperando por ela.
--
-- Coluna anulavel: conversa assumida pelo atendente continua com NULL.
ALTER TABLE "conversations" ADD COLUMN "escalationReason" TEXT;
