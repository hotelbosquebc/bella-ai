# Publicação gratuita do Bella AI (R$ 0/mês)

Arquitetura 100% gratuita com o melhor desempenho possível sem gastar:

| Peça | Serviço | Plano |
|---|---|---|
| Painel web (Next.js) | [Vercel](https://vercel.com) | Hobby (grátis) |
| API (NestJS) | [Render](https://render.com) | Free (750h/mês) |
| Banco PostgreSQL | [Neon](https://neon.tech) | Free |
| Manter API acordada | [cron-job.org](https://cron-job.org) | Grátis |

## Passo 1 — Publicar o repositório no GitHub

No **GitHub Desktop**: o repositório `bella-ai` já aparece na lista → botão **"Publish repository"** → marcar **"Keep this code private"** → Publish.

## Passo 2 — Banco de dados (Neon)

1. Criar conta em https://neon.tech (pode entrar com a conta do GitHub).
2. Criar projeto `bella-ai` (região AWS São Paulo, se disponível).
3. Copiar a **connection string** (formato `postgresql://...@....neon.tech/neondb?sslmode=require`).
4. Rodar as migrações e o seed a partir do seu computador:

```powershell
cd $env:USERPROFILE\Documents\GitHub\bella-ai\apps\api
$env:DATABASE_URL = "COLE_AQUI_A_CONNECTION_STRING"
npx prisma migrate deploy
node prisma/seed.js
```

## Passo 3 — API (Render)

1. Criar conta em https://render.com (entrar com GitHub).
2. **New → Blueprint** → escolher o repositório `bella-ai` (ele lê o `render.yaml` automaticamente).
3. Quando pedir, preencher `DATABASE_URL` com a connection string do Neon.
4. Aguardar o deploy. A API ficará em `https://bella-api.onrender.com`.
5. Testar: `https://bella-api.onrender.com/api/health` deve responder `{"status":"ok"}`.

## Passo 4 — Painel (Vercel)

1. Criar conta em https://vercel.com (entrar com GitHub).
2. **Add New → Project** → importar o repositório `bella-ai`.
3. Em **Root Directory**, selecionar `apps/web`.
4. Em **Environment Variables**, adicionar: `API_URL` = `https://bella-api.onrender.com`.
5. Deploy. O painel ficará em `https://bella-ai.vercel.app` (ou similar).

## Passo 5 — Manter a API acordada

O plano Free do Render "adormece" a API após 15 minutos sem uso (a primeira visita
depois disso demora ~50s). Para evitar:

1. Criar conta em https://cron-job.org.
2. Criar um cron job: URL `https://bella-api.onrender.com/api/health`, a cada **5 minutos**.

## Depois da publicação

- Trocar a senha do admin (a `admin123` é só para desenvolvimento).
- Configurar `ANTHROPIC_API_KEY` no Render para ativar a inteligência da Bella.
- Apontar os webhooks da Meta (WhatsApp/Instagram) para `https://bella-api.onrender.com/api/channels/...`.
- Opcional: domínio próprio (ex.: `painel.hoteldobosque.com.br`) — tanto Vercel quanto Render aceitam domínio personalizado de graça (só o registro do domínio tem custo, se ainda não tiver).

## Limites do plano gratuito (e quando evoluir)

- Render Free: 512 MB RAM, adormece sem o ping, 750h/mês — suficiente para validação e baixo volume.
- Neon Free: 0,5 GB de armazenamento — milhares de conversas cabem tranquilamente.
- Quando o volume de hóspedes crescer, o upgrade natural é o Render Starter (~US$ 7/mês), sem mudar nada na arquitetura.
