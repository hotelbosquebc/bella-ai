/**
 * Restaura no banco APONTADO POR DATABASE_URL um backup gerado pelo backup.js.
 *
 * Uso:
 *   DATABASE_URL="postgresql://...novo..." node scripts/restore.js backups/bella-....json
 *
 * Cuidados que o script toma por conta propria:
 *
 * - Recusa rodar se o banco de destino ja tiver dados, a menos que venha
 *   --sobrescrever. Restaurar por cima e o tipo de erro que so se percebe
 *   depois, e ai nao tem volta.
 * - Insere na ordem das tabelas (pai antes de filho) e usa createMany com
 *   skipDuplicates, entao rodar duas vezes nao duplica.
 * - Converte de volta as datas, que no JSON viraram texto.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const CAMPOS_DE_DATA = /(At|Em|_at|date|Date)$/;

function reidratar(linha) {
  const saida = {};
  for (const [k, v] of Object.entries(linha)) {
    const pareceData = typeof v === 'string' && CAMPOS_DE_DATA.test(k) && !Number.isNaN(Date.parse(v));
    saida[k] = pareceData ? new Date(v) : v;
  }
  return saida;
}

async function main() {
  const arquivo = process.argv[2];
  const sobrescrever = process.argv.includes('--sobrescrever');
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.error('Uso: DATABASE_URL="..." node scripts/restore.js <arquivo.json> [--sobrescrever]');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Faltou DATABASE_URL (o banco de DESTINO).');
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const prisma = new PrismaClient();

  const hoteis = await prisma.hotel.count();
  if (hoteis > 0 && !sobrescrever) {
    console.error(
      `O banco de destino JÁ TEM dados (${hoteis} hotel/hotéis). ` +
        'Se é isso mesmo que você quer, repita com --sobrescrever.',
    );
    process.exit(1);
  }

  for (const [tabela, linhas] of Object.entries(backup.tabelas)) {
    if (!linhas.length || !prisma[tabela]) continue;
    const r = await prisma[tabela].createMany({
      data: linhas.map(reidratar),
      skipDuplicates: true,
    });
    console.log(`${tabela}: ${r.count} de ${linhas.length} inseridas`);
  }

  console.log(`\nRestauração concluída (backup de ${backup.gerado}).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
