/* Seed inicial: Hotel do Bosque, usuário admin, configurações da Bella e políticas base. */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const hotel = await prisma.hotel.upsert({
    where: { id: 'hotel-do-bosque' },
    update: {},
    create: {
      id: 'hotel-do-bosque',
      name: 'Hotel do Bosque',
      phone: '+55 47 3367-0211',
      timezone: 'America/Sao_Paulo',
    },
  });

  // Admin: e-mail e senha vêm do ambiente (defina ADMIN_PASSWORD no Render).
  // O repositório NÃO contém senha real. Sem ADMIN_PASSWORD, gera-se uma senha
  // aleatória descartável apenas na criação inicial.
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@hoteldobosque.com.br';
  const adminPassword = process.env.ADMIN_PASSWORD;
  const effectivePassword = adminPassword ?? crypto.randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(effectivePassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    // Só sobrescreve a senha do admin existente quando ADMIN_PASSWORD foi definido.
    update: adminPassword ? { passwordHash } : {},
    create: {
      hotelId: hotel.id,
      name: 'Administrador',
      email: adminEmail,
      passwordHash,
      role: 'OWNER',
    },
  });

  await prisma.aiSettings.upsert({
    where: { hotelId: hotel.id },
    update: {},
    create: { hotelId: hotel.id },
  });

  // Políticas oficiais do Hotel do Bosque (reservas diretas). Reservas via
  // Booking/Expedia/Decolar etc. seguem as regras da própria plataforma.
  const policies = [
    {
      category: 'CANCELLATION',
      title: 'Política de Cancelamento',
      content:
        'Cancelamentos e alterações somente por escrito via WhatsApp (47) 3367-0211 ou e-mail reservas@hotelbosque.com.br, dentro do horário do setor de reservas (segunda a sexta, 8h às 18h). Multa conforme antecedência do check-in: até 30 dias antes: 10% do valor total; de 29 a 15 dias: 50%; de 14 a 8 dias: 80%; menos de 7 dias: 100%. Não há reembolso em dinheiro — o saldo, quando houver, fica como crédito para hospedagem por até 1 ano, conforme disponibilidade. Toda solicitação de cancelamento exige confirmação da equipe humana.',
    },
    {
      category: 'CHILDREN',
      title: 'Política Infantil',
      content:
        'Crianças de 0 a 6 anos: cortesia (não pagam hospedagem) acompanhadas dos pais. Crianças de 7 a 9 anos: pagam 50% do valor por pessoa. A partir de 10 anos: tarifa de adulto. O valor é cobrado conforme a quantidade de pessoas no apartamento (máximo 6 pessoas por apartamento).',
    },
    {
      category: 'PETS',
      title: 'Política de Pets',
      content:
        'Hotel Pet-Friendly: aceitamos pets de pequeno porte, seguindo as normas entregues no check-in. Não cobramos diária do pet. Em caso de descumprimento das normas ou necessidade de limpeza adicional (tapetes, sofás, dejetos), cobra-se do hóspede uma taxa mínima de R$ 200. Nas áreas comuns o pet deve ficar no colo; não tem acesso ao restaurante; danos causados são cobrados do tutor.',
    },
    {
      category: 'CHECK_IN',
      title: 'Horários de Check-in e Check-out',
      content:
        'Check-in a partir das 14h, devendo ser realizado até as 18h. Check-out até as 11h da manhã. Caso o hóspede chegue após as 18h, deve comunicar o atraso para manter a reserva ativa e não ser caracterizado como no-show. O não cumprimento do horário de check-out acarreta multa equivalente a 2 diárias, além da desocupação imediata. Early check-in e late check-out sujeitos a disponibilidade e taxa.',
    },
    {
      category: 'NO_SHOW',
      title: 'Política de No-show',
      content:
        'O check-in deve ser realizado até as 18h. Após esse horário, o hóspede deve comunicar o atraso para manter a reserva ativa, sob pena de ser caracterizado como no-show (não comparecimento) e a reserva ser cancelada. Em caso de parcelamento, o atraso ou não pagamento na data combinada resulta em cancelamento da reserva e perda dos valores pagos.',
    },
    {
      category: 'PAYMENT',
      title: 'Formas de Pagamento',
      content:
        'Para garantir a reserva (sinalização) é necessário o pagamento de no mínimo 50% do valor total via pix, transferência ou depósito (ou parcelamento previamente acordado). A pré-reserva é válida por até 24h; sem confirmação do pagamento, é cancelada automaticamente. O saldo restante é pago no ato do check-in. Aceitamos cartões Visa, Mastercard, American Express e Elo. Não cobramos taxa de serviço/turismo. Não aceitamos cheque.',
    },
    {
      category: 'GROUPS',
      title: 'Política de Grupos e Excursões',
      content:
        'Para grupos/excursões: a distribuição dos hóspedes nos apartamentos é de responsabilidade do responsável do grupo. O hotel não se responsabiliza pelos motoristas (devem ser incluídos pelo responsável na reserva). Em caso de parcelamento, atraso ou não pagamento na data combinada resulta em cancelamento e perda dos valores pagos. O responsável aceita as normas vigentes entregues no check-in.',
    },
  ];

  // Upsert por (hotel, categoria, título): atualiza o conteúdo se já existir.
  for (const p of policies) {
    const existing = await prisma.policy.findFirst({
      where: { hotelId: hotel.id, category: p.category, title: p.title },
    });
    if (existing) {
      await prisma.policy.update({
        where: { id: existing.id },
        data: { content: p.content, approved: true, active: true },
      });
    } else {
      await prisma.policy.create({
        data: { ...p, hotelId: hotel.id, approved: true, active: true },
      });
    }
  }

  console.log(
    `Seed concluído: hotel, admin (${adminEmail}), configurações da Bella e 5 políticas. ` +
      (adminPassword
        ? 'Senha do admin definida via ADMIN_PASSWORD.'
        : 'ATENÇÃO: ADMIN_PASSWORD não definido — senha aleatória gerada na criação; defina ADMIN_PASSWORD para controlá-la.'),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
