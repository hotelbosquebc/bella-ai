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
      'Pagamento com 5% de desconto no pix. Parcelamento em até 10x, sendo até 3x sem juros. IMPORTANTE para a Bella: no caminho que ela conduz, o hóspede reserva no próprio site e paga ali, no momento de concluir a reserva — é o pagamento que confirma. Sinal, entrada e prazos de pagamento valem para reservas feitas pela equipe, NÃO devem ser informados pela Bella.',
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

  // --- Extraídos das conversas reais do WhatsApp (14/08/2026) ---
  // São respostas que a própria equipe deu a hóspedes; por isso entram ativas.
  {
    title: 'Camas e acomodação no apartamento',
    content:
      'Acomodamos até 6 pessoas no máximo por apartamento. Cada apartamento tem 1 cama de casal e 2 de solteiro; as demais pessoas ficam em colchão extra. Se o hóspede pedir camas separadas, informe essa composição.',
  },
  {
    title: 'Cozinha no apartamento',
    content:
      'Os apartamentos têm cozinha e o hóspede pode utilizá-la livremente durante a estadia.',
  },
  {
    title: 'Lavanderia',
    content:
      'O hotel NÃO tem lavanderia. Os apartamentos têm um pequeno tanque de lavar e, próximo ao hotel, há algumas opções de lavanderia.',
  },
  {
    title: 'Suíte Bosque (categoria)',
    content:
      'A Suíte Bosque é a única categoria com dois banheiros e aquecimento a gás. Fica no 7º e 8º andar, acomoda até 6 hóspedes e conta com Wi-Fi e ar-condicionado. O secador de cabelo é solicitado na recepção.',
  },
  {
    title: 'Problemas do hóspede no site de reservas',
    content:
      'A senha do site é criada pelo próprio hóspede; se não lembrar, deve usar "esqueci a senha" para receber uma senha temporária por e-mail. Se ainda assim não conseguir concluir, a equipe de reservas resolve — encaminhe para ela. A Bella NÃO realiza reservas pelo WhatsApp e não deve oferecer esse caminho por conta própria.',
  },
  {
    title: 'Site e WhatsApp têm o mesmo preço',
    content:
      'O site de reservas é o mesmo canal usado no WhatsApp — os valores são os mesmos. O pagamento via pix no site libera 5% de desconto.',
  },
  {
    title: 'Escolinhas de futebol e grupos esportivos',
    content:
      'O hotel não recebe reservas de escola de futebol. Grupos, excursões e equipes esportivas não são atendidos pela Bella — encaminhe para a equipe de reservas.',
  },
  {
    title: 'Currículos e vagas de emprego',
    content:
      'Se alguém enviar currículo ou perguntar sobre vagas, responda com cordialidade que no momento não estamos contratando e que o contato fica registrado. Não é assunto de reservas.',
  },

  {
    title: 'Wi-Fi',
    content:
      'O hotel tem Wi-Fi. A senha é sempre "bosque00". Pode informá-la ao hóspede quando perguntarem.',
  },
  {
    title: 'Descontos autorizados',
    content:
      'O ÚNICO desconto que você pode informar é o de 5% para pagamento via pix no site do hotel. Qualquer outro desconto, condição especial ou percentual maior depende de autorização da gerência e você NÃO tem como concedê-lo nem prometê-lo. Se o hóspede pedir desconto além disso, não negue de forma seca nem invente um valor: diga com cordialidade que vai encaminhar para a equipe de reservas avaliar, e informe o horário de atendimento dela.',
  },

  // --- Rótulo conhecido, texto original perdido: entram inativos p/ revisão ---
  {
    title: 'Categorias de apartamentos',
    revisar: true,
    content:
      'O hotel trabalha com 4 categorias (a equipe costuma dizer "temos estas 4 opções"). Só a Suíte Bosque está descrita. Falta listar as outras três e suas diferenças.',
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
  // Atalho do atendente HUMANO. Vale para as reservas que a EQUIPE fecha pelo
  // WhatsApp — a Bella não tem essa função e por isso o prazo NÃO entra como
  // conhecimento dela (conhecimento vai para o prompt, e ela não informa prazo
  // de pagamento). O nome do atalho é "/24" por herança: o prazo real é 30 min.
  {
    shortcut: '24',
    title: 'Validade da pré-reserva (30 min)',
    content:
      'Atenção sobre sua reserva: sua solicitação é válida por 30 minutos. Após esse prazo, sem a confirmação do pagamento, a reserva é cancelada e o apartamento volta à disponibilidade.',
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
