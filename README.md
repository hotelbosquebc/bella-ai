# Bella AI 🌿

Plataforma SaaS Omnichannel de Atendimento, Reservas e CRM Inteligente para Hotelaria.

Bella é a funcionária virtual do hotel: vende hospedagens, responde dúvidas, consulta disponibilidade, gera links de reserva, segue políticas internas e trabalha em conjunto com atendentes humanos — com auditoria total.

## Estrutura do monorepo

```
bella-ai/
├── apps/
│   ├── api/        # Backend NestJS (canais, CRM, reservas, orquestrador da Bella)
│   └── web/        # Frontend Next.js (dashboard, inbox, CRM, configurações)
├── docs/           # PRD e arquitetura
└── docker-compose.yml  # PostgreSQL, Redis, RabbitMQ, Qdrant
```

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js (App Router) |
| Backend | NestJS + Prisma |
| Banco | PostgreSQL (multi-tenant por `hotel_id`) |
| Vetores (RAG) | Qdrant |
| Filas | RabbitMQ |
| Cache | Redis |
| IA | Claude / OpenAI / Gemini com roteamento por tarefa |

## Subindo o ambiente de desenvolvimento

```bash
# 1. Infraestrutura
docker compose up -d

# 2. Variáveis de ambiente
cp .env.example .env   # preencha as chaves de API

# 3. Dependências
npm install

# 4. Banco de dados
npm run db:migrate -w apps/api

# 5. API e Web
npm run dev -w apps/api
npm run dev -w apps/web
```

## Documentação

- [docs/PRD.md](docs/PRD.md) — requisitos do produto
- [docs/ARQUITETURA.md](docs/ARQUITETURA.md) — fluxo de IA, guardrails anti-prejuízo, memória e roteamento de modelos
