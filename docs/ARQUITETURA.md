# Arquitetura — Bella AI

## Fluxo de processamento de mensagem

```
Webhook do canal (WhatsApp/Instagram/TikTok/Email/Site)
  ↓ normalização (NormalizedInboundMessage)
RabbitMQ (fila inbound.messages)
  ↓
BellaOrchestratorService.handleInbound()
  1. Identificar hóspede (findOrCreate por telefone/handle do canal)
  2. Recuperar/abrir conversa
  3. Carregar memória (curto/médio/longo prazo)
  4. Detectar idioma e intenção (LLM com tool use)
  5. Consultar políticas oficiais relevantes
  6. Consultar base vetorial (Qdrant) — RAG
  7. Se intenção = reserva → motor de reservas (extração de datas/ocupação,
     disponibilidade, geração de link)
  8. Montar resposta (prompt mestre + contexto)
  9. GuardrailsService.evaluate() — sistema anti-prejuízo
 10. Enviar (ou escalar para humano se Nível 3 / baixa confiança)
 11. Registrar em AI_AUDIT (pergunta, resposta, fontes, política, modelo, confiança)
 12. Atualizar lead no pipeline + agendar follow-up
```

## Sistema anti-prejuízo

`GuardrailsService` classifica cada resposta antes do envio:

| Nível | Escopo | Ação |
|---|---|---|
| 1 | Informações gerais | Envia automaticamente |
| 2 | Orçamentos e cotações | Envia automaticamente (somente dados reais da API) |
| 3 | Cancelamento, estorno, reembolso, desconto especial, cortesia, alteração contratual | Bloqueia e escala para aprovação humana |

Regras adicionais: a Bella nunca gera valores que não vieram da API de tarifas; respostas sem fonte (política ou documento da base) sobre regras do hotel são escaladas.

## Roteamento de modelos

`ModelRouterService` escolhe o modelo por tarefa (configurável por hotel):

| Tarefa | Perfil | Padrão |
|---|---|---|
| Extração de dados de reserva | Econômico/rápido | claude-haiku-4-5 |
| Respostas sobre políticas | Preciso | claude-opus-4-8 |
| Vendas / negociação | Avançado | claude-fable-5 |

Fallback entre provedores (Anthropic → OpenAI → Gemini) em caso de indisponibilidade.

## Memória

- **Curto prazo:** últimas N mensagens da conversa (Redis).
- **Médio prazo:** resumo da conversa atual (gerado por LLM, persistido na conversa).
- **Longo prazo:** perfil do hóspede no PostgreSQL — preferências, reservas anteriores, lifetime value. Ex.: "Vejo que sua última hospedagem foi em janeiro, em um apartamento Superior."

## Base de conhecimento (RAG)

Upload (PDF, DOCX, TXT, CSV, XLSX, exports de WhatsApp/Instagram, FAQ) →
extração de texto → chunking → embeddings → upsert no Qdrant
(collection por hotel: `kb_{hotelId}`). Busca híbrida no momento da resposta.

## Multi-tenancy

Todas as entidades carregam `hotelId`. Isolamento por linha no PostgreSQL na v1;
opção futura de banco dedicado por cliente. Collections do Qdrant e filas
RabbitMQ segmentadas por hotel.

## Follow-up

`FollowUpService` (cron): leads em "Cotação Enviada" sem resposta recebem
mensagens em 24h, 72h, 7 dias e 15 dias. Cancelado automaticamente quando a
reserva é confirmada ou o hóspede responde.

## Auditoria

Toda interação da Bella gera um registro imutável em `AI_AUDIT`: pergunta,
resposta, fontes RAG, política consultada, modelo usado, confiança, timestamp.
