# Guia do Teste — Bella AI (pronto para uso)

Passo a passo para colocar em teste real. Endereços:
- **Painel:** https://bella-ai-web.vercel.app
- **API:** https://bella-api-nh3h.onrender.com
- Login: `admin@hoteldobosque.com.br` / senha definida em `ADMIN_PASSWORD` (Render)

---

## 1. Publicar as novidades (uma vez)

No **GitHub Desktop** → **Push origin**. Isso publica tudo o que ficou pronto na
finalização (segurança por login, entrega real de mensagens, follow-up, analytics,
Central da Bella, limpeza). Vercel e Render fazem deploy automático (~3-5 min).

> ⚠️ A partir deste deploy, a API exige **login** (JWT) para tudo, exceto os
> webhooks dos canais e o health check. O painel já faz login e envia o token.

## 2. Limpar os dados de teste (deixar zerado)

Depois do deploy, remover as conversas/leads fictícios criados nos testes:

```powershell
$base = "https://bella-api-nh3h.onrender.com"
$login = Invoke-RestMethod -Method Post "$base/api/auth/login" -ContentType "application/json" -Body '{"email":"admin@hoteldobosque.com.br","password":"SUA_SENHA"}'
Invoke-RestMethod -Method Delete "$base/api/admin/cleanup-test-data" -Headers @{ Authorization = "Bearer $($login.token)" }
```

Preserva hotel, usuários, políticas, conhecimento e configurações da Bella.

## 3. Checklist de teste do painel

Acesse https://bella-ai-web.vercel.app e verifique:

- [ ] **Login** funciona; sem login, o painel redireciona para a tela de entrada
- [ ] **Dashboard** mostra os indicadores
- [ ] **Caixa de Entrada** lista conversas; abrir uma mostra o chat e o perfil
- [ ] **Enviar mensagem** como atendente (entrega real depende do canal conectado)
- [ ] **CRM** mostra o funil; arrastar um lead entre etapas salva
- [ ] **Central da Bella** carrega e salva nome/personalidade/prompts
- [ ] **Conhecimento** lista os 16 itens; dá para adicionar/remover
- [ ] **Políticas** lista as 7 políticas
- [ ] **Auditoria** mostra as interações da Bella
- [ ] **Analytics** mostra canais, funil e desempenho da IA
- [ ] **Modo escuro** (botão na barra lateral) e **Sair**

## 4. Testar a Bella respondendo

Pelo webhook de teste (simula um hóspede), ou pelo canal real quando conectado:

```powershell
$base = "https://bella-api-nh3h.onrender.com"
$body = @{ from = "55479XXXXXXXX"; name = "Teste"; text = "Que horas e o cafe da manha?" } | ConvertTo-Json
Invoke-RestMethod -Method Post "$base/api/channels/webchat/webhook" -ContentType "application/json; charset=utf-8" -Body $body
```

Perguntas para validar o treinamento: café, estacionamento, piscina, pets,
check-in/out, política de cancelamento, e uma reserva ("quero reservar de X a Y
para 2 adultos") — deve gerar o link do Silbeck.

## 5. Conectar os canais reais (quando quiser)

Todos os webhooks apontam para `https://bella-api-nh3h.onrender.com/api/channels/...`

- **Telegram:** criar bot no @BotFather → `TELEGRAM_BOT_TOKEN` no Render →
  registrar webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://bella-api-nh3h.onrender.com/api/channels/telegram/webhook`
- **Instagram/Facebook:** app na Meta (developers.facebook.com) → página + conta
  Instagram Business → `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`,
  `INSTAGRAM_PAGE_ACCESS_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN` no Render → configurar
  webhook no app da Meta com a URL `.../api/channels/instagram/webhook` (e facebook)
  e o mesmo verify token.

## 6. Se algo travar o login (emergência)

No Render → bella-api → Environment → adicionar `DISABLE_AUTH` = `true` → salvar.
Isso desliga a exigência de login temporariamente (usar só para diagnóstico).
Remover depois.

---

## Pendências conhecidas (não bloqueiam o teste)
- Entrega real só funciona nos canais conectados (Telegram/Meta). O webchat de
  teste sempre funciona.
- RabbitMQ, Redis e busca vetorial (Qdrant) são melhorias futuras — hoje o
  conhecimento é injetado direto no prompt (funciona bem para 1 hotel).
- Analisar conversas reais do WhatsApp (exportar .txt e me enviar) para afinar
  ainda mais o tom da Bella.
