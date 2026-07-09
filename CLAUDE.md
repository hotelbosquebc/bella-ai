# Bella AI — Documentação do Projeto

Plataforma SaaS de **atendimento inteligente para hotelaria**: concierge/IA que conversa com hóspedes por múltiplos canais, qualifica leads, responde com base na base de conhecimento do hotel (RAG) e integra com o motor de reservas. Cliente-âncora: **Hotel do Bosque** (Balneário Camboriú).

**Repositório:** github (privado) · **Deploy:** Render (Blueprint `render.yaml`)

---

## ⚡ Referência Rápida (atualizado 2026-07-08 — LER ANTES DE INVESTIGAR)

> Evita re-descoberta (economia de tokens). Se divergir do código, confie no código e **atualize esta seção**.

### Stack
- **Monorepo** npm workspaces (`apps/*`). Raiz: `npm run dev:api`, `npm run dev:web`.
- **apps/api** (`@bella/api`): **NestJS 10** + **Prisma** + **PostgreSQL**. Porta `3001` (ou `3002` — ver `.env`). `nest start --watch`. Build → `dist/main.js`.
- **apps/web** (`@bella/web`): **Next.js 15** + **React 19**. `next dev`. Faz rewrite de `/api/*` → `API_URL` (default `http://localhost:3001`).
- **Auth:** JWT (`@nestjs/jwt`).

### IA (motor agnóstico de provedor)
- Controlado por env `AI_PROVIDER` (`gemini` | provavelmente `anthropic`). SDKs: `@google/generative-ai` e `@anthropic-ai/sdk`.
- **Gemini é a opção grátis** — precisa só de `GOOGLE_API_KEY` (mesma chave gratuita usada no Restaurante 360). Sem ela, a IA não roda.
- RAG usa **Qdrant** (vector DB) para embeddings da base de conhecimento (`KnowledgeDocument`, `EmbeddingStatus`).

### Infra local (docker-compose.yml)
`postgres` (5432), `redis` (6379), `rabbitmq` (5672), `qdrant` (6333). Subir com `docker compose up -d` antes de rodar a API.

### Rodar localmente
1. `docker compose up -d` (sobe postgres/redis/rabbitmq/qdrant)
2. Criar `apps/api/.env` a partir de `.env.example` — **preencher `GOOGLE_API_KEY` e `AI_PROVIDER=gemini`** (o `.env.example` vem vazio)
3. `npm install` na raiz
4. API: `npm run dev:api` (roda migrations Prisma + seed) · Web: `npm run dev:web`
5. Scripts prontos: `iniciar-bella.ps1`, `ativar-gemini.ps1`

### Banco (Prisma — `apps/api/prisma/schema.prisma`)
Modelos: `Hotel, User, Guest, Conversation, Message, Lead, Reservation, KnowledgeDocument, Policy, AiAudit, AiSettings`.
Enums: `UserRole, Channel, ConversationStatus, MessageSender, LeadStage, ReservationStatus, PolicyCategory, EmbeddingStatus`.
- Migrations: `npx prisma migrate deploy` (prod) / `prisma migrate dev` (local). Seed: `node prisma/seed.js` (idempotente).

### Módulos NestJS (`apps/api/src/modules/`)
`admin, analytics, audit, auth, bella, channels, conversations, guests, knowledge, leads, outbound, policies, reservations, settings`.
- `bella` = cérebro do agente de IA · `channels` = WhatsApp/Instagram/Facebook/Telegram · `knowledge` = base RAG · `outbound` = mensagens ativas.

### Acesso / seed
- Admin criado pelo seed: email `admin@hoteldobosque.com.br` (ou `ADMIN_EMAIL`), senha vem de **`ADMIN_PASSWORD`** (env). Sem ela, o seed gera senha aleatória. Hotel default id `hotel-do-bosque`.

### Deploy (Render Blueprint — `render.yaml`)
- Banco `bella-db` (PostgreSQL free, região virginia) + serviço `bella-api`. `DATABASE_URL` conecta automático.
- Envs `sync:false` (preencher no painel): `ADMIN_PASSWORD`, `GOOGLE_API_KEY`, tokens de canais (WhatsApp/Meta/Telegram).
- `startCommand`: `prisma migrate deploy` + `node prisma/seed.js` + `node dist/main.js`. Healthcheck `/api/health`.

### Integração motor de reservas
`BOOKING_ENGINE_BASE_URL=https://sbreserva.silbeck.com.br/hotelbosque` + `BOOKING_ENGINE_PATH=/pt-br/reserva` (Silbeck).

### Canais (env em `.env.example`)
WhatsApp (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`), Meta (`META_WEBHOOK_VERIFY_TOKEN`, Facebook/Instagram page tokens), Telegram (`TELEGRAM_BOT_TOKEN`).

---

## Pegadinhas / notas
- **`.env` não existe localmente** por padrão (só `.env.example`, com chaves vazias). Criar e preencher `GOOGLE_API_KEY`+`AI_PROVIDER=gemini` para a IA funcionar.
- Precisa de **4 serviços de infra** (postgres/redis/rabbitmq/qdrant) — sem o docker compose no ar, a API não sobe.
- Repositório **não contém senha real** de admin (por design). Definir `ADMIN_PASSWORD`.
