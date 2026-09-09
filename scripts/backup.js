/**
 * Backup completo do banco da Bella para um arquivo JSON.
 *
 * Existe porque o Postgres gratuito do Render EXPIRA (por volta de 12/09/2026)
 * e, quando expirou da primeira vez, o banco simplesmente sumiu com toda a base
 * de conhecimento junto - foi preciso reescrever tudo a mao. Nao dependa da
 * memoria de ninguem: rode isto antes de qualquer migracao.
 *
 * Uso (a URL vem do Render: bella-db > Connect > External Database URL):
 *
 *   DATABASE_URL="postgresql://..." node scripts/backup.js
 *
 * Grava backups/bella-AAAA-MM-DD-HHMM.json. Nao imprime a URL nem a senha.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

// Ordem importa no restore: pai antes de filho.
const TABELAS = [
  'hotel',
  'user',
  'guest',
  'conversation',
  'message',
  'lead',
  'reservation',
  'knowledgeDocument',
  'policy',
  'aiAudit',
  'aiSettings',
  'attachment',
  'quickReply',
  'suggestionFeedback',
  'licao',
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Faltou DATABASE_URL. Pegue em Render > bella-db > Connect > External Database URL.');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const saida = { gerado: new Date().toISOString(), tabelas: {} };

  for (const t of TABELAS) {
    if (!prisma[t]) {
      console.warn(`(tabela ${t} não existe neste schema — pulando)`);
      continue;
    }
    const linhas = await prisma[t].findMany();
    saida.tabelas[t] = linhas;
    console.log(`${t}: ${linhas.length}`);
  }

  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const agora = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const arquivo = path.join(dir, `bella-${agora}.json`);
  // Datas viram string ISO no JSON; o restore converte de volta.
  fs.writeFileSync(arquivo, JSON.stringify(saida, null, 2));

  const kb = Math.round(fs.statSync(arquivo).size / 1024);
  console.log(`\nBackup salvo: ${arquivo} (${kb} KB)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
