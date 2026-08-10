/*
 * Seed do treinamento da Bella: base de conhecimento + respostas rápidas.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Em jul/2026 o Postgres free do Render (bella-db) expirou e foi deletado. O
 * seed.js recriava hotel/admin/políticas, mas os conhecimentos e os atalhos
 * tinham sido carregados via API e viviam SÓ no banco — então se perderam junto.
 * Este script versiona esse conteúdo no repositório para que uma perda de banco
 * nunca mais custe o treinamento da Bella.
 *
 * Idempotente: faz upsert por (hotel, título) e por (hotel, atalho). Pode rodar
 * a cada deploy sem duplicar nada.
 *
 * ⚠️ ITENS COM `revisar: true` entram DESATIVADOS (active: false).
 * O texto original desses tópicos se perdeu com o banco; só sobrou o rótulo no
 * ESTADO.md. A regra do dono é que a Bella não invente — então em vez de gravar
 * um conteúdo deduzido, o item fica inativo até alguém do hotel escrever o texto
 * real em /knowledge. Conhecimento inativo não é injetado no prompt.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const HOTEL_ID = process.env.DEFAULT_HOTEL_ID ?? 'hotel-do-bosque';

/* ------------------------------------------------------------------ *
 * Base de conhecimento
 * ------------------------------------------------------------------ */
const conhecimentos = [
  // --- Confirmados: conteúdo registrado no ESTADO.md, seguro para uso ---
  {
    title: 'Café da manhã',
    content:
      'O café da manhã está incluso na diária e é servido no restaurante do térreo, das 7h às 10h.',
  },
  {
    title: 'Piscina',
    content:
      'O Hotel do Bosque NÃO possui piscina. Se o hóspede perguntar, responda de forma clara e educada — nunca sugira que há piscina nem prometa estrutura de lazer que o hotel não tem.',
  },
  {
    title: 'Estacionamento',
    content:
      'O hotel dispõe de estacionamento rotativo (as vagas não são fixas por apartamento e estão sujeitas à disponibilidade no momento).',
  },
  {
    title: 'Capacidade do apartamento',
    content:
      'Cada apartamento acomoda no máximo 6 pessoas. O valor da diária é calculado conforme a quantidade de pessoas no apartamento.',
  },
  {
    title: 'Localização e endereço',
    content:
      'Hotel do Bosque — Av. Brasil, 22, Balneário Camboriú/SC, CEP 88330-040.',
  },
  {
    title: 'Horário do setor de reservas',
    content:
      'O setor de reservas atende das 9h às 12h e das 14h30 às 17h30. Fora desse horário a solicitação é registrada e respondida no próximo horário de atendimento.',
  },
  {
    title: 'Formas e condições de pagamento',
    content:
      'Pagamento com 5% de desconto no pix. Parcelamento em até 10x, sendo até 3x sem juros. O sinal para garantir a reserva é de no mínimo 50% do valor total (ver Política de Formas de Pagamento).',
  },
  {
    title: 'Secador de cabelo e ferro de passar',
    content:
      'Os apartamentos dispõem de secador de cabelo. O ferro de passar pode ser solicitado na recepção.',
  },
  {
    title: 'Pets',
    content:
      'O hotel é pet-friendly e aceita pets de pequeno porte, sem cobrança de diária do pet. Aplica-se taxa mínima de R$ 200 em caso de descumprimento das normas ou necessidade de limpeza adicional. Detalhes completos na Política de Pets.',
  },
  {
    title: 'Atendimento em espanhol',
    content:
      'O hotel recebe muitos hóspedes do Uruguai e da Argentina. Se o hóspede escrever em espanhol, responda em espanhol, mantendo o mesmo tom acolhedor.',
  },
  {
    title: 'Negociação, descontos e casos especiais',
    content:
      'A Bella NÃO negocia preço, desconto, meia diária, cortesia ou condição especial, e não informa tarifas de cabeça. Nesses casos, e também para grupos, excursões e atletas, encaminhe para a equipe humana do setor de reservas. Grupos e atletas são atendidos presencialmente ou por um atendente.',
  },

  // --- Rótulo conhecido, texto original perdido: entram inativos p/ revisão ---
  {
    title: 'Wi-Fi',
    revisar: true,
    content: 'Rede, senha e cobertura do Wi-Fi nas áreas do hotel.',
  },
  {
    title: 'Categorias de apartamentos',
    revisar: true,
    content:
      'Descrição das categorias de apartamento, camas, metragem e diferenças entre elas.',
  },
  {
    title: 'Limpeza dos apartamentos',
    revisar: true,
    content: 'Frequência e horário da arrumação, troca de enxoval e toalhas.',
  },
  {
    title: 'Ingressos',
    revisar: true,
    content:
      'Ingressos de parques e atrativos vendidos ou intermediados pelo hotel, com condições.',
  },
  {
    title: 'Menores de idade',
    revisar: true,
    content:
      'Regras para hospedagem de menores, documentação e autorização exigida.',
  },
];

/* ------------------------------------------------------------------ *
 * Respostas rápidas (atalhos "/" na Caixa de Entrada)
 * ------------------------------------------------------------------ */
const REVISAR_ATALHO =
  '[REVISAR] O texto original deste atalho se perdeu com o banco. Reescreva em /quick-replies antes de usar.';

const respostasRapidas = [
  {
    shortcut: 'endereco',
    title: 'Endereço',
    content:
      'Nosso endereço é Av. Brasil, 22 — Balneário Camboriú/SC, CEP 88330-040. Qualquer dúvida para chegar, é só chamar!',
  },
  {
    shortcut: 'bomdia',
    title: 'Bom dia',
    content:
      'Bom dia! Tudo bem? Sou do Hotel do Bosque. Para eu verificar a disponibilidade, me informa por favor o período da estadia, quantas pessoas e, se houver crianças, a idade delas.',
  },
  {
    shortcut: '24',
    title: 'Pré-reserva válida por 24h',
    content:
      'A pré-reserva fica garantida por 24h. Após esse prazo, sem a confirmação do pagamento do sinal, ela é cancelada automaticamente e o apartamento volta à disponibilidade.',
  },
  // Estes dependem de dados que NÃO estão no repositório (dados bancários,
  // texto de voucher, fluxo do financeiro). Não invente — preencher no painel.
  { shortcut: 'banco', title: 'Dados bancários / PIX', content: REVISAR_ATALHO, revisar: true },
  { shortcut: 'financeiro', title: 'Encaminhado ao financeiro', content: REVISAR_ATALHO, revisar: true },
  { shortcut: 'confirmacao', title: 'Confirmação de reserva', content: REVISAR_ATALHO, revisar: true },
  { shortcut: 'confirmar', title: 'Pedido de confirmação', content: REVISAR_ATALHO, revisar: true },
  { shortcut: 'ingressos', title: 'Ingressos', content: REVISAR_ATALHO, revisar: true },
];

async function main() {
  const hotel = await prisma.hotel.findUnique({ where: { id: HOTEL_ID } });
  if (!hotel) {
    throw new Error(
      `Hotel "${HOTEL_ID}" não encontrado. Rode o seed.js antes deste script.`,
    );
  }

  let ativos = 0;
  let inativos = 0;

  for (const k of conhecimentos) {
    const active = !k.revisar;
    const content = k.revisar
      ? `[REVISAR — conteúdo original perdido na expiração do banco. Reescreva com a informação real do hotel e ative.]\n\n${k.content}`
      : k.content;

    const existing = await prisma.knowledgeDocument.findFirst({
      where: { hotelId: hotel.id, title: k.title },
    });

    if (existing) {
      // Não reativa nem sobrescreve um item que já foi revisado à mão no painel.
      if (existing.active && k.revisar) {
        continue;
      }
      await prisma.knowledgeDocument.update({
        where: { id: existing.id },
        data: { content, active },
      });
    } else {
      await prisma.knowledgeDocument.create({
        data: { hotelId: hotel.id, title: k.title, type: 'faq', content, active },
      });
    }

    if (active) ativos += 1;
    else inativos += 1;
  }

  let atalhos = 0;
  let atalhosRevisar = 0;

  for (const r of respostasRapidas) {
    const existing = await prisma.quickReply.findFirst({
      where: { hotelId: hotel.id, shortcut: r.shortcut },
    });

    if (existing) {
      // Se já tem texto real escrito no painel, não sobrescreve com o placeholder.
      if (r.revisar && existing.content !== REVISAR_ATALHO) {
        continue;
      }
      await prisma.quickReply.update({
        where: { id: existing.id },
        data: { title: r.title, content: r.content },
      });
    } else {
      await prisma.quickReply.create({
        data: {
          hotelId: hotel.id,
          shortcut: r.shortcut,
          title: r.title,
          content: r.content,
        },
      });
    }

    atalhos += 1;
    if (r.revisar) atalhosRevisar += 1;
  }

  console.log(
    `Treinamento da Bella restaurado: ${ativos} conhecimentos ativos, ` +
      `${inativos} aguardando revisão (inativos), ${atalhos} respostas rápidas ` +
      `(${atalhosRevisar} com texto a preencher em /quick-replies).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
