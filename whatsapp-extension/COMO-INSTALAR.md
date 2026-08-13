# Bella — Extensão do WhatsApp Web (co-piloto)

Ajuda a recepção a responder mais rápido no **WhatsApp Web**, com os **atalhos** e as **sugestões da Bella**. O envio é **sempre manual** (você clica em enviar), então **não é robô** e o risco ao número é mínimo.

## Instalar no Chrome (uma vez)

1. Abra o Chrome e vá em: **`chrome://extensions`**
2. No canto superior direito, ligue o **"Modo do desenvolvedor"**
3. Clique em **"Carregar sem compactação"** (Load unpacked)
4. Selecione esta pasta: **`whatsapp-extension`**
5. A extensão **"Bella — Assistente do Hotel do Bosque"** aparece na lista

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

## Observações
- Se os atalhos não carregarem, refaça a configuração (login).
- A extensão funciona junto com o app normal do WhatsApp — não substitui nem migra o número.
- O WhatsApp Web muda de tempos em tempos; se algum botão parar de inserir texto, me avise para ajustar os seletores.
