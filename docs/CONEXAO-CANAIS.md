# Conexão dos canais (Meta) — passo a passo

Guia para conectar **Instagram** e **WhatsApp** à Bella, priorizando o custo zero.

## 0. A verdade sobre o "gratuito"

| Canal | Responder quem te escreve | Iniciar conversa (disparo ativo) |
|---|---|---|
| **Instagram DM** | ✅ Grátis | ✅ Grátis (dentro das regras) |
| **WhatsApp Cloud API** | ✅ Grátis (janela de 24h após o cliente escrever) | 💲 **Pago** — exige *template* aprovado (centavos por mensagem) |

- A **hospedagem** da API pela Meta é gratuita.
- **Responder** hóspedes que escrevem primeiro é **grátis** nos dois canais.
- No WhatsApp, **disparar** mensagem para quem não te escreveu nas últimas 24h exige **template pago** (ex.: o "Olá, sou o Victor..." para um número novo).

**Recomendação para manter custo zero:** começar pelo **Instagram** (você já tem, é grátis) e usar o WhatsApp no modo **"responder"**. O disparo ativo em massa é o único ponto que gera custo — decidir depois.

---

## 1. Base na Meta (uma vez só, grátis)

1. **Conta Meta Business** — acesse [business.facebook.com](https://business.facebook.com), crie a conta comercial com o **CNPJ do hotel** (RS Hotelaria LTDA).
2. **Página do Facebook** do hotel — obrigatória para os dois canais. Se não tiver, crie uma (grátis).
3. **App de desenvolvedor** — em [developers.facebook.com](https://developers.facebook.com) → **Meus apps → Criar app → tipo "Empresa/Business"**.

## 2. Instagram (comece por aqui — grátis)

1. No **app do Instagram** (celular): Configurações → Conta → mudar para **Conta Profissional/Comercial**.
2. **Vincule o Instagram à Página do Facebook** (nas configurações da Página, seção Instagram).
3. No **app da Meta** (developers): adicione o produto **"Instagram" / "Messenger"** e as permissões `instagram_manage_messages` e `pages_manage_metadata`.
4. Gere o **Token de Acesso da Página** e o **ID da conta do Instagram**.
5. **Me envie** o token e o ID → eu configuro no Render e ativo o webhook (`/api/channels/instagram/webhook`).

## 3. WhatsApp (depois — atenção ao número e ao custo de template)

1. No **app da Meta**: adicione o produto **"WhatsApp"**.
2. A Meta dá um **número de teste grátis** — ideal para validar tudo antes de mexer no número principal.
3. Para produção com número próprio: **verificação do negócio** (enviam o CNPJ e documentos — grátis, leva de horas a dias).
4. Gere o **Access Token permanente**, o **Phone Number ID** e defina o **Verify Token**.
5. **Me envie** esses dados → eu configuro no Render e ativo o webhook (`/api/channels/whatsapp/webhook`).
6. Para **disparo ativo**, criar e submeter **templates** (ex.: saudação do Victor) para aprovação da Meta.

## O que eu preciso de você (resumo)

Para cada canal, você gera no painel da Meta e me passa:
- **Instagram:** Token da Página + ID da conta Instagram.
- **WhatsApp:** Access Token + Phone Number ID + Verify Token (esse você inventa; uso o mesmo nos dois lados).

A parte técnica (colocar no Render, configurar e testar os webhooks) é **comigo**.

## Ordem recomendada
1. Base Meta (conta Business + Página + App)
2. **Instagram** (grátis, valida o fluxo)
3. WhatsApp com **número de teste** (valida sem risco)
4. WhatsApp com **número real** (após verificação) — decidir sobre migrar o principal
5. Templates (só se for fazer disparo ativo — aqui entra custo)
