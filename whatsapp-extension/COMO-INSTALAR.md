# Bella — Extensão do WhatsApp Web (co-piloto)

Ajuda a recepção a responder mais rápido no **WhatsApp Web**, com os **atalhos** e as **sugestões da Bella**. O envio é **sempre manual** (você clica em enviar), então **não é robô** e o risco ao número é mínimo.

## Passo 1 — Levar os arquivos para o computador

A extensão não está na Chrome Web Store: ela é instalada a partir de uma **pasta** no computador. Escolha um dos caminhos.

### Opção A — Pelo arquivo .zip (mais simples, para a recepção)

1. Receba o arquivo **`Bella-Extensao-WhatsApp.zip`** (por e-mail, pen drive ou WhatsApp).
2. **Descompacte** num lugar que ninguém vá apagar. Sugestão: `C:\Bella\whatsapp-extension`
   ⚠️ Não deixe na pasta Downloads nem dentro do .zip — o Chrome lê essa pasta toda vez que abre. Se ela sumir, a extensão para de funcionar.
3. Confira que dentro da pasta existe o arquivo **`manifest.json`**. Se você vê outra pasta em vez dele, entre nela — é essa que o Chrome precisa.

### Opção B — Pelo repositório (para quem mexe no código)

```bash
git clone https://github.com/hotelbosquebc/bella-ai.git
```

A pasta a usar é `bella-ai\whatsapp-extension`. A vantagem é atualizar com `git pull` em vez de refazer o zip.

## Passo 2 — Instalar no Chrome (uma vez)

1. Abra o Chrome e vá em: **`chrome://extensions`**
2. No canto superior direito, ligue o **"Modo do desenvolvedor"**
3. Clique em **"Carregar sem compactação"** (Load unpacked)
4. Selecione a pasta do Passo 1 (a que tem o `manifest.json` dentro)
5. A extensão **"Bella — Assistente do Hotel do Bosque"** aparece na lista

> O Chrome pode avisar que há extensões em modo desenvolvedor toda vez que abrir. É normal para extensão instalada fora da loja — pode fechar o aviso.

## Configurar (uma vez)

1. Clique no ícone de **quebra-cabeça 🧩** do Chrome → **Bella** → ou em "Detalhes → Opções da extensão"
2. Preencha:
   - **Endereço da API:** já vem preenchido (`https://bella-api-nh3h.onrender.com`)
   - **E-mail e senha:** o mesmo login do painel da Bella
3. Clique em **"Salvar e entrar"** → deve aparecer "✅ Conectado!"

## Usar

1. Abra o **`web.whatsapp.com`**
2. No canto inferior direito aparece o painel **"🌿 Bella — assistente"**
3. Abra uma conversa com um hóspede:
   - **⚡ Respostas rápidas:** clique num atalho (ex.: `/Bomdia`) → o texto entra na caixa de mensagem. **Revise e envie.**
   - **🤖 Sugerir resposta da Bella:** ela lê a conversa e escreve uma sugestão. Clique em **"Inserir no chat"**, **revise/edite** e **envie**.

> A Bella **nunca envia sozinha** por aqui. Ela só escreve para você — quem manda é sempre o atendente.

## Ligar, desligar e o modo automático

No topo do painel da extensão aparece o modo atual. Ele é definido no **painel da Bella → Central da Bella**, e vale na hora (a extensão reconsulta a cada minuto, sem precisar recarregar):

| Modo | O que acontece no WhatsApp Web |
|---|---|
| 🟢 **Ligada** | Ao abrir uma conversa, a Bella já prepara a sugestão sozinha — a qualquer hora. |
| 🌙 **Automática** (padrão) | Prepara sozinha **apenas fora** do horário do setor de reservas (seg-sex, 9h-12h e 14h30-17h30). Durante o expediente, só se você clicar em "Sugerir". |
| 🔴 **Desligada** | O botão some e a Bella não escreve nada. |

Em **todos** os modos o envio continua manual. "Automática" significa que o texto já vem pronto — não que ela responde ao hóspede sozinha.

## Como atualizar depois

A pasta instalada é uma **cópia**: mudanças feitas no repositório não chegam sozinhas a ela.

1. Substitua os arquivos da pasta pela versão nova (novo .zip ou `git pull`).
2. Vá em `chrome://extensions` e clique no **🔄** do cartão da Bella.
3. Recarregue a aba do WhatsApp Web (F5).

**Como saber se atualizou de verdade:** o cartão em `chrome://extensions` mostra o **número da versão**. Se ele não mudou depois do 🔄, o Chrome ainda está lendo a pasta antiga — confira se você substituiu a pasta certa (a que foi selecionada na instalação).

> Esse é o erro mais comum: existir uma cópia antiga que o Chrome lê e uma nova que ninguém usa. Se for mexer no código com frequência nesta máquina, instale direto da pasta do repositório (Opção B) e o problema desaparece.

## Observações
- Se os atalhos não carregarem, refaça a configuração (login).
- Ao recarregar a extensão com o WhatsApp Web aberto, o console mostra erros como *"Extension context invalidated"* ou *"message channel closed"*. É só o script antigo morrendo — recarregue a aba e some.
- A extensão funciona junto com o app normal do WhatsApp — não substitui nem migra o número.
- O WhatsApp Web muda de tempos em tempos; se algum botão parar de inserir texto, me avise para ajustar os seletores.
