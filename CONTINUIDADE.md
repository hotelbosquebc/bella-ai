# Bella AI — ponto de partida

**Atualizado em 20/10/2026.** Leia este arquivo antes de qualquer coisa. O
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
Instagram ainda sem teste confirmado.

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
- **A IA da Meta sugere textos com afirmações falsas** ("já integramos vários
  hotéis"). Não usar.
- O build local do Next estoura a memória desta máquina — quem compila é a
  Vercel.

---

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
3. **Mensagem de espera** no caminho automático, para o silêncio de 5 a 12s não
   parecer abandono. ⚠️ O texto **não pode** dizer "vou verificar os valores e a
   disponibilidade": ela não informa valores, e `checkAvailability()` naquele
   fluxo é um esqueleto que devolve `{available:true}` fixo. Versão honesta:
   avisar que já vai enviar o link com os valores.
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
   **Chaves do Gemini:** a chave 2 é INVÁLIDA (400). A chave 3 (projeto
   Bella 3) funciona só nos 3.x, porque projeto novo não tem a linha 2.5.
   Para ganhar velocidade, trocar a chave 2 por uma nova do **Gemini
   Project**.
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

- Segundo PC ainda na extensão **1.9.2** (zip pronto na Área de Trabalho;
  extrair em `C:\`, **nunca** no PC do hotel).
- Apagar `C:\bella-extensao-1.9.2` — confirmado que nenhuma extensão aponta
  para ela.
- Mensagem de ausência do WhatsApp Business com horário errado.
- Capítulo III do contrato (grupos, perda total do valor).
- Trocar a senha do banco no Supabase.
- Pedir à Fiama que o remova do portfólio `439185823713823`.
