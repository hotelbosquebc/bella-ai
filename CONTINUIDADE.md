# Bella AI — ponto de partida

**Atualizado em 21/10/2026.** Leia este arquivo antes de qualquer coisa. O
histórico completo do projeto está no `ESTADO.md`; aqui fica só o que importa
para continuar de onde paramos.

---

## Antes de investigar qualquer bug

```bash
curl -s https://bella-api-nh3h.onrender.com/api/health
```

Devolve o **commit que está rodando em produção**. Criado em 19/10 porque uma
correção publicada no dia anterior parecia não ter efeito, e não dava para
distinguir "o Render não republicou" de "a correção está errada" — duas
hipóteses com conserto bem diferente. O Render leva de 2 a 6 minutos para
republicar depois do `git push`.

**Confira isto primeiro.** Já custou tempo uma vez.

### Diagnósticos (só contagens, nenhum texto de hóspede)

| Endereço | Para quê |
|---|---|
| `/api/assist/diagnostico-historico` | decisões por dia, motivos mais comuns |
| `/api/assist/diagnostico-orcamento` | acerto do link, o que a recepção fez |
| `/api/assist/diagnostico-correcoes` | como a recepção edita a sugestão |
| `/api/assist/diagnostico-link` | decisões recentes, uma a uma |
| `/api/assist/diagnostico-ia` | chaves do Gemini, quedas |
| `/api/assist/diagnostico-disponibilidade?checkin=&checkout=` | a produção alcança o Silbeck? |
| `/api/channels/diagnostico` | percurso dos webhooks da Meta |

---

## Onde o projeto está

**Análise do App da Meta: ENVIADA em 20/10/2026.** `submission_id=2216495959296031`,
permissões `whatsapp_business_management` e `whatsapp_business_messaging`,
status "Análise em andamento", prazo de **até 20 dias**.

> ⚠️ **Não mexer na configuração do app no painel da Meta durante a análise.**
> Ela avalia o app inteiro: ícone, URL da política, categoria, domínios e as
> permissões já aprovadas. Mudar algo no meio é pedir rejeição. Mexer no
> **código** da Bella é seguro — o que não se toca é o painel.

**Ela ainda NÃO responde sozinha no WhatsApp**, por decisão conjunta: a
auditoria de 20/10 mostrou a recepção reescrevendo do zero 87% das sugestões.
Esse número é anterior às correções desta semana.

**Instagram e Facebook: RELIGADOS em 21/10/2026.** A causa real era a
**inscrição da Página no app**: estava só no campo `name`, sem `messages`.
Por isso a Meta não entregava nada, nem mensagem de administrador.
`/api/channels/diagnostico-meta` mostra a inscrição (só leitura), e o
botão **"Religar Instagram e Facebook"** na Central da Bella reinscreve a
Página com `messages` e `messaging_postbacks`. Teste pelo Messenger às
14:52: chegou, e a Bella respondeu sozinha em 15 s.
`/api/channels/diagnostico` agora tem `gravado`, que vem do banco e
sobrevive ao deploy, e registra até as recusas na porta (assinatura).
**22/10: a configuração do nosso lado está CERTA** (`/api/channels/diagnostico-meta`,
campo `webhooksDoApp`, só leitura): o app tem o objeto `instagram` com
`messages` apontando para `/api/channels/instagram/webhook`, ativo, e a Página
está inscrita. Mesmo assim, nenhuma mensagem do Instagram chega. O que sobra é
o lado da Meta: **modo desenvolvimento** (só entrega mensagens de quem tem papel
no app, até a segunda análise aprovar `instagram_manage_messages` +
`pages_messaging`) e, no app do Instagram, **Ferramentas conectadas →
Permitir acesso às mensagens** (o dono vai conferir; não é o painel em análise).
Vale também para o Messenger: hóspede comum não recebe resposta até essa
aprovação.

**Instagram: testado em 21/10 por OUTRA conta, sem resposta, e nada chegou ao
servidor** (nem recusa de assinatura). Ou seja, a Meta não entregou. Duas
causas possíveis, ambas no painel, que **não se mexe durante a análise**:
conta sem papel no app (modo desenvolvimento) ou o objeto `instagram` dos
webhooks do app sem o campo `messages` apontando para
`/api/channels/instagram/webhook`. Próximo teste: por uma conta de Instagram
de quem tem papel no app.

**Caixa de entrada (21/10, `d86746e`):** mensagem nova numa conversa antiga
não subia na lista, que ordena pela atualização da *conversa*. Agora toda
mensagem gravada atualiza a conversa. Conversas do WhatsApp Web continuam
fora do painel (vivem só na extensão).

**Divisão "4 pessoas em cada apartamento" (21/10, `a903341`):** virava "pedir
a divisão de novo" e encaminhar à equipe. Agora sai um link por apartamento
(`pessoasEmCadaApartamento`). No mesmo caso, a citação da saudação ("crianças
menores de 10 anos") entrava como fala do hóspede e descartava a divisão
certa; corrigido no servidor e na extensão **1.10.4** (recarregar a extensão
no Chrome).

⚠️ Ainda vale: o app está em **modo desenvolvimento**. Hóspede sem papel
no app pode não receber resposta até a **segunda análise**
(`pages_messaging` + `instagram_manage_messages`), que só pode ser
enviada depois que a do WhatsApp terminar.

**Regras do dono de 21/10:** no Instagram e no Facebook a Bella responde
**sempre**, inclusive no expediente. O que ela não souber vai para a
equipe, e o painel **toca e pisca** (`AlertaAtendimento`, em todas as
telas). O automático usa o **mesmo `bookingContext`** da extensão
(`definirLeitorDoPedido`), e toda correção vale para os dois.

---

## Análise das respostas (26/10, `ca04a08`)

As 200 últimas sugestões comparadas com o que a recepção enviou (via
`/api/assist/feedback`, que exige login; o campo `conversa` é só um código, sem
texto do hóspede).

- **Erro grave, corrigido:** na extensão, o texto final era montado ANTES das
  guardas desde 09/2026. Todas as guardas criadas desde 13/10 só registravam
  "frase removida" no diagnóstico, e a frase chegava inteira ao atendente. A
  troca de idioma também era descartada. O teste `scripts/testar-leitura.js`
  agora confere a ordem. **Os números antigos de "preço removido" e "promessa
  removida" mediam a IA, não o que a recepção recebia.**
- **Medição inflada, corrigida:** 72 de 196 "divergências" eram textos-modelo
  repetidos (promoção do café 10×, roteiro "Solicitação de reserva realizada"
  21×, ausência 13×). Texto enviado igual 3 ou mais vezes não conta mais como
  correção. Os 87% de "reescreveu do zero" de 20/10 estavam inflados.
- **Corrigido:** sugestão automática em conversa sem nada de hotel (pessoal,
  financiamento) não sai mais; reserva em andamento não pede dados nem manda
  link novo; pergunta do hóspede respondida antes de pedir o que falta.
- **Ainda aberto, decisão do dono:**
  1. A Bella **se apresenta em ~50% das sugestões**, todo dia (regra "uma vez
     por dia por contato"). A saudação automática do WhatsApp já apresenta a
     Bella; a recepção corta a apresentação.
  2. **Tamanho:** mediana de 299 caracteres na sugestão contra 69 no que a
     recepção envia.
- **Fora do alcance da Bella (esperado):** pagamento, comprovante, e-mail para
  cadastro, voucher, preço de grupo e de pessoa extra. Ela passa para a equipe.
- **Ruído na leitura do enviado:** 8 casos com "Você" ou telefone na frente
  (a extensão pega o cabeçalho da citação). Baixo impacto; corrigir depois.

## A próxima tarefa: medir

É o que decide se ela pode ir ao ar. Os 20 dias de espera da Meta são tempo de
sobra.

**Números de referência, de 20/10, ANTES das correções:**

- `dados incompletos apesar de falar de estadia` — **92** em 7 dias, disparado
  o maior motivo de não sair link
- acerto do link — **29%** no mês; por dia, entre 9% e 15%
- recepção reescreveu do zero — **527 de 605** (87%)
- só ajuste fino — 42 (7%)
- preço removido pela guarda — 13 · promessa de registro removida — 8 ·
  idiomas misturados — 8 · leitura suspeita — 5

**Critério combinado com o dono:** se "dados incompletos" cair para perto de 20
e o acerto subir para algo como 40%, faz sentido ligar o automático — começando
por Instagram e Facebook, que têm volume menor e já têm todas as travas.
(Esses dois canais também dependem de uma segunda análise da Meta. Ver "A
fazer", item 2.)

⚠️ **Esperar 2 ou 3 dias de uso antes de medir.** A janela do diagnóstico é de
7 dias e ainda está contaminada pelo período anterior às correções.

---

## O que mudou entre 19 e 20/10 (tudo já no ar)

### Leitura do que o hóspede escreve

Era a maior causa de não sair link. Todos vieram de prints reais:

- `3 homens`, `4 amigos`, `2 moças` não eram reconhecidos como pessoas.
  Entraram homem/mulher/rapaz/moça/amigo/amiga/colega/senhor/senhora. Meninos,
  meninas, filhos e bebês ficam **de fora de propósito** — mudam a tarifa.
- `4 adulto e criança 7` — criança no singular, sem número, agora vale 1.
- `29 dezembro as 1 Janeiro` — faltavam os separadores "as"/"às" e "e".
- `29 de dez a 03 de jan` — **"dez" é o número dez por extenso E a abreviação
  de dezembro.** O conversor trocava por "10" antes de ler a data. Com
  "dezembro" por extenso sempre funcionou, e era isso que escondia o bug.
- `24 dez 26 a 3 jan 27` — o ano de dois dígitos depois do mês não era lido.
- `20 a 22 nov 26` sumia quando já havia outro período lido: o bloco dos meses
  abreviados só rodava `if (!brutos.length)`. **Era um bug esperando a conversa
  certa** — a hóspede pediu três orçamentos e recebeu um.
- `21 nov. a 24 nov.` (com ponto) nunca funcionou, apesar de um comentário no
  código afirmar que sim: o `\b` ficava depois do ponto.
- `somos um casal e dos adultos` (espanhol) — "dos" vale 2, mas **só em
  enumeração de gente**. A primeira tentativa foi listar o que não converter, e
  o corpus negativo pegou na hora: "o valor dos hóspedes extras" é português.
- `os apartamentos são de dois quartos?` era pergunta sobre a **planta** e
  virava `apartamentos=2`, o que fazia sair link sem ocupação.
- **A última declaração vence, não a primeira.** "2 adultos" na abertura e
  "Somos 4 adultos" depois davam 2. Ao longo da conversa o hóspede corrige.

### Respostas

- Link sem ocupação só sai quando o grupo passa de 6 pessoas.
- Vários períodos com a mesma ocupação geram **um link por período**, e a
  resposta diz que considerou as mesmas pessoas em todos.
- Não pergunta "juntos ou separados" sem o hóspede ter pedido mais de um quarto.
- Não cita "até 6 pessoas" para grupo pequeno — é dado interno para a conta.
- Estadia acima de 60 noites é descartada como leitura torta; quando nada sobra,
  ela pede para **confirmar** entrada e saída, em vez de perguntar do zero.
- **Oferece atendente no máximo uma vez por conversa.** Estava injetada em seis
  ramos diferentes e reaparecia a cada resposta, minando a venda pelo link.
- **Quem travou no site vai para uma pessoa.** "Não aparece disponibilidade" ou
  "o link não abre" → não insiste no link, não afirma que há ou não vaga,
  pergunta se há interesse em outras datas e encaminha.

### Guardas (prompt é pedido; função é garantia)

- `semPromessaDeRegistro` — ela dizia "registrei aqui", "já anotei na sua
  reserva". Não registra nada. Vale nos dois caminhos.
- `semPrecoInventado` mudou para `common/preco.ts` e **passou a valer também no
  caminho automático**, onde faltava — justamente o sem revisão humana.
- A saudação automática do WhatsApp **não conta mais como resposta nossa**. Ela
  zerava a lista de perguntas pendentes e, como dispara em toda conversa nova,
  a primeira pergunta do hóspede era a que mais se perdia.

### Base de conhecimento

60 entradas. A última: **setor de compras** — WhatsApp (47) 9754-4372 ou o fixo
(47) 3367-0211. Quem procura esse setor é fornecedor, não hóspede: não mandar o
link de reservas.

---

## Decisões em vigor (não repropor)

- **A Bella não informa preços.** Nunca. Quem mostra valor é o link.
- **A Bella não fecha reserva.** Manda o link e tira dúvidas.
- **Custo zero**, sempre.
- **Nunca arriscar o número principal** (47) 3367-0211.
- **Tokens, chaves e senhas**: o dono cola direto no Render ou na página do
  serviço. Nunca pedir, nunca receber, nunca gravar em arquivo.
- **Diagnósticos expõem contagens**, nunca texto de hóspede, nome ou telefone.
- O dono **não quer um segundo administrador** no portfólio do WhatsApp. Decisão
  informada: os códigos de recuperação impressos são a única via de volta.
- **Disponibilidade real: caminho B.** Confirmado em produção que o Cloudflare
  bloqueia a consulta ao Silbeck a partir do Render (403 "Just a moment",
  sempre). No automático ela não afirma nada sobre vaga; quem travar no site vai
  para uma pessoa. O caminho C (pedir ao Silbeck liberação de IP ou API) está
  sobre a mesa e **o e-mail ainda não foi escrito**.
- **Quem a Bella não atende** (21/10, `038b432`), decidido no código, antes
  de qualquer IA:
  - **Guia de grupos e excursões**, marcado no painel (caixa de entrada, 4
    cores) ou na extensão. Tabela `contatos_marcados`, rota
    `/api/contatos-marcados`. No automático, a conversa vai direto para a
    equipe; na extensão, ela não sugere, mostra uma faixa colorida e pinta o
    contato na lista do WhatsApp Web. Contato salvo é comparado pelo **nome**
    (a extensão não enxerga o número); contato não salvo, pelo número.
  - **Currículo e oferta de venda** (`assuntoForaDoAtendimento`): uma resposta
    curta pronta e a conversa fica com a equipe.
  - **Grupo do WhatsApp**: a extensão não sugere sozinha, só no clique. O
    `data-id` com `@g.us` sumiu da marcação; a detecção usa ícone, "dados do
    grupo", lista de participantes com "Você" e três autores diferentes.
    **Não confirmado num grupo real.** Se ela ainda sugerir em grupo,
    investigar o cabeçalho do grupo no WhatsApp Web.

---

## Armadilhas que já custaram caro

- **Nunca extrair o zip da extensão no PC do hotel.**
  `C:\Bella-Extensao-WhatsApp` é uma **junção** para
  `Documents\GitHub\bella-ai\whatsapp-extension`. Substituí-la por uma pasta
  comum congela a máquina na versão copiada.
- **Heredoc no Bash come as barras invertidas.** Regex vai em literal no
  arquivo, ou escrito com a ferramenta de edição — nunca montado por heredoc.
- **`\b` não funciona depois de letra acentuada** ("moças", "robô", "café").
  Usar `(?![a-zà-ÿ])`.
- **`nest build` pode passar com erro de tipo.** Rodar `npx tsc --noEmit`.
- **Antes de publicar qualquer mudança na leitura** (datas, pessoas, idades,
  divisão): `cd apps/api && npx nest build && node scripts/testar-leitura.js`.
  Em 26/10, uma correção quebrou outra frase no mesmo dia ("1 criança + 2
  adultos" ficou sem adultos). Todo caso real novo entra nesse arquivo, com o
  lado positivo **e** o negativo.
- **O Write e o heredoc mexem nas barras invertidas:** `̀` vira o próprio
  caractere e `'\n'` dentro de um texto gerado vira quebra de linha real.
  Regex nova vai por Edit, ou com `String.raw`, e precisa ser conferida no
  arquivo depois.
- **A IA da Meta sugere textos com afirmações falsas** ("já integramos vários
  hotéis"). Não usar.
- O build local do Next estoura a memória desta máquina — quem compila é a
  Vercel.

---

## Dia da aprovação do WhatsApp: roteiro para ligar a Bella

Decisão do dono (22/10): caminho **oficial**, por coexistência, ligado **no
mesmo dia** da aprovação. O código já está pronto (`30cc72c`). Na ordem:

1. **Confirmar** em Análise do app → Solicitações que está **Aprovada**. Só
   então mexer no painel do app.
2. **Webhooks do app** (developers.facebook.com → app Bella → Webhooks),
   objeto **WhatsApp Business Account**: endereço
   `https://bella-api-nh3h.onrender.com/api/channels/whatsapp/webhook`, token de
   verificação = o valor de `META_WEBHOOK_VERIFY_TOKEN` no Render. Campos:
   `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`,
   `account_update`. Sem `smb_message_echoes`, a Bella não fica sabendo que a
   recepção respondeu pelo celular e responde por cima.
3. Conferir que o app está em modo **Ao vivo**, e que existem
   `NEXT_PUBLIC_META_APP_ID` e `NEXT_PUBLIC_META_SIGNUP_CONFIG_ID` na Vercel e
   `META_APP_ID` e `META_APP_SECRET` no Render. A configuração do Login do
   Facebook para Empresas tem de ser do tipo **Cadastro Incorporado do
   WhatsApp**.
4. Painel → **/whatsapp → Conectar o WhatsApp do hotel**. A tela já pede
   **coexistência** (antes de 22/10 pedia a migração comum, que tira o número
   do celular). O dono digita o número, toca em **Conectar** no app do
   celular, aceita compartilhar o histórico e cola o código.
5. O resultado mostra `passos`: `inscricao: ok`, `contatos: pedida`,
   `historico: pedida`. A sincronização tem de ser pedida **em até 24h**; se
   falhar, refazer a conexão no mesmo dia.
6. **Token permanente:** Gerenciador de Negócios → Usuários do sistema →
   usuário com acesso à conta do WhatsApp → gerar token com
   `whatsapp_business_messaging` e `whatsapp_business_management`. O dono cola
   no Render: `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` (o número
   que a tela mostrou). Nunca pedir nem receber o token.
7. **Teste:** de um celular pessoal, "oi" para o (47) 3367-0211 fora do
   expediente (no modo automático, dentro do expediente quem responde é a
   equipe). Esperado: a mensagem de espera e depois a resposta. Conferir em
   `/api/channels/diagnostico`. Responder pelo celular e confirmar que a Bella
   **para** nessa conversa (`motivo: equipe respondeu pelo app`).
8. Recarregar a extensão **1.12.0** nos dois PCs. Ela passa a mostrar
   "respondendo sozinha no WhatsApp" e para de sugerir sozinha.
9. Enviar a **segunda análise** (`pages_messaging` + `instagram_manage_messages`)
   para liberar Instagram e Messenger.

Como funciona depois de ligada: a resposta da recepção pelo app ou pelo
WhatsApp Web **tira a Bella da conversa**. A saudação e a mensagem de
ausência automáticas não contam. Ela **volta depois de 2h** de silêncio da
equipe, nunca para guia marcado e nunca com pedido de ajuda em aberto
(`PAUSA_DA_EQUIPE_MS`). O follow-up **não sai** pelo WhatsApp até existir um
modelo aprovado (fora da janela de 24h, falharia).

⚠️ **Portfólios divididos** (item 7 abaixo) podem travar o passo 4. Se a
conexão recusar, é o primeiro suspeito.

## A fazer

1. **Medir** (ver acima) — decide o resto.
2. **Instagram e Facebook sem resposta** (ver "Onde o projeto está").
   Para confirmar: mandar "oi" para a Página **pelo Messenger do perfil
   pessoal "Victor Bosque"**, que tem papel no app, e olhar
   `/api/channels/diagnostico`. Se aparecer a linha e a Bella responder,
   confirmado: o código funciona e o bloqueio é o modo do app. Depois que a
   análise do WhatsApp terminar, enviar a segunda análise
   (`pages_messaging` + `instagram_manage_messages`). **Isso muda o critério de
   ligar o automático.** Começar por Instagram e Facebook depende da medição
   **e** dessa segunda aprovação.
3. ~~**Mensagem de espera** no caminho automático~~ — **feita em 22/10**
   (`be78158`, `common/mensagem-espera.ts`): "Só um instante, estou
   verificando e já te respondo! 🌿" (pt/es/en), com a apresentação quando é a
   primeira do dia, uma por rodada. Não promete valor nem vaga. Fica FORA da
   leitura da conversa e do histórico da IA (senão "o que o hóspede disse
   depois da nossa última mensagem" sairia vazio). Regra do dono: "o
   importante é responder; quanto mais rápido melhor".
4. ~~Trava de disponibilidade na extensão~~ — **feita em 20/10** (`91c7f30`).
   Só deixa passar "temos disponibilidade" quando o contexto traz a marca
   `VAGA CONFIRMADA`, que só entra quando a consulta real devolve categorias.
   No mesmo commit: rótulo órfão depois do corte de preço ("Para 3 pessoas:"
   vazio) e leitura de "3 em um apto, 4 em outro".
   **Também em 20/10** (`aa65848`): a IA não trocava de chave quando o último
   erro era 503, e as sugestões levavam de 26 a 82 s. Agora cada modelo
   passa por todas as chaves antes de descer para o lento. Veja
   `semCota` em `/api/assist/diagnostico-ia`.
   **Também em 20/10** (`402abca`): data de hoje com ocupação só de outros
   dias → pede para confirmar quantas pessoas. Saída igual à entrada → pede
   para confirmar as datas. ⚠️ **Investigar:** contato não salvo (Rayanne,
   5 falas na tela) chegou ao servidor com 29 falas do hóspede e 11 nossas,
   vindas do histórico guardado pela extensão (`chaveConversa` =
   título do cabeçalho). Falta saber se é histórico legítimo do mesmo número
   ou outro contato caindo no mesmo registro, como no bug da 1.1.6.
   **Chaves do Gemini (22/10):** 1 = AI-Studio-Free (…V-Iw, a única com
   o 2.5-flash rápido, 20/dia); 2 = **Gemini Project, criada em 22/10**,
   aceita, mas o Google responde 404 "no longer available to new users"
   também para o 2.5 nela; 3 = Bella 3 (…pXEQ), só 3.x. Ou seja: chave
   nova, mesmo em projeto antigo, não ganha a linha 2.5. As chaves 2 e 3
   somam cota do 3.5-flash-lite (500/dia cada) e servem de reserva no 503.
   Velocidade extra pelo plano gratuito não existe mais.
   **Nota fiscal — regra do dono (21/10, `5e5348e`):** emitida para PF ou
   PJ, inclusive em reserva do site. Pede-se na recepção no check-out, com
   CPF/CNPJ, razão social, endereço e e-mail, e sai impressa ou por e-mail.
   O **tomador** depende da reserva (portal pode receber a nota), por isso
   uma pessoa sempre confere. Em código (`escalonamento.ts`): a resposta só
   pode trazer `fraseOficialNotaFiscal`, a extensão dispara
   `precisaDeHumano` e o automático escala.
   **21/10 também:** período novo depois da nossa resposta substitui o já
   respondido (`7ecc064`). "Pet porte pequeno" não conta como criança. Tom
   mais caloroso (`6f09c70`). ⚠️ O Render levou mais de 1h para publicar o
   `7ecc064`, por fila do lado dele.
5. **Alerta de intervenção humana + painel de recados**, dentro do app (decisão
   do dono: no painel, não na extensão). O servidor já devolve `precisaDeHumano`
   com o motivo em cada sugestão. ⚠️ O painel só enxerga conversas que passam
   pela Meta; as do WhatsApp Web vivem só na extensão.
6. **E-mail ao Silbeck** pedindo liberação de IP ou API de disponibilidade.
7. **Portfólios divididos** — a conta do WhatsApp está no `307228995768274`, que
   **não** é verificado; a verificação está no `178424846189517`. Tende a travar
   a coexistência do número.

## Pendências do dono

- ~~Segundo PC na extensão 1.9.2~~ — **atualizado para 1.12.0 em 22/10**.
  Na próxima vez: o zip vai pelo WhatsApp como **Documento** e chega com o nome
  "WhatsApp Unknown…"; extrair em `C:\` e conferir que existe
  `C:\Bella-Extensao-WhatsApp\manifest.json`. Em 22/10 foram enviados por
  engano 3 prints (260 KB) no lugar do zip (32 KB). **Nunca** extrair no PC do
  hotel.
- Apagar `C:\bella-extensao-1.9.2` — confirmado que nenhuma extensão aponta
  para ela.
- Mensagem de ausência do WhatsApp Business com horário errado.
- Capítulo III do contrato (grupos, perda total do valor).
- Trocar a senha do banco no Supabase.
- Pedir à Fiama que o remova do portfólio `439185823713823`.
