# ESTADO — Bella AI (retomada de conversa)

> Documento de continuidade. Leia antes de continuar. Última atualização: sessão de jul/2026.

## O que é
**Bella AI** — plataforma SaaS omnichannel de atendimento/reservas/CRM para hotelaria. 1º cliente: **Hotel do Bosque, Balneário Camboriú** (RS Hotelaria LTDA). Dono trabalha em português, autorizou execução autônoma. A Bella é uma "funcionária virtual" (especialista em reservas) que atende, tira dúvidas e gera links de reserva — sem inventar, com guardrails anti-prejuízo.

## Onde fica o código
- Repo: **C:\Users\BOSQUE\Documents\GitHub\bella-ai** (a sessão roda no dir do GitHub Desktop, NÃO é onde fica o código).
- Monorepo npm: `apps/api` (NestJS + Prisma/PostgreSQL) e `apps/web` (Next.js App Router).
- Docs: `docs/PRD.md`, `docs/ARQUITETURA.md`, `docs/DEPLOY.md`, `docs/GUIA-TESTE.md`, `docs/CONEXAO-CANAIS.md`.

## Está NO AR (produção)
- **Painel:** https://bella-ai-web.vercel.app (Vercel, projeto bella-ai-web, conta GitHub hotelbosquebc)
- **API:** https://bella-api-nh3h.onrender.com (Render, workspace "My Workspace", serviço srv-d8velvn7f7vs73866b3g)
- **Banco:** PostgreSQL gerenciado pelo Render (bella-db, região Virginia, plano free — ⚠️ expira ~30 dias, migrar depois)
- **Login painel:** admin@hoteldobosque.com.br / senha em `ADMIN_PASSWORD` (Render env) = **@V271212t\*** (admin123 foi desativada)
- **IA:** Google Gemini (GRATUITO). `AI_PROVIDER=gemini`, `GOOGLE_API_KEY` no Render. Modelo **gemini-2.5-flash** (com `thinkingConfig.thinkingBudget=0`, senão trunca). Retry em 503/429.

## Contas (IMPORTANTE — causa de muita confusão)
- **GitHub:** repo bella-ai é da conta **hotelbosquebc**. O GitHub Desktop e o git CLI desta máquina usam a conta **nutrestaurante**. ✅ RESOLVIDO: nutrestaurante foi adicionada como **colaboradora (write)** no repo → agora `git push origin master` FUNCIONA direto do CLI (não precisa mais pedir push ao usuário).
- **Render:** usuário tem 2 workspaces — usar **"My Workspace"** (tem bella-api/bella-db). O outro ("NUT Restaurante") é de outro projeto.
- **Meta/Facebook:** conta @hotelbosquebc é comercial (NÃO acessa developers.facebook.com). Perfil pessoal **"Victor Bosque"** (do dono) foi elevado a **Acesso total** e serve para o portal de desenvolvedores. Página FB + Instagram @hotelbosquebc já existem e estão vinculados.

## Motor de reservas real (Silbeck)
- Base `https://sbreserva.silbeck.com.br/hotelbosque`, path `/pt-br/reserva`. Aceita GET.
- Parâmetros usados pela Bella hoje: `data_inicio`/`data_fim` (DD/MM/AAAA) + `categorias_hospede[000001]`=adultos, `[000003]`=crianças 0-6, `[000004]`=crianças 7-9.
- ⚠️ DESCOBERTA (WhatsApp real): o formato que o hotel usa de verdade é `/pt-br/reserva/busca/?checkin=AAAA-MM-DD&adultos-000001=N` (data ISO). Vale ALINHAR a geração do link a esse formato (pendente de confirmar params de criança).

## Treinamento da Bella (feito)
- **Base de conhecimento USÁVEL:** `KnowledgeDocument.content` injetado no prompt (`KnowledgeService.getKnowledgeContext`). Editável em /knowledge e via API. **~22 conhecimentos** carregados (café 7-10h restaurante térreo, apartamentos, wifi, estacionamento rotativo, limpeza, pets, piscina=NÃO TEM, hóspedes/apto máx 6, secador/ferro, localização Av. Brasil 22 CEP 88330-040, ingressos, menores, pagamento 5% pix/até 10x/3x sem juros, horário reservas 9-12h/14:30-17:30).
- **Políticas oficiais** (7): cancelamento em faixas (30d/10%, 29-15d/50%, 14-8d/80%, <7d/100% sem reembolso, só crédito 1 ano), check-in 14h até 18h, check-out 11h, no-show, pets (taxa mín R$200), pagamento (sinal 50%), grupos.
- **NÃO cadastrar preços/promoções** (mudam sempre — regra do dono). Bella deve ESCALAR negociação/desconto/meia diária/grupos (anti-prejuízo).
- **Respostas rápidas ("/")**: 8 atalhos cadastrados (/confirmação, /confirmar, /financeiro, /Banco, /24, /Bomdia, /ingressos, /endereço). Tela /quick-replies. Endpoint /api/quick-replies.

## Análise das conversas reais do WhatsApp (memória: bella-whatsapp-analise.md)
Tom "Victor" (saudação calorosa pedindo período/nº pessoas/idades <10). Funil: saudação+link → coleta → link Silbeck com valores → dúvidas → sinal 50% PIX → comprovante → "encaminhado ao financeiro" → voucher. Dúvidas comuns: preço site=WhatsApp, meia diária (só exceção), categorias/disponibilidade, parcelamento, confirmação. Atende em espanhol (Uruguai/Argentina). Grupos/atletas = presencial.

## Funções do painel (todas funcionais)
Dashboard (KPIs), Caixa de Entrada (chat, perfil, **assumir/devolver controle**, respostas rápidas "/"), CRM Kanban (drag-drop), Central da Bella (editar identidade/prompts), Conhecimento, Contatos (criar/editar), Políticas, Auditoria, Analytics, modo escuro, logout. API protegida por JWT (guard global; @Public em webhooks/health/login; escape `DISABLE_AUTH=true`). Follow-up e outbound WhatsApp/IG/FB/Telegram implementados. Limpeza de teste: `DELETE /api/admin/cleanup-test-data`. Dados de teste JÁ foram limpos (caixa zerada).

## ✅ RESOLVIDO — API DE VOLTA AO AR (13/08/2026)
- `GET /api/health` → **200** em 0,3s. `POST /api/auth/login` autentica de verdade (retorna user OWNER) ⇒ **o banco novo está conectado e funcionando**.
- O **seed `seed-conhecimento.js` EXECUTOU com sucesso** (não é mais só sintaxe). Estado medido via API:
  - **16 conhecimentos** — 11 ativos com texto real + **5 inativos com `[REVISAR]`**: Wi-Fi, Categorias de apartamentos, Limpeza dos apartamentos, Ingressos, Menores de idade.
  - **8 atalhos** — 3 com texto real (`/24`, `/bomdia`, `/endereco`) + **5 com `[REVISAR]`**: `/banco`, `/confirmacao`, `/confirmar`, `/financeiro`, `/ingressos`.
  - **7 políticas** completas (cancelamento, no-show, pets, infantil, grupos, pagamento, check-in).
- ✅ Conhecimentos `[REVISAR]` estão `active: false` e `getKnowledgeContext` filtra `active: true` ⇒ **a Bella não enxerga os placeholders**.
- ⚠️ **RISCO ABERTO:** o model `QuickReply` (`schema.prisma`) **não tem campo `active`**. Os 5 atalhos `[REVISAR]` aparecem normalmente no painel — um atendente pode digitar `/banco` e mandar `"[REVISAR — conteúdo original perdido...]"` para o hóspede. **Corrigir:** escrever os 5 textos à mão em /quick-replies (rápido), ou adicionar `active` ao model + filtro na tela.
- ✅ **Conteúdo do 1c2647f REAPLICADO** (commit `10cb1d0`, `git revert 588b83a`): AssistModule (`/api/assist/suggest`), transcrição de áudio, saudação "especialista em reservas", handoff por horário e `whatsapp-extension/`. Revert sem conflitos, `nest build` local passou, `AssistModule` registrado no `app.module.ts`, push feito.
- 🚨 **A IA ESTÁ DESLIGADA em produção.** `POST /api/assist/suggest` responde `{"model":"mock"}` — o texto "estou com a inteligência em configuração". `resolveProvider()` só cai em `mock` quando **nem `AI_PROVIDER` nem `GOOGLE_API_KEY`** existem no ambiente. Como o `render.yaml` fixa `AI_PROVIDER: gemini` (valor literal, não `sync: false`), o serviço rodando **está sem as envs do Blueprint**. **AÇÃO:** no painel do Render (bella-api > Environment) repor `AI_PROVIDER=gemini` + `GOOGLE_API_KEY` (chave gratuita do Gemini) e redeployar.
- ⚠️ **PENDENTE confirmar no painel do Render:** qual banco está em uso agora (Dashboard > bella-api > Environment > `DATABASE_URL`). O `render.yaml` ainda declara `databases: bella-db` no plano **free do Render** e amarra a `DATABASE_URL` via `fromDatabase` — se um re-sync do Blueprint acontecer, ele reconecta ao banco free e a API cai de novo em ~30 dias. Se a string for do Supabase, **remover o bloco `databases:`** e trocar `DATABASE_URL` para `sync: false`. (Deixado intocado nesta sessão por falta de acesso ao painel.)
- ⚠️ Conferir também se `ADMIN_PASSWORD`, `JWT_SECRET`, `DEFAULT_HOTEL_ID` e `BOOKING_ENGINE_*` sobreviveram — se a env da IA se perdeu, outras podem ter se perdido junto.

### Diagnóstico original (sessão de 10/08/2026) — histórico
- **CAUSA: o `bella-db` FOI DELETADO.** Verificado no painel do Render: em `Ungrouped Services` aparece **All (1)** — só o `bella-api`, com status **`Failed service`**. Não há banco na lista nem suspenso (`Suspended (0)`). O Postgres free expirou e foi removido. ⇒ **Não é o código** (a reversão de 1c2647f não tinha como resolver).
- **Sintoma medido:** TCP 443 conecta no edge do Render (216.24.57.7), mas HTTP **não responde em 180s** — nem `/api/health`, nem a raiz. É o boot travado: o `startCommand` roda `prisma migrate deploy`, a conexão com o banco inexistente fica pendurada até o timeout e a porta HTTP nunca abre. (Erro de código daria 502 rápido, não silêncio.)
- **Painel Vercel segue OK** (HTTP 200) — só a API caiu.
- **Conta:** o Render da Bella está na conta **do hotel** (não na nutrestaurante); workspace **My Workspace**.
- **PENDENTE:** decidir o banco substituto (Supabase free, que não expira, é o recomendado — já usado no Restaurante 360). O `render.yaml` ainda declara `databases: bella-db` no plano **free do Render**, que **expira de novo em ~30 dias** — se optar por Supabase/Neon, REMOVER esse bloco e trocar `DATABASE_URL` para `sync: false`, preenchendo a string de conexão no painel.

### 🛡️ Treinamento da Bella agora está versionado (não se perde mais)
- Os scripts de carga da sessão anterior **sumiram** (viviam no scratchpad temporário). Reconstruídos como **`apps/api/prisma/seed-conhecimento.js`**, idempotente, já plugado no `startCommand` do `render.yaml` — roda sozinho quando o banco novo subir.
- ⚠️ Só o texto **documentado** foi gravado como ativo (11 conhecimentos + 3 atalhos). Os itens cujo texto original se perdeu (wifi, categorias de apto, limpeza, ingressos, menores; atalhos /banco, /financeiro, /confirmação, /confirmar, /ingressos) entram **inativos/com placeholder `[REVISAR]`** — regra do dono: a Bella não inventa. Precisam ser escritos à mão em /knowledge e /quick-replies.
- O script **nunca sobrescreve** item já revisado à mão no painel.
- ⚠️ Ainda **não foi executado** (não há banco) — validado apenas na sintaxe.
- **PLANO DE RECUPERAÇÃO do banco:**
  1. Se o bella-db foi só suspenso e dá para reativar → reativar (mais simples).
  2. Se foi apagado → criar um Postgres novo. Melhor opção: **Neon ou Supabase (free que NÃO expira)** ou novo Render Postgres. Atualizar `DATABASE_URL` no Render (env do bella-api) e redeployar. O `render.yaml` cria um bella-db novo automaticamente se recriar via Blueprint.
  3. Após o banco voltar: o seed recria hotel/admin/políticas base/aiSettings. **MAS** os **~22 conhecimentos, 8 respostas rápidas e as políticas extras foram carregados via API (não estão no seed)** → **RE-CARREGAR**. Scripts (podem estar no scratchpad da sessão anterior; senão, reconstruir a partir deste ESTADO.md e da memória bella-whatsapp-analise): conhecimentos e atalhos estão listados acima e no histórico.
- **DEPOIS que a API voltar**, aí sim **reaplicar com cuidado** (testando `node dist/main.js` LOCAL com Postgres antes de subir) o conteúdo revertido do 1c2647f: (1) `/api/assist/suggest` (AssistModule), (2) transcrição de áudio (ModelRouterService.transcribeAudio + ChannelsService), (3) saudação "especialista em reservas" (prompts.ts), (4) handoff por horário (orchestrator isWithinBusinessHours), (5) extensão `whatsapp-extension/`. Tudo está no commit **1c2647f** no histórico para recuperar (`git show 1c2647f` / `git revert 588b83a` para desfazer a reversão quando o banco estiver ok).
- **Extensão co-piloto WhatsApp Web** (pasta `whatsapp-extension/`): decisão do dono = NÃO arriscar o número principal com QR/bot. Em vez disso, extensão que SUGERE respostas e insere atalhos, mas o HUMANO envia (risco de ban ~nulo). Foi revertida junto; reaplicar depois de estabilizar a API. Instalação em `whatsapp-extension/COMO-INSTALAR.md`.

## Canais — situação
- **Telegram:** código pronto; falta só criar bot (@BotFather) e pôr `TELEGRAM_BOT_TOKEN` no Render + setWebhook. É o caminho mais rápido para ver a Bella num canal real, sem burocracia.
- **WhatsApp/Instagram oficiais (Cloud API):** caminho escolhido (A) = migrar o número principal para a Cloud API (seguro, sem ban; recepção passa a responder pelo painel — por isso as respostas rápidas/contatos/assumir-controle foram construídas). Bloqueio atual: registro de desenvolvedor na Meta travado por "dispositivo novo" (fazer pelo CELULAR do Victor Bosque, aparelho reconhecido). Depois: criar app → adicionar WhatsApp/Instagram → tokens (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `INSTAGRAM_PAGE_ACCESS_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN`) no Render → configurar webhook `https://bella-api-nh3h.onrender.com/api/channels/{whatsapp|instagram|facebook}/webhook`. Precisa de verificação do negócio (dias). Dono NÃO pode perder o número principal.

## Como conferir dados/deploy
- Push agora funciona direto: `git push origin master` (nut é colaboradora).
- Deploy Render/Vercel é automático no push (~5 min). Health: `GET /api/health`.
- Bubuild local às vezes falha por RAM (fechar apps); `nest build` é mais leve que `next build`.
- Testar API: login em `/api/auth/login` → Bearer token → endpoints.

## Regras/preferências do dono
Custo ZERO sempre. Não arriscar o número principal do WhatsApp. Não pôr preços/promoções na Bella. Aprovar tudo automático (bypassPermissions). Avisar ao chegar em ~90% do contexto e preparar este ESTADO.md.
