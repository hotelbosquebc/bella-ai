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

  const policies = [
    {
      category: 'CANCELLATION',
      title: 'Política de Cancelamento',
      content:
        'Cancelamentos gratuitos até 7 dias antes do check-in. Entre 7 dias e 48 horas: retenção de 50% do valor da primeira diária. Menos de 48 horas: retenção de 100% da primeira diária. Todo cancelamento deve ser confirmado pela equipe humana.',
    },
    {
      category: 'CHILDREN',
      title: 'Política Infantil',
      content:
        'Crianças de 0 a 6 anos: cortesia (não pagam hospedagem) acompanhadas dos pais. Crianças de 7 a 9 anos: pagam 50% do valor por pessoa. A partir de 10 anos: tarifa de adulto.',
    },
    {
      category: 'PETS',
      title: 'Política de Pets',
      content:
        'Aceitamos pets de pequeno porte (até 10kg), mediante taxa adicional por diária e aviso prévio na reserva. Máximo de 1 pet por apartamento.',
    },
    {
      category: 'CHECK_IN',
      title: 'Horários de Check-in e Check-out',
      content: 'Check-in a partir das 14h. Check-out até as 12h. Early check-in e late check-out sujeitos a disponibilidade e taxa.',
    },
    {
      category: 'PAYMENT',
      title: 'Formas de Pagamento',
      content: 'Aceitamos PIX, cartões de crédito (parcelamento em até 3x sem juros) e débito. Reserva garantida mediante pagamento de 30% de sinal.',
    },
  ];

  for (const p of policies) {
    const exists = await prisma.policy.findFirst({
      where: { hotelId: hotel.id, category: p.category, title: p.title },
    });
    if (!exists) {
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
