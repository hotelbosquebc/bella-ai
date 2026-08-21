-- Guarda a sugestão da Bella e o texto que o atendente de fato enviou.
CREATE TABLE "suggestion_feedback" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "conversa" TEXT,
    "acao" TEXT NOT NULL,
    "sugestao" TEXT NOT NULL,
    "enviado" TEXT NOT NULL,
    "modelo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestion_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "suggestion_feedback_hotelId_createdAt_idx" ON "suggestion_feedback"("hotelId", "createdAt");
