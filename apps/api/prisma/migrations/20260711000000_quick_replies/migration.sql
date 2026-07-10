-- Respostas rápidas (atalhos "/") do atendimento
CREATE TABLE "quick_replies" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quick_replies_hotelId_idx" ON "quick_replies"("hotelId");
