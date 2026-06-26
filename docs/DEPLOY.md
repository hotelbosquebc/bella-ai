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
3. Quando pedir, preencher:
   - `DATABASE_URL` = connection string do Neon
   - `GOOGLE_API_KEY` = a mesma chave gratuita do Gemini já usada localmente
   - (os tokens dos canais podem ficar em branco agora e ser preenchidos no Passo 6)
4. Aguardar o deploy. A API ficará em `https://bella-api.onrender.com`.
5. Testar: `https://bella-api.onrender.com/api/health` deve responder `{"status":"ok"}`.

> O `render.yaml` já roda as migrações e o seed automaticamente no deploy, então
> o Passo 2.4 (rodar migrate/seed do seu PC) é opcional — útil só se quiser
> popular o banco antes da API subir.

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

## Passo 6 — Conectar os canais

Com a API pública no ar (`https://bella-api.onrender.com`), configure cada canal.
A inteligência da Bella (Gemini) e as respostas automáticas já funcionam assim que
os tokens forem preenchidos no Render (**Environment → Save** reinicia a API sozinho).

### Telegram (o mais simples — grátis, sem burocracia)

1. No Telegram, fale com **@BotFather** → `/newbot` → escolha nome e usuário do bot.
2. Copie o **token** que ele fornece e coloque em `TELEGRAM_BOT_TOKEN` no Render.
3. Registre o webhook (uma vez), trocando `<TOKEN>` pelo seu:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://bella-api.onrender.com/api/channels/telegram/webhook
   ```
   Abra essa URL no navegador — deve responder `{"ok":true}`. Pronto, é só mandar
   mensagem para o bot.

### Facebook Messenger e Instagram Direct (Meta)

Ambos usam o mesmo app da Meta e a mesma Página do Facebook (com o Instagram
profissional vinculado a ela).

1. Em https://developers.facebook.com → criar um app do tipo **Business**.
2. Adicionar os produtos **Messenger** e **Instagram**.
3. Vincular a **Página do Facebook** do hotel e gerar um **Page Access Token**.
   - `FACEBOOK_PAGE_ID` = ID da Página
   - `FACEBOOK_PAGE_ACCESS_TOKEN` = token gerado (serve para Messenger e Instagram)
4. Definir um `META_WEBHOOK_VERIFY_TOKEN` (uma senha qualquer que você inventa) —
   a mesma no Render e no painel da Meta.
5. Configurar os webhooks na Meta:
   - **Messenger** → Callback URL: `https://bella-api.onrender.com/api/channels/facebook/webhook`
   - **Instagram** → Callback URL: `https://bella-api.onrender.com/api/channels/instagram/webhook`
   - Verify Token: o mesmo `META_WEBHOOK_VERIFY_TOKEN`
   - Assinar o evento **messages**.
6. (Produção) Enviar o app para **App Review** pedindo as permissões
   `pages_messaging` e `instagram_manage_messages`. Antes da aprovação, funciona
   com as contas de teste/administradores do app.

### WhatsApp Business (opcional, mesmo app da Meta)

- `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` (produto WhatsApp no app Meta).
- Webhook: `https://bella-api.onrender.com/api/channels/whatsapp/webhook` (mesmo verify token).

## Depois da publicação

- Trocar a senha do admin (a `admin123` é só para desenvolvimento).
- Alimentar o Centro de Conhecimento com a estrutura do hotel (apartamentos, café,
  churrasqueiras, wi-fi, passeios) para a Bella responder sem encaminhar tanto.
- Opcional: domínio próprio (ex.: `painel.hoteldobosque.com.br`) — Vercel e Render
  aceitam domínio personalizado de graça (só o registro do domínio tem custo).

## Limites do plano gratuito (e quando evoluir)

- Render Free: 512 MB RAM, adormece sem o ping, 750h/mês — suficiente para validação e baixo volume.
- Neon Free: 0,5 GB de armazenamento — milhares de conversas cabem tranquilamente.
- Quando o volume de hóspedes crescer, o upgrade natural é o Render Starter (~US$ 7/mês), sem mudar nada na arquitetura.
