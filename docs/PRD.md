# PRD — Bella AI v1.0

## Visão

Bella AI é uma plataforma SaaS Omnichannel para hotelaria. Centraliza o atendimento digital, automatiza reservas, aumenta conversões e reduz carga operacional. A Bella atua como funcionária virtual treinada pelo próprio hotel — não é um chatbot.

Primeiro cliente: **Hotel do Bosque** (recepção 24h: +55 47 3367-0211). Modelo SaaS multi-tenant para outros hotéis no futuro.

## Identidade e comportamento da Bella

Apresentação padrão:

> "Olá, tudo bem? Sou a Bella, assistente virtual do Hotel do Bosque 🌿 Estou pronta para ajudá-lo com informações, disponibilidade, reservas e dúvidas sobre sua hospedagem. Caso prefira falar diretamente com nossa equipe, nossa recepção está disponível 24 horas por dia pelo telefone +55 47 3367-0211."

**Deve:** ser educada, acolhedora, parecer humana, usar linguagem natural, adaptar-se ao perfil do cliente, aprender o estilo do hotel.

**Nunca deve:** inventar informações, tarifas ou disponibilidade; prometer descontos não autorizados; autorizar cancelamentos fora das regras; criar exceções sem aprovação.

## Canais integrados

WhatsApp Business API, Instagram Direct, Facebook Messenger, TikTok Messages, Telegram, E-mail, Chat do Site, Google Business Messages. Todos em uma única caixa de entrada.

## Módulos

| # | Módulo |
|---|---|
| M01 | Dashboard Executivo |
| M02 | Central Omnichannel |
| M03 | Bella AI (orquestrador) |
| M04 | CRM de Hóspedes |
| M05 | Pipeline Comercial |
| M06 | Motor de Reservas Inteligente |
| M07 | Base de Conhecimento (RAG) |
| M08 | Políticas Operacionais |
| M09 | Auditoria |
| M10 | Analytics |
| M11 | Gestão de Equipe |
| M12 | Integrações |
| M13 | Automações / Follow-up |
| M14 | Financeiro |
| M15 | Revenue Management |

## Telas

1. **Login** — email/senha; papéis: Proprietário, Gerente, Recepção, Comercial, Auditor.
2. **Dashboard** — KPIs (mensagens hoje, reservas geradas, receita, conversão, tempo médio de resposta, Bella x Humanos, leads ativos, ocupação prevista) e gráficos por canal/período/atendente.
3. **Caixa de Entrada Unificada** — layout estilo WhatsApp Business: lista de conversas | chat | perfil do hóspede; filtros por canal.
4. **Perfil do Hóspede** — dados, histórico, reservas, preferências, pontuação de interesse, probabilidade de fechamento.
5. **CRM Kanban** — Novo Lead → Consulta → Cotação → Negociação → Reserva Confirmada → Check-in → Pós Venda → Cliente Recorrente. Drag and drop.
6. **Central da Bella** — nome, personalidade, tom de voz, idioma, modelo de IA, temperatura e prompts (mestre, comercial, operacional, reservas, cancelamentos).
7. **Centro de Conhecimento** — upload de PDF/DOCX/TXT/CSV/XLSX/conversas WhatsApp e Instagram/FAQ → chunking → embeddings → indexação no Qdrant.
8. **Políticas** — cancelamento, reembolso, no-show, pets, crianças, grupos, pagamento, check-in/out, alterações. Versionadas com autor e aprovação.
9. **Auditoria** — pergunta, resposta, fontes, política usada, modelo, confiança, data/hora.
10. **Analytics** — motivos de perda, principais perguntas, origem das reservas, canal mais lucrativo, funil, mapa de calor.
11. **Revenue Management** — ocupação, tarifa média, demanda, eventos locais, sugestões de tarifa pela IA.

## Motor de Reservas Inteligente

A Bella extrai automaticamente: check-in, check-out, adultos, crianças 0–6, crianças 7–9.

**Regras de idade (obrigatórias):**
- 0–6 anos → política infantil configurada
- 7–9 anos → política infantil configurada
- 10+ anos → adulto

Se faltarem dados, solicitar **apenas** os dados faltantes. Com dados completos: consultar disponibilidade → regras tarifárias → ocupação → **gerar e enviar o link do motor de reservas automaticamente**, sem intervenção humana.

## Sistema Anti-Prejuízo (níveis de autorização)

- **Nível 1** — informações gerais: resposta automática.
- **Nível 2** — orçamentos e cotações: resposta automática com dados reais.
- **Nível 3** — requer aprovação humana: cancelamentos, estornos, reembolsos, descontos especiais, cortesias, alterações contratuais.

Toda resposta consulta a base de políticas. Em caso de dúvida → encaminhar para humano.

## Memória

- **Curto prazo:** últimas mensagens da conversa.
- **Médio prazo:** histórico da conversa.
- **Longo prazo:** perfil do hóspede, preferências, reservas anteriores.

## Follow-up automático

24h → 72h → 7 dias → 15 dias. Interromper quando houver reserva confirmada.

## Multi-idiomas

Português, Espanhol e Inglês com detecção automática.

## Roteamento de modelos de IA

- Reservas → modelo econômico
- Políticas → modelo preciso
- Vendas → modelo avançado

## Segurança

LGPD, criptografia AES-256, JWT, 2FA, logs imutáveis, backup automático, rate limit, WAF, controle de acesso por níveis.

## Escalabilidade

Multi-tenant (opção de 1 banco por cliente), sharding, Redis, RabbitMQ, Docker, Kubernetes, AWS, Cloudflare/CDN. Preparada para milhares de hotéis simultâneos.
