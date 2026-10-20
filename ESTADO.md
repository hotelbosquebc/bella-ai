# ESTADO — Bella AI (retomada de conversa)

> Documento de continuidade. Leia antes de continuar. Última atualização: 21/08/2026.

## O que é
**Bella AI** — plataforma SaaS omnichannel de atendimento/reservas/CRM para hotelaria. 1º cliente: **Hotel do Bosque, Balneário Camboriú** (RS Hotelaria LTDA). Dono trabalha em português, autorizou execução autônoma. A Bella é uma "funcionária virtual" (especialista em reservas) que atende, tira dúvidas e gera links de reserva — sem inventar, com guardrails anti-prejuízo.

## 📌 SESSÃO DE 21/08/2026 — o que mudou (leia primeiro)

Dia inteiro de correções guiadas por casos reais (prints de conversas). O padrão
que mais se repetiu: **texto pronto vence regra escrita longe**. Sempre que o
prompt tinha um bloco fechado ("envie exatamente assim") e a ressalva vinha
depois, o modelo seguia o bloco. A solução foi mover a decisão para dentro do
bloco, não reforçar a ressalva.

### Travas determinísticas (não dependem de o modelo obedecer)
Ficam em `assist.module.ts`, dentro de `bookingContext()`:
- **Data inventada:** só aceita `checkin/checkout` se a conversa mencionar data
  (número, relativa ou dia da semana). Caso real: hóspede falou só "5 adultos,
  1 diária" e saiu "entrada de 5 a 6 de setembro".
- **Ocupação inventada:** só aceita `adults` se a conversa mencionar pessoas
  (número, por extenso, tipo de quarto ou composição). Caso real: só datas e
  saiu "para 2 pessoas".
- **Réveillon:** se a estadia inclui 31/12 e tem menos de 5 diárias, o checkout é
  estendido para 5 ANTES de montar o link — senão o site não mostra nada e o
  hóspede acha que está lotado.
- **Vários apartamentos:** um LINK POR APARTAMENTO, com a ocupação de cada um
  (`apartamentos_detalhe` na extração). Pet não conta como pessoa.

### Disponibilidade real (`silbeck-availability.service.ts`)
A Bella consulta o motor antes de responder. A página de busca NÃO traz os
resultados no HTML — a sequência é: GET `/pt-br/reserva/` (cria sessão + token
`sbClientRef`) → POST `/api/hotel/busca-disponibilidades` (datas em DD/MM/AAAA,
campos `data_inicio`/`data_fim`/`categorias_hospede[...]`) → GET da página de
busca → GET `/api/hotel/listagem`. Cache de 10 min. Com isso ela:
- fala de escassez REAL ("Apenas N disponíveis"), nunca inventada;
- detecta período lotado e diz QUAL dia trava a busca, em vez de mandar link
  que não mostra nada.

### Aprendizado contínuo (novo)
Tabela `suggestion_feedback` + `POST/GET /api/assist/feedback`. A extensão compara
o que a Bella sugeriu com o que o atendente realmente enviou e classifica em
`igual`/`editada`/`descartada`. **É o material de treino para a autonomia.**
Revisar com `GET /api/assist/feedback?dias=7` — devolve só as divergências.
Conversa gravada em hash: sem telefone nem nome.

### Extensão — versão 1.2.2
Histórico da 1.1.x: leitura de contexto (o WhatsApp Web guarda UMA mensagem e o
resto fica no celular — clicamos o aviso "carregar mensagens antigas"), memória
local por conversa, painel arrastável, anexo como DOCUMENTO (foto o WhatsApp
comprime e as regras ficavam ilegíveis).
⚠️ **Lição cara:** a 1.2.0 travou o WhatsApp Web em produção — eu tinha posto
trabalho pesado dentro do `MutationObserver`, fora do debounce. **Nada dentro
daquele observador pode ser caro.**
⚠️ Desinstalar a extensão APAGA o login (storage). Atualizar preserva.

### Base de conhecimento: 41 itens, todos ativos
Nenhum `[REVISAR]` restante. Entraram no dia: 4 categorias com andares
(Standard 1º-2º, Superior 5º-6º, Suíte Bosque 7º-8º; **Luxo pendente**),
estacionamento completo (gratuito, 1 vaga inclusa, 2º carro com reserva prévia,
coberto/descoberto, veículos aceitos), Réveillon, café buffet (pães TÊM glúten),
pets até 12 kg, check-in (titular ou nome cadastrado), berço, guarda-volumes,
elevadores (adaptado ocupado sem previsão), pós-reserva, cancelamento
direto x OTA, Wi-Fi (senha `bosque00`, nome varia por roteador).
**Atalhos do painel REMOVIDOS** a pedido do dono — a recepção usa os nativos do
WhatsApp ("/").

### Regras de conduta que o dono definiu
- Ela NÃO reserva: tira dúvidas e manda o link; o pagamento no site confirma.
  Não fala de sinal, prazo nem validade de pré-reserva (isso é do fluxo humano).
- Apresenta-se como "Bella, assistente online do Hotel do Bosque" na primeira
  resposta de CADA DIA.
- Responde no idioma do hóspede (blocos de abertura prontos em PT/ES/EN).
- Vende: reduz atrito, fala em benefício, fecha com um passo. Escassez SÓ com o
  dado da consulta real.
- Na dúvida, encaminha para humano com telefone e horário do setor.
- Multas: informa que existem, sem valores (exceto faixas de cancelamento).

### Pendências
1. **Modo da Bella:** trocar para 🟢 **Ligada** no painel (estava "Automática",
   que não sugere durante o expediente — foi o que fez o dono mandar orçamento à mão).
2. **Andar do Apartamento Luxo** — único dado de categoria faltando.
3. **Relatório de feedback** depois de alguns dias de uso.
4. Considerar publicar a extensão como não listada na Chrome Web Store (US$ 5
   uma vez) — hoje cada PC atualiza na mão e um ficar para trás já causou bug.

## Onde fica o código
- Repo: **C:\Users\BOSQUE\Documents\GitHub\bella-ai** (a sessão roda no dir do GitHub Desktop, NÃO é onde fica o código).
- Monorepo npm: `apps/api` (NestJS + Prisma/PostgreSQL) e `apps/web` (Next.js App Router).
- Docs: `docs/PRD.md`, `docs/ARQUITETURA.md`, `docs/DEPLOY.md`, `docs/GUIA-TESTE.md`, `docs/CONEXAO-CANAIS.md`.

## Está NO AR (produção)
- **Painel:** https://bella-ai-web.vercel.app (Vercel, projeto bella-ai-web, conta GitHub hotelbosquebc)
- **API:** https://bella-api-nh3h.onrender.com (Render, workspace "My Workspace", serviço srv-d8velvn7f7vs73866b3g)
- **Banco:** PostgreSQL gerenciado pelo Render (bella-db, região Virginia, plano free — ⚠️ expira ~30 dias, migrar depois)
- **Login painel:** admin@hoteldobosque.com.br — a senha NÃO fica aqui. Ela é a variável `ADMIN_PASSWORD` no Render (bella-api → Environment), que o seed reaplica no admin a cada deploy. Para trocar: edite a variável e faça "Manual Deploy → Deploy latest commit". O mesmo login vale para o painel e para a extensão.
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
- **Políticas oficiais** (7): cancelamento em faixas (30d/10%, 29-15d/50%, 14-8d/80%, <7d/100% sem reembolso, só crédito 1 ano), check-in 14h até 18h, check-out 11h, no-show, pets (**NÃO cobra diária do pet**; R$200 é taxa mínima só em caso de descumprimento de norma/limpeza extra — não confundir), pagamento (sinal 50%), grupos.
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
- ✅ **IA CORRIGIDA (commit `7fe393d`) — era BUG DE CÓDIGO, não env faltando.**
  - As envs do Render estavam **todas certas** (8 variáveis, incluindo `AI_PROVIDER` e `GOOGLE_API_KEY` válida). Duas hipóteses minhas foram descartadas: "envs sumiram" e "`AI_PROVIDER=mock`".
  - **Causa real** (achada no log do Render): `ERROR [ModelRouterService] Falha no provedor gemini (gemini-flash-lite-latest): Gemini 400 INVALID_ARGUMENT`. O `modelFor()` migrou para os aliases **`-latest`**, que **rejeitam `thinkingConfig`**. O `catch` do `complete()` degrada para `mock` — então o bug ficava **silencioso**: a Bella respondia "estou com a inteligência em configuração" e nada acusava erro.
  - Medido: `gemini-flash-lite-latest` e `gemini-flash-latest` → **400 COM** `thinkingConfig`, **200 SEM**. `gemini-2.5-flash` → 200 nos dois (não está descontinuado, apesar do comentário no código).
  - **Correção:** `fetchGemini()` tenta com `thinkingConfig` e, ao receber 400 INVALID_ARGUMENT, repete sem e memoriza o modelo (`semThinkingConfig`). Não chumba nomes de modelo — o Google troca os aliases. Mesmo bug corrigido em `transcribeAudio()`.
  - Seguro remover o parâmetro: `lite-latest` gera **0 thought tokens** (era inútil ali) e nada truncou (`finishReason: STOP`).
  - ⚠️ **LIÇÃO:** o fallback para `mock` esconde falha de IA. Ao suspeitar da Bella, **ler os Logs do Render** antes de mexer em env — o provedor ativo é logado no boot (`Provedor de IA ativo: X`).
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

## 🎯 ESCOPO DEFINIDO PELO DONO (13/08/2026)
**A Bella NÃO fecha reserva.** Ela apenas (1) envia o link do site para o hóspede reservar sozinho e (2) responde dúvidas. Quem fecha é o hóspede no site ou a equipe humana.
- ✅ Guardrails do `MASTER_PROMPT` já batem com isso: não inventa, não promete desconto, não autoriza cancelamento/estorno/reembolso, escala para humano na dúvida.
- ✅ **Link de reserva VALIDADO em 13/08/2026** (aberto em navegador real): `buildBookingLink` gera `/pt-br/reserva/busca/?checkin=YYYY-MM-DD&checkout=…&adultos-000001=N&criancas-000003=&criancas-000004=` e a página abre **direto nos resultados**, com as 4 categorias e "TOTAL (3 Diárias)" correto. ⇒ A divergência de formato anotada no bloco "Motor de reservas real" **já foi corrigida**; ignorar aquele ⚠️.
- ✅ **Parâmetros de CRIANÇA confirmados** (era pendência antiga). A URL é traduzida corretamente para os campos internos do Silbeck: `adultos-000001` → `categorias_hospede[000001]`, `criancas-000003` → `[000003]` (0-6), `criancas-000004` → `[000004]` (7-9). Teste 20-23/09/2026: 2 adultos → Standard R$385/diária; +1 criança 0-6 +1 criança 7-9 → R$485/diária (**+R$100**, a de 7-9 cobrada e a de 0-6 cortesia). ⇒ ocupação chega certa e o preço reflete.
- ⚠️ `curl` no link dá **403 (Cloudflare/captcha)** — é proteção anti-bot, NÃO link quebrado. Para testar, usar navegador de verdade.
- Como ela só manda link, os 5 atalhos `[REVISAR]` **não a afetam** — são ferramenta do atendente humano na extensão. Não bloqueiam o uso.

### ✅ Bella VALIDADA em produção (13/08/2026, commit `a68a151`)
Testes reais no `/api/assist/suggest`, modelo `gemini-flash-lite-latest` (não mock):
| Cenário | Resultado |
|---|---|
| "Vocês têm piscina?" | "não contamos com piscina" ✅ (não inventou) |
| "Horário do café?" | "7h às 10h, restaurante do térreo" ✅ (bate com a base) |
| Reserva completa (2 ad + 1 criança 5a, 20-23/09) | link correto com `criancas-000003=1` ✅, **sem citar preço** ✅ |
| Reserva incompleta ("feriado de 7/9") | pediu APENAS "quantos adultos" ✅, sem link ✅ |
| "Aceitam cachorro?" | pet-friendly, sem diária do pet ✅ (correto — ver nota de pets acima) |

- ⚠️ **`/api/assist/suggest` NÃO cria registros** (sem lead/conversa/follow-up). É só co-piloto. O CRM só é alimentado pelo orquestrador (canal oficial da Meta, ainda não ligado).

## 🎛️ Modos da Bella — liga/desliga e automático (13/08/2026, commit `6e06381`)
`AiSettings.mode` (migration `20260813180000_ai_settings_mode`), editável na **Central da Bella** e aplicado **na hora** (sem botão Salvar):
| Modo | Efeito |
|---|---|
| `on` | sugere sempre |
| `auto` (**padrão**) | só **fora** do horário de reservas; no expediente o atendimento fica com a equipe |
| `off` | parada — botão some na extensão E `/api/assist/suggest` recusa (`model: "desligada"`) |

- `GET /api/assist/status` → `{mode, dentroDoHorario, autoSuggest, manualDisponivel}`. A extensão consulta **a cada 60s**, então trocar o modo no painel e a virada do horário entram sozinhas.
- **Envio NUNCA é automático no WhatsApp Web.** "Automática" = a sugestão já vem pronta ao abrir a conversa (auto-sugestão via MutationObserver); quem envia é sempre o atendente. Decisão do dono (13/08/2026) — o número principal não recebe automação de envio.
- O orquestrador (canal oficial da Meta) respeita os mesmos modos.
- ✅ Testado em produção nos 3 modos (off recusa, on auto-sugere, auto respeita o expediente).

## 🕐 Horário de atendimento centralizado (`apps/api/src/modules/bella/business-hours.ts`)
Estava privado no orquestrador → o co-piloto não via, e a Bella prometia "transferir agora" às 22h de domingo. Agora `isWithinBusinessHours()` + `contextoDeHorario()` são usados pelos dois caminhos. **Testado: 11 casos** (bordas das duas janelas, almoço, fim de semana, fuso America/Sao_Paulo vs servidor em UTC).
- **Grupos/excursões:** regra explícita no `MASTER_PROMPT` — nunca cotar/negociar; informar o horário do setor; fora do horário, não prometer atendente imediato e oferecer a recepção 24h. ✅ Validado: escala excursão de 40 pessoas e time de futebol sem cotar.

## 💻 Instalação nos PCs (recepção + dono)
- **A API NÃO é instalada em PC** — roda no Render. Nos PCs instala-se só a **extensão do Chrome**.
- ZIP gerado em `Área de Trabalho\Bella-Extensao-WhatsApp.zip` (regerar: `Compress-Archive` da pasta `whatsapp-extension`).
- Extrair em pasta **definitiva** (ex.: `C:\Bella\whatsapp-extension`) — o Chrome carrega dali para sempre; se apagar, quebra.
- `chrome://extensions` → Modo desenvolvedor → Carregar sem compactação → 🧩 Bella → Opções → login do painel.
- Ambos os PCs falam com a mesma API; o modo vem do painel e vale para os dois.
- 📌 Ideal criar usuário próprio para a recepção (auditoria) — ainda não feito.

## 🖼️ ANEXOS DA BELLA — implementado (13/08/2026, commits `7997d9f` + `2d56ae5`)
A sugestão vem com o arquivo pronto para o atendente enviar (envio segue **manual**).
- Modelo `Attachment` (migration `20260813200000_attachments`), arquivos em **base64 no próprio banco** — regra de custo ZERO, sem storage contratado.
- Casamento anexo↔pergunta por **palavra-chave** (campo `keywords`), não por IA: previsível, sem gastar chamada, e o dono controla o que dispara cada arquivo.
- `GET/POST/DELETE /api/attachments` + `GET /api/attachments/:id/file` (público — UUID não adivinhável; a extensão baixa sem token).
- **Tela `/anexos` no painel** para o dono cadastrar sozinho (upload, palavras-chave, ver, excluir). Limite 18 MB no cliente.
- ⚠️ `main.ts`: body limit subiu para **25mb** — base64 de PDF passa de 10 MB e o padrão de 100kb do Nest rejeitava.
- Extensão: botão "📎 Anexar" insere via `input[type=file]` do WhatsApp (funciona até para PDF), com fallback de colar imagem; se ambos falharem, **avisa para usar o clipe manualmente** em vez de fingir que anexou.
- ✅ Testado: pergunta de ingressos → PDF anexado + ela menciona o anexo sem repetir o conteúdo. Pergunta de check-in → nenhum anexo.
- 🚨 **NÃO VALIDADO no WhatsApp Web real** — a inserção de arquivo depende dos seletores do WhatsApp. Testar no PC e, se falhar, ajustar `inserirArquivo()` em `content.js`.
- **Cadastrados:** só o `INGRESSOS.pdf` (10,4 MB). **FALTAM** `PETS.png` e `NORMAS.png` — o dono precisa salvá-las em `Área de Trabalho\bella-anexos\` (as imagens vieram coladas no chat, não em disco). Script pronto: `scratchpad/anexos.js`.

## 📚 Base de conhecimento quase completa (13/08/2026)
Das 5 lacunas `[REVISAR]`, **4 foram preenchidas com fonte oficial** (folha "Bem Vindo ao Hotel do Bosque" enviada pelo dono + site de reservas):
- **Wi-Fi:** senha **bosque00**, mesma para todo o hotel ✅
- **Limpeza:** diária 8h-15h, louça é do hóspede, não se limpa com pets/hóspedes no apto ✅
- **Categorias:** Suíte Bosque (7º-8º, 2 banheiros + aquecimento a gás), Luxo (3º-4º, mais novos), Superior (5º-6º, +1 TV), Standard (1º-2º, mais básicos) — todas cap. 6 ✅
- **Ingressos:** lista das atrações do material ✅
- **NOVO "Normas gerais do hotel":** chave (perda R$300), 220V, toalha de praia não emprestada (multa R$200), **proibido fumar (multa R$500)**, não hospedado sem aviso = diária extra, silêncio após 22h, bebidas na recepção.
- ✅ **"Menores de idade" preenchido** (ditado pelo dono em 13/08/2026): 0-6 anos **cortesia**; 7-9 anos **valor especial de criança**; 10+ **integral como adulto**. Bate com o motor de reservas (`criancas-000003` = 0-6, `criancas-000004` = 7-9, `adultos-000001` = 10+).
- 🎉 **BASE COMPLETA: 17 conhecimentos, 0 com `[REVISAR]`, 0 inativos.** A perda do banco foi 100% revertida.
- ⚠️ **CONFIRMAR com o dono:** a **Política Infantil** diz "7 a 9 anos pagam **50%** do valor por pessoa" e a Bella está informando isso ao hóspede. O dono descreveu como "valor especial" sem citar percentual — se os 50% mudaram, corrigir a política.
- ☎️ **(47) 99690-4414 NÃO EXISTE MAIS** (número antigo do hotel, confirmado pelo dono em 13/08/2026). Removido do conhecimento "Normas gerais do hotel" — varredura confirmou **zero** ocorrências no banco e no código. O contato oficial da Bella é **(47) 3367-0211** (recepção 24h).
- ✅ **RESOLVIDO — imagem `NORMAS.png` corrigida pelo dono** (13/08/2026): ele apagou a linha de telefones da arte; conferido visualmente (sobrou só o endereço) e o anexo foi **substituído** no banco (sobe o novo, só então apaga o antigo — nunca fica sem anexo).
- (histórico) O número morto estava IMPRESSO na imagem `NORMAS.png` (rodapé: "Reservas: (47) 99690-4414"), que está cadastrada como anexo ativo e é enviada ao hóspede quando ele pergunta de normas/regras/fumar/toalha/chave. **Apagar o texto não resolve a imagem.** Opções: (a) excluir o anexo "Normas do Hotel do Bosque" — o texto das normas já responde sozinho e está correto; (b) subir arte nova pela tela `/anexos`. Dono ainda não decidiu.

## 🖼️ (histórico) pedido original de imagens
Dono quer que a sugestão já venha com imagem anexada (caso típico: **folha de normas de pets**). Envio segue manual.
- Decisão pendente de **onde hospedar** a imagem (regra: custo ZERO). Candidatos: `KnowledgeDocument.fileUrl` (campo **já existe**) com URL pública do site do hotel, ou base64 no Postgres para poucas imagens.
- Parte difícil: **inserir imagem no WhatsApp Web** exige colar via `ClipboardEvent`/`DataTransfer` com um `File` (texto é fácil, imagem não). Validar cedo — é o ponto de risco.
- Precisa também de critério de "qual imagem para qual pergunta" (casar assunto → conhecimento com imagem).

## 📖 BASE COMPLETA — questionário do dono (13/08/2026)
O dono respondeu um questionário de 110 perguntas. Base foi de 17 → **25 conhecimentos**, todos ativos, 0 `[REVISAR]`. Políticas todas em **v2 aprovada**.

### 🐛 Duas falhas SILENCIOSAS achadas ao carregar (commit `7be70d6`)
1. **`getKnowledgeContext` cortava a base em 12.000 caracteres com um `break` sem aviso.** Com o questionário a base foi a **~10.625** — quase encostou. Sintoma seria a Bella "esquecer" um conhecimento que está ativo no painel, sem erro nenhum. Limite → **60.000** e agora o corte **loga** o que ficou de fora.
2. **`findRelevant` devolvia TODAS as versões aprovadas da categoria, não só a mais recente.** Ao versionar uma política, a regra nova e a antiga iriam juntas ao prompt se contradizendo. Agora fica só a maior versão por categoria. ⚠️ Sem isso, a v1 da Política Infantil (com "50%") continuaria valendo junto com a v2.

### Regras que MUDARAM em relação ao que estava cadastrado
- **Crianças 7-9 anos:** NÃO é mais "50%" — é **valor adicional VARIÁVEL**. O dono reescreveu a pergunta trocando o percentual. A Bella estava afirmando 50% a hóspedes. Corrigido no conhecimento e na Política Infantil (v2).
- **Cortesia infantil:** limite de **1 criança gratuita por adulto pagante**; a criança em cortesia **conta** na capacidade de 6.
- **Pets:** pequeno **e médio** porte (antes só pequeno), até **2 por apartamento**.
- **Limpeza:** NÃO é automática — só mediante **entrega da chave na recepção**, obrigatória a cada 3 dias. Toalha trocada se deixada no chão; roupa de cama a cada 3 dias.
- **Silêncio:** sempre que incomodar outro hóspede (a folha de Normas diz "após 22h").
- **Visitantes:** máx. **15 minutos** com aviso à recepção; acima disso ou sem aviso = **diária extra**.
- **Área verde (17 mil m²):** é **área de preservação SEM ACESSO** — não prometer trilha/uso.

### ⏰ TRÊS horários diferentes — não confundir
| Operação | Horário | Onde vive |
|---|---|---|
| **Setor de reservas** (alteração/cancelamento **por escrito**) | seg-sex **8h-18h** | Política de Cancelamento v2 |
| **Atendimento humano de reservas** (sinal PIX 50%, PIX parcelado) | seg-sex **9h-12h e 15h-18h** | Política de Pagamento v2 |
| **`business-hours.ts`** (handoff + modo automático da Bella) | seg-sex **9h-12h e 14h30-17h30** | código |
✅ **DECIDIDO pelo dono (13/08/2026): o modo automático e o handoff seguem 9h-12h e 14h30-17h30** — ou seja, `business-hours.ts` fica como está. Os outros dois horários valem só para os textos das políticas (são operações diferentes) e NÃO devem ser propagados ao código.

### Outros dados novos relevantes
32 apartamentos · 2 elevadores · apto PCD existe (confirmar disponibilidade) · sem cofre · sem Smart TV (só TV a cabo; Standard só na sala) · sem micro-ondas nos aptos (um no térreo p/ empréstimo) · sem lavanderia · berço grátis sob solicitação · até 3 colchões extras · sofá-cama só em alguns · café p/ não hospedado a partir de R$40 · panquecaria/creperia à noite · delivery permitido · 3 churrasqueiras (grelha/espetos fornecidos, limite 22h) · ônibus não estaciona (terceirizado a poucos metros) · sem carregador elétrico · ~100m da praia · sem WhatsApp de recepção (ramal 9 ou fixo **(47) 3367-0211**, que fica CONFIRMADO como o contato oficial).
- ✅ **Churrasqueira: uso GRATUITO** para hóspedes (confirmado pelo dono em 13/08/2026). Reserva na recepção, limite 22h, grelha e espetos fornecidos.

## ✅ EXTENSÃO VALIDADA NO WHATSAPP WEB REAL (13/08/2026)
Instalada no PC do dono e testada em conversa real. Dois bugs achados só no uso real:

1. **A extensão não lia mais NENHUMA mensagem** (commit `ea6b23f`). O WhatsApp Web mudou a estrutura: `div.message-in` / `span.selectable-text` não achavam nada. Sintoma enganoso: o painel dizia *"Abra uma conversa com mensagens primeiro"* numa conversa cheia de mensagens, a Bella **nunca era consultada**, e sobravam só os atalhos — o dono percebeu como "ela só dá resposta pré-pronta".
   - Agora a leitura é em camadas: `message-in/out` → `div[role="row"]` → `div[data-id]`; remetente pela classe, pelo ícone de status (`[data-icon^="msg-"]`, só mensagem nossa tem) ou pelo prefixo `true_`/`false_` do `data-id`; último recurso manda o texto cru de `#main`.
   - `__bellaDebug()` no console do WhatsApp mostra o que a extensão enxerga.
   - 💡 **Como saber se o Chrome está rodando código velho:** a frase de erro antiga era "Abra uma conversa **com mensagens** primeiro". Se ela aparecer, a extensão NÃO foi recarregada em `chrome://extensions` (botão 🔄 no cartão).
2. **Formatação impublicável** (commit `247aca5`). O link saía colado no texto (`reservas:https://...`) — o WhatsApp quebra o endereço e o hóspede recebe link morto. Texto corrido e `**markdown**` que o WhatsApp não renderiza.
   - Prompt pede blocos curtos + link isolado + sem markdown, **e** `formatarParaWhatsApp()` aplica as mesmas regras de forma determinística na saída (não confia na obediência do modelo).
   - Identidade: agora se apresenta SEMPRE como **"Bella, assistente online do Hotel do Bosque"** (pedido do dono).

✅ **Funcionamento confirmado ponta a ponta:** hóspede escreveu "de hoje até domingo duas pessoas" → a Bella leu a conversa, converteu as datas relativas (13/08 → 16/08), montou o link com 2 adultos e o atendente enviou.

📌 Instalação do dono: pasta **`C:\Bella\whatsapp-extension`** (ID `iijccindcfcienihooalcfiilcillfdb`). Opções direto por `chrome-extension://iijccindcfcienihooalcfiilcillfdb/options.html`. **Ao mexer na extensão, sempre copiar o arquivo alterado para `C:\Bella\` e mandar recarregar em `chrome://extensions`.**
- ⚠️ Ainda NÃO testado: o botão **📎 Anexar** (inserir arquivo no WhatsApp) e o teste do modo Desligada.

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

## 🎓 Aprendizado diário + atalhos do uso real (08/09/2026, commit `7fa3b09`)

**Atalhos sugeridos.** `GET /api/assist/atalhos-sugeridos` agrupa o que a recepção
já enviou várias vezes, quase igual, para hóspedes diferentes — isso já é um
atalho, só não tinha botão. Aparece em **Respostas Rápidas**; ao aprovar, vira
`QuickReply` e chip no painel do WhatsApp (encanamento que já existia).
Ficam de fora orçamentos com link e textos com valores, de propósito.

Limiar de "mesma resposta" = **0,32**, medido: paráfrases reais ficaram entre
0,38 e 0,64; assuntos diferentes entre 0,03 e 0,18.

**Aprendizado.** `POST /api/assist/aprender` roda 1x/dia, chamado pela extensão
(`aprendizadoDoDia()` no `background.js`, marca a data em `chrome.storage`).
Lê as divergências sugestão × enviado e propõe regras de uma frase.
Toda lição nasce **pendente** e só entra no prompt depois de aprovada na tela
**🎓 Aprendizado**. Travas em código (`licaoAceitavel`) barram antes disso:
dinheiro e "fechar reserva". Lições aprovadas entram via `contextoDasLicoes()`,
com cache de 10 min invalidado a cada aprovação.

**Relatório.** `GET /api/assist/temas` — assuntos que ela mais responde e o
aproveitamento (quantas foram enviadas sem edição). Aparece em **Analytics**.

⚠️ Os números anteriores a 08/09/2026 estão contaminados: o regex que descobria
o autor do último balão estava sem as barras invertidas, então toda última
mensagem era tratada como nossa e o texto do hóspede virava "enviado".
Corrigido na 1.6.1.

**Tabela nova:** `licoes` + coluna `analisado` em `suggestion_feedback`
(migration `20260908160000_licoes`). Precisa ir junto na migração para o Supabase.

## 🧠 Ler sem IA + sobreviver ao 429 (09–10/09/2026)

**A cota é por MINUTO, não por dia.** O plano grátis do Gemini dá 20 requisições
por minuto para o PROJETO inteiro, compartilhadas por todos os modelos — por isso
trocar de modelo não ajuda. Quando estoura, `completeMock` devolve
`{intent:'other'}` vazio, que é idêntico a "o hóspede não informou nada": foi essa
confusão que gerou as promessas de link sem link.

Diagnóstico, público e sem gastar cota:
- `GET /api/assist/diagnostico-ia` — quedas com o motivo de cada modelo
- `GET /api/assist/diagnostico-link` — por que saiu (ou não) link, com `semIA`

**O que passou a rodar sem IA nenhuma** (`assist.module.ts`):
- `intervalosNaFala()` — lê `10/10 a 12/10`, `14 a 19 janeiro`,
  `28 janeiro a 02 fevereiro`, `de 8 a 13 de setembro`. Mês por PREFIXO de 3
  letras (o hóspede erra: "janwiro"). Devolve TODOS os períodos: "ou" = duas
  alternativas, não uma.
- `extrairDeterminista()` — período + ocupação explícitos ⇒ zero chamadas de IA.
  Devolve `null` em qualquer ambiguidade (dois períodos, "casal", vários quartos).
- `ocupacaoNaFala()` + `normalizarOcupacao()` — **≥ 10 anos conta como adulto**
  (política: 0-6 cortesia, 7-9 meia, 10+ adulto). Idade só conta perto de palavra
  de criança, senão "venho há 10 anos" viraria hóspede.
- `datasCorroboradas()` — o dia extraído precisa aparecer na fala. "Final
  novembro" não corrobora 01/12.
- `respostaSemIA()` — com o modelo fora, pede o período em pt/es/en, só o que
  falta, respeitando a apresentação diária.

**Extensão 1.8.1:** auto-sugestão só quando o HÓSPEDE fala algo novo (15s de
intervalo); `audiosLidos` virou WeakMap; histórico só grava quando muda.

⚠️ **Quedas em PARES no mesmo segundo = WhatsApp Web com Bella automática em duas
máquinas.** Deixar automático em uma só corta metade do consumo.

⚠️ **PENDENTE — a única peça que falta:** 2ª e 3ª `GOOGLE_API_KEY` (contas Google
diferentes), separadas por vírgula em Render → bella-api → Environment. O rodízio
já está implementado e ativa sozinho no 429.

⚠️ **PENDENTE — backup:** `DATABASE_URL="..." node scripts/backup.js` antes de o
Postgres grátis expirar (~12/09/2026). `scripts/restore.js` recoloca em outro banco.

---

## PEDIDOS DO DONO — fazer DEPOIS que o WhatsApp estiver no ar (15/10/2026)

Ele pediu para ser lembrado quando terminarmos a integração. Estão aqui, e não
na memória, porque é aqui que eu procuro ao retomar.

### 1. Pedido de atendente → horário + telefone fixo

A Bella deve reconhecer quando o hóspede quer falar com uma pessoa e, junto do
encaminhamento, **informar o horário de atendimento e o telefone fixo
(47) 3367-0211**.

**O que JÁ existe:** `motivoParaHumano()` detecta o pedido ("falar com um
atendente", "isso é um robô?", espanhol e inglês) e escala; e
`contextoDeEntregaAoHumano()` já distingue dentro/fora do expediente.

**O que FALTA:** o telefone não é garantido — hoje ele só aparece se o modelo
resolver tirar da base de conhecimento. Precisa virar texto pronto na entrega,
como fizemos com o link: a regra escrita longe não basta.

### 2. Baixar os contatos da agenda do Google para o app

Importar a agenda vinculada ao Google (Google Contacts) para dentro do painel,
para o hotel ter os contatos junto das conversas.

**Caminho provável:** exportar do Google Contacts em vCard/CSV e importar pela
tela de Contatos — sem OAuth do Google, que exigiria verificação do app e
traria custo de manutenção para um hotel.

**Lembrar:** a coexistência do WhatsApp **já sincroniza todos os contatos** com
número de WhatsApp. Conferir se o do Google ainda é necessário depois disso, ou
se vira só complemento de quem não tem WhatsApp. Perguntar ao dono antes de
construir.

### 3. "mais alguns detalhes" — ele disse que lembrará depois

Perguntar quando retomarmos.

---

## INTEGRAÇÃO META — estado em 15/10/2026

**Empresa:** RS HOTELARIA LTDA (nome fantasia Hotel do Bosque), CNPJ
58.003.665/0001-39, Av. Brasil 22, Centro, Balneário Camboriú/SC.
Natureza jurídica 206-2 (Sociedade Empresária Limitada) = "Empresa privada"
no formulário da Meta.

**App:** `Bella – Hotel do Bosque` — ID `2215365896075704`, tipo Empresa,
**modo desenvolvimento**.

**Portfólio do app:** `178424846189517` (o que tem a Página e o Instagram).

⚠️ **Existe um SEGUNDO portfólio** `307228995768274`, também chamado "Hotel do
Bosque", e é nele que está a **Conta do WhatsApp**. Os ativos estão divididos.
Depois de tudo no ar, consolidar num só — ter Página num e WhatsApp noutro vai
atrapalhar a cada permissão nova.

**Página do Facebook:** `468053440611433`.

⚠️ A Página do **NUT Restaurante** (`102729104999214`) também está conectada ao
app e o dono **não tem permissão** para removê-la. A proteção está no código
(`paginaCorreta()` em channels.service.ts): mensagem endereçada a outra Página
é ignorada.

**No ar (modo desenvolvimento):**
- Messenger: webhook + campo `messages` assinados, Bella respondendo sozinha.
- Instagram: idem, pelo caminho clássico (Página), não pela API nova de
  "login da empresa no Instagram" — nosso código não fala aquela língua.
- Primeiras medições: Facebook 10,1s | Instagram 5,1s e 11,9s. **Lento** perto
  da extensão (1,3–2,5s). Falta instrumentar por etapa antes de otimizar.

**Variáveis no Render:** META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN
(`bosque-bella-2026`), FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID,
INSTAGRAM_PAGE_ACCESS_TOKEN, API_PUBLIC_URL.

**Verificação do negócio:** ENVIADA em 15/10/2026, "Em análise" (~2 dias úteis).

**Fila depois dela:**
1. Verificação de acesso → **Provedor de Tecnologia** (requisito da coexistência)
2. Análise do app (`pages_messaging`, `instagram_manage_messages`) para sair do
   modo desenvolvimento e atender o público
3. Preencher no app: **URL da Política de Privacidade** (não existe no site — eu
   escrevo) e **Domínios do aplicativo** (`bella-ai-web.vercel.app`, exigido pelo
   Cadastro Incorporado)
4. Coexistência do WhatsApp pela tela `/whatsapp` do painel
5. Token permanente de **Usuário de Sistema** (o da Meta expira em ~60 dias)
6. Modelos de mensagem aprovados para o follow-up fora da janela de 24h

⚠️ **Autenticação de dois fatores está em "Ninguém"** nos dois portfólios. Esse
portfólio controla Página, Instagram e em breve o WhatsApp do hotel.

---

## Análise do App — estado em 16/10/2026

**Verificação do negócio: APROVADA** em 17/10 (portfólio `178424846189517`,
"Verificado"). Destravou a trilha de Provedor de Tecnologia.

**Caminho escolhido:** Provedor de Tecnologia **independente** (não Parceiro de
Soluções). Na pergunta da Meta "você está criando uma integração para vários
clientes empresariais?" respondemos **Sim** — é isso que permite a coexistência
do número. "Em nome de um cliente individual" jogaria o app para a trilha
simples, sem coexistência.

**Configurações básicas do app — preenchidas e conferidas após recarregar:**
- Ícone 1024×1024 (logo HB fundo verde) ✔
- URL da Política de Privacidade: `https://bella-ai-web.vercel.app/privacidade` ✔
  (página pública nova em `apps/web/app/privacidade/page.tsx`, fora do grupo
  `(app)` justamente para o revisor abrir sem login)
- Categoria: Negócio e Páginas ✔
- Domínios do aplicativo: `bella-ai-web.vercel.app` ✔

⚠️ O upload do ícone **recarrega o formulário e apaga o que estiver digitado e
não salvo**. Subir o ícone primeiro, depois preencher o resto.

**Pedido de análise** (`submission_id=2216495959296031`), permissões
`whatsapp_business_messaging` e `whatsapp_business_management`:

| Seção | Estado |
|---|---|
| Verificação | ✅ |
| Configurações do app | ✅ |
| Tratamento de dados | ✅ |
| Uso permitido | ⭕ só falta o contador de API |

**Vídeos gravados** (PowerPoint → Inserir → Gravação de Tela; o Game Bar está
desligado nesta máquina e só grava uma janela, não serve):
- `video1-envio.mp4` — painel da Meta disparando e WhatsApp Web recebendo, lado
  a lado numa gravação só.
- `video2-modelo.mp4` — criação do modelo `confirmacao_de_contato` no WhatsApp
  Manager.
- O PowerPoint salva a apresentação, não o vídeo. O .mp4 está dentro do .pptx
  (é um zip, em `ppt/media/`) — dá para extrair com System.IO.Compression.

⚠️ **Não usar a sugestão de texto da IA da Meta**: ela afirmava que a plataforma
"já integrou vários hotéis" e que eles "relataram aumento de satisfação". É
falso. As descrições foram escritas à mão, dizendo que o Hotel do Bosque é hoje
o único cliente.

**Tratamento de dados — o que foi declarado:**
- Operadores: Google LLC (Gemini API), Render Services, Supabase, Vercel — todos
  "TI e nuvem", processando nos **Estados Unidos** (Render em Virginia pelo
  `render.yaml`; Supabase em "leste-americano-2").
- Responsável pelos dados: RS HOTELARIA LTDA, Brasil.
- Pedidos de autoridades públicas nos últimos 12 meses: Não.
- Prática assumida: apenas "análise obrigatória sobre a legitimidade das
  solicitações" (decisão do dono — as outras três ele não quis assumir).

**O bloqueio:** `0 de 1 chamada(s) de API obrigatória(s)` nas duas permissões.
As chamadas de teste foram feitas em 16/10 às 13:54 e 14:01 (número de teste
`+1 555 661-0396`, Phone Number ID `1433149153207724`, WABA de teste
`1444894994490937`). A Meta avisa que os dados de teste levam **até 24 horas**
para aparecer no formulário. Enquanto estiver em zero, "Enviar para análise"
fica cinza.

**Próximo passo (a partir de 17/10):** abrir o pedido, conferir se o contador
virou e clicar em **Enviar para análise**. Se ainda estiver zerado, repetir o
disparo na Etapa 1 e esperar mais.

**Modelos criados na WABA de teste:** `recebemos_sua_mensagem` e
`confirmacao_de_contato` (ambos Utilidade, pt-BR, em análise).

⚠️ Um token temporário do número de teste apareceu num print durante a sessão e
foi regenerado em seguida. Não reaproveitar prints antigos dessa tela.

---

## Segurança dos portfólios — faxina de 16/10/2026

**Correção:** a verificação do negócio foi aprovada em **15/10/2026** (a tela da
Central de Segurança mostra "Verificada originalmente em Oct 15, 2026"), não 17.

**2FA ativada** na conta do dono (Victor Bosque) por app de autenticação, com
códigos de recuperação impressos. Exigência ligada nos dois portfólios:
`178424846189517` em "Somente administradores", `307228995768274` em "Todos",
nenhuma pessoa pendente.

**Acessos removidos do portfólio `178424846189517`:**
- Convite pendente de `victor.ras@hotmail.com` (acesso total + Finanças, nunca
  aceito) — cancelado.
- Conta "Bosque Apart H. Balneário Camboriú" (acesso total, inativa, sem 2FA,
  e que **podia excluir o portfólio**) — removida. Os ativos pertencem ao
  portfólio, não a ela, então nada se perdeu.

Sobraram duas contas, ambas do dono e ambas com 2FA: Victor Bosque e
Hotel do Bosque (@hotelbosquebc).

**O "administrador antigo da agência" era alarme falso.** Nenhuma agência tem
acesso aos ativos do hotel: zero parceiros no portfólio e zero na Página. O que
existia era o inverso — a conta do dono aparece como pessoa de **acesso básico,
sem nenhum ativo atribuído**, dentro do portfólio `439185823713823`
("Fiama.MK", de terceiro). Ele não consegue se auto-remover com acesso básico;
só a dona do portfólio pode retirá-lo. "Viral Marketing Digital" é do próprio
dono.

⚠️ **O dono decidiu NÃO ter um segundo administrador** no portfólio do WhatsApp
(`307228995768274`). Lá ele é a única pessoa: se a conta dele cair, os códigos
de recuperação impressos são a única saída. Decisão informada, não repropor.

⚠️ **O portfólio do WhatsApp NÃO é verificado** ("Qualificada para verificação").
O verificado é o `178424846189517`. Como a conta do WhatsApp está no não
verificado, isso tende a bloquear a produção/coexistência — é o mesmo problema
de "ativos divididos" já anotado acima, agora com consequência concreta.

---

## Analise do App — 19/10/2026

`whatsapp_business_messaging` ficou **completo**: o contador de chamadas de API
virou sozinho ~24h depois do disparo de 16/10. Confirma que o mecanismo funciona
e que a espera e so lentidao da Meta.

`whatsapp_business_management` seguia em `0 de 1` porque **criar modelo pelo
WhatsApp Manager e interface, nao chamada de API** - o contador nunca ia mexer
por ali. Em 19/10 ~15h foi feita uma chamada real pelo Explorador da Graph API:

    GET 1444894994490937/message_templates

O Explorador e o caminho mais simples porque gera o token na propria pagina
(app "Bella - Hotel do Bosque", token de usuario, permissao
whatsapp_business_management ja presente) e nao exige Postman nem token no
terminal. A resposta confirmou os dois modelos **APPROVED**:
`confirmacao_de_contato` e `recebemos_sua_mensagem`, ambos UTILITY / pt_BR.

**Proximo passo:** a partir de 20/10, abrir o pedido
(`submission_id=2216495959296031`) e, com o contador virado, clicar em
**Enviar para analise**. Lembrete da propria Meta: depois de enviado nao da
para editar nem cancelar enquanto estiver em analise.

---

# CONTINUIDADE — 20/10/2026

Ponto de partida para a próxima conversa. Tudo abaixo já está no ar.

## Como saber o que está rodando

    curl -s https://bella-api-nh3h.onrender.com/api/health

Devolve o commit publicado. Foi criado hoje porque uma correção de ontem
parecia não ter efeito e não dava para distinguir "o Render não republicou" de
"a correção está errada" — duas hipóteses com conserto bem diferente. O Render
leva de 2 a 6 minutos para republicar depois do push. **Confira isto antes de
investigar qualquer bug.**

Diagnósticos (contagens, sem texto de hóspede):

    /api/assist/diagnostico-link         decisões recentes
    /api/assist/diagnostico-orcamento    acerto do link, o que a recepção fez
    /api/assist/diagnostico-correcoes    como a recepção edita a sugestão
    /api/assist/diagnostico-historico    por dia, motivos mais comuns
    /api/assist/diagnostico-ia           chaves do Gemini, quedas
    /api/channels/diagnostico            percurso dos webhooks da Meta

## O que foi corrigido em 19 e 20/10 (todos vindos de prints reais)

**Leitura do que o hóspede escreve** — era a maior causa de não sair link
("dados incompletos apesar de falar de estadia": 92 em 7 dias):

- `3 homens`, `4 amigos`, `2 moças` e afins não eram pessoas. Entraram
  homem/mulher/rapaz/moça/amigo/amiga/colega/senhor/senhora. Meninos, meninas,
  filhos e bebês ficam de fora de propósito — mudam a tarifa.
- `4 adulto e criança 7`: criança no singular sem número agora vale 1.
- `29 dezembro as 1 Janeiro`: faltavam os separadores "as"/"às" e "e".
- `29 de dez a 03 de jan`: **"dez" é o número dez por extenso E a abreviação de
  dezembro**. O conversor trocava por "10" antes da leitura da data. Agora não
  converte quando vem logo depois de um dia; "somos dez" segue virando 10.
- `24 dez 26 a 3 jan 27`: o ano de dois dígitos depois do mês não era capturado.
- `20 a 22 nov 26` sumia quando já havia outro período lido: o bloco dos meses
  abreviados só rodava `if (!brutos.length)`. **Era um bug esperando a conversa
  certa** — hóspede pediu três orçamentos e ela respondeu sobre um.
- `21 nov. a 24 nov.` (com ponto) nunca funcionou, apesar de um comentário no
  código dizer que sim: o `\b` ficava depois do ponto.
- `somos um casal e dos adultos` (espanhol): "dos" vale 2, mas **só em
  enumeração de gente** (começo de frase, ou após somos/e/y/vírgula/+). A
  primeira tentativa foi listar o que não converter e o corpus negativo pegou
  na hora — "o valor dos hóspedes extras" é português legítimo.
- `os apartamentos são de dois quartos?` era pergunta sobre a PLANTA e virava
  apartamentos=2, o que fazia sair link sem ocupação. Formas de descrição
  ("são de", "possuem", "tem") não contam como pedido.
- **A última declaração vence, não a primeira**: "2 adultos" na abertura e
  "Somos 4 adultos" depois davam 2. Ao longo da conversa o hóspede corrige.

**Respostas:**

- Link sem ocupação (`?checkin&checkout` sem `adultos-000001`) só sai quando o
  grupo passa de 6 pessoas. Até 6, vai o link completo, que mostra o valor.
- Vários períodos com a mesma ocupação agora geram **um link por período**, e a
  resposta diz que considerou as mesmas pessoas em todos.
- Não pergunta "juntos ou separados" sem o hóspede ter pedido mais de um quarto.
- Não cita "até 6 pessoas" para grupo pequeno — é dado interno para a conta.
- Estadia acima de 60 noites é descartada como leitura torta; quando isso
  acontece e nada sobra, ela pede para CONFIRMAR entrada e saída, em vez de
  perguntar do zero. (O diagnóstico mostrava links montados para 11 meses.)

**Guardas (função é garantia, prompt é pedido):**

- `semPromessaDeRegistro` — ela dizia "registrei aqui", "já anotei na sua
  reserva", "deixei a recepção ciente". Não registra nada. Vale nos dois
  caminhos. Já disparou 8 vezes em 7 dias.
- `semPrecoInventado` mudou para `common/preco.ts` e **passou a valer também no
  caminho automático**, onde faltava — justamente o caminho sem revisão humana.
  Dispara ~13 vezes por semana no outro lado.
- A saudação automática do WhatsApp **não conta mais como resposta nossa**. Ela
  zerava a lista de perguntas pendentes, e como dispara em toda conversa nova,
  a primeira pergunta do hóspede era a que mais se perdia.

## Auditoria de 20/10 — os números antes das correções

- Recepção **reescreve do zero 87%** das sugestões (527 de 605 em 30 dias).
- Só ajuste fino: 7%.
- Acerto do link: **29%** no mês; nos últimos 5 dias entre 9% e 15%.
- Decisões em 7 dias: dados incompletos 92 · orçamento já enviado 38 · passou
  para humano 64 · preço removido 13 · promessa de registro removida 8 ·
  idiomas misturados 8 · leitura suspeita 5.

**Recomendação registrada:** não ligar o WhatsApp automático sem antes medir o
efeito destas correções. Se "dados incompletos" cair de 92 para algo perto de
20 e o acerto subir dos 9% para ~40%, aí faz sentido — começando por Instagram
e Facebook, que têm volume menor e já têm todas as travas.

## A fazer

1. **Medir** (prioridade): comparar `diagnostico-historico` e
   `diagnostico-orcamento` com os números acima. É o que decide se ela pode
   responder sozinha.
2. **Instagram e Facebook pararam de responder sozinhos.** `percurso` vazio em
   `/api/channels/diagnostico`. Falta o dono mandar um "oi" de uma conta que
   não seja a do hotel para saber se a Meta parou de entregar os webhooks ou se
   a Bella é que não responde.
3. **Mensagem de espera** (ideia do dono, 20/10): no caminho automático,
   avisar "um momento" para o silêncio de 5 a 12s não parecer abandono.
   ⚠️ **Cuidado com o texto:** ela NÃO informa valores, e `checkAvailability()`
   no caminho automático é um esqueleto que devolve `{available:true}` fixo —
   dizer "vou verificar os valores e a disponibilidade" inventaria uma ação que
   não acontece. Texto honesto: avisar que já vai enviar o link com os valores.
   A consulta real ao motor só existe no caminho da extensão.
4. **Trava de disponibilidade na extensão**: é a única guarda que falta lá.
   Precisa que o resultado da consulta real chegue até o ponto da guarda, senão
   apagaria frase correta.
5. **Alerta de intervenção humana + painel de recados**, dentro do app
   (decisão do dono: tudo no painel, não na extensão). O servidor já devolve
   `precisaDeHumano` com o motivo em cada sugestão. ⚠️ O painel só enxerga
   conversas que passam pela Meta; as do WhatsApp Web vivem só na extensão.
6. **Análise do App da Meta**: tudo pronto, esperando o contador de chamadas de
   API virar. Há lembrete agendado para 20/10 às 8h40.
   `submission_id=2216495959296031`.
7. **Portfólios divididos**: a conta do WhatsApp está no `307228995768274`, que
   NÃO é verificado; a verificação está no `178424846189517`. Tende a travar a
   coexistência.

## Pendências do dono

Segundo PC ainda na extensão 1.9.2 (zip pronto na Área de Trabalho; extrair em
`C:\`, **nunca** neste PC, onde a pasta é uma junção para o repositório) ·
apagar `C:\bella-extensao-1.9.2` (confirmado: nenhuma extensão aponta para ela)
· mensagem de ausência do WhatsApp com horário errado · capítulo III do contrato
· senha do Supabase · pedir à Fiama remoção do portfólio dela.

---

## Análise do App — ENVIADA em 20/10/2026

`submission_id=2216495959296031` · permissões `whatsapp_business_management` e
`whatsapp_business_messaging` · status **"Análise em andamento"**.

Prazo informado pela Meta: **até 20 dias**, podendo ser mais se pedirem
informação adicional.

O contador de chamadas de API virou de `0 de 1` para `Ativo (1)` cerca de 18h
depois da chamada feita pelo Explorador da Graph API — dentro das 24h que a
Meta avisa.

⚠️ **Durante a análise, não mexer no app.** A Meta avalia o app inteiro, não só
o que foi pedido: ícone, URL da política de privacidade, categoria, domínios e
as permissões já aprovadas antes. Mudar qualquer um desses no meio do processo
é pedir rejeição. Alterar o CÓDIGO da Bella é seguro — o que não se toca é a
configuração do app no painel da Meta.

Se a Meta pedir mais informação, aparece em Análise do app > Pedidos.
