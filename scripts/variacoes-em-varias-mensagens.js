/**
 * O hospede escrevendo em VARIAS MENSAGENS - que e como se escreve no WhatsApp.
 *
 * Cinco falhas desta semana foram da mesma familia: a leitura exigia a
 * informacao inteira na mesma linha. "Entrada 15/10/26" numa mensagem e "Saida
 * 16/10/26" na outra nao viravam periodo; "2 criancas" seguido de "Uma de 10"
 * e "Uma de 12" nao viravam idades.
 *
 * Em vez de esperar o proximo print, este corpus escreve as conversas como
 * elas chegam e cobra o resultado inteiro: periodo, adultos e idades.
 */
const { carregar } = require('./carregar-funcoes.js');

const M = carregar('apps/api/src/modules/assist/assist.module.ts');
const LF = String.fromCharCode(10);
const HOJE = new Date('2026-10-16T12:00:00');

/** Monta a conversa como ela chega: uma mensagem do hospede por linha. */
const conversa = (...mensagens) => mensagens.map((m) => 'Hóspede (hoje): ' + m).join(LF);

// Cada caso: as mensagens, e o que a leitura PRECISA extrair.
const CASOS = [
  // --- periodo partido ---
  { nome: 'entrada e saida em mensagens separadas', msgs: ['Entrada 15/10/26', 'Saida 16/10/26', '2 adultos'], checkin: '2026-10-15', checkout: '2026-10-16', adultos: 2 },
  { nome: 'check-in / check-out separados', msgs: ['check in 20/11', 'check out 23/11', '2 pessoas'], checkin: '2026-11-20', checkout: '2026-11-23', adultos: 2 },
  { nome: 'chegada e saida por extenso', msgs: ['chego dia 20/11', 'saio dia 23/11', 'somos 2'], checkin: '2026-11-20', checkout: '2026-11-23', adultos: 2 },
  { nome: 'dias numa msg, mes na outra', msgs: ['dias 21 a 24', 'de novembro', '2 adultos'], checkin: '2026-11-21', checkout: '2026-11-24', adultos: 2 },
  { nome: 'periodo e ocupacao em mensagens distintas', msgs: ['21/11 a 24/11', '3 adultos'], checkin: '2026-11-21', checkout: '2026-11-24', adultos: 3 },

  // --- ocupacao partida ---
  { nome: 'total, adultos e criancas separados', msgs: ['21/11 a 24/11', '4 pessoas', '2 adultos', '2 crianças', '1 de 8', '1 de 9'], checkin: '2026-11-21', checkout: '2026-11-24', adultos: 2, idades: [8, 9] },
  { nome: 'o caso real de 16/10', msgs: ['Uma diaria', '4 pessoas', '2 adultos', '2 crianças', 'Uma de 10', 'Uma de 12', 'Entrada 15/10/26', 'Saida 16/10/26'], checkin: '2026-10-15', checkout: '2026-10-16', adultos: 2, idades: [10, 12] },
  { nome: 'casal numa msg, crianca na outra', msgs: ['10/12 a 12/12', 'um casal', '1 criança de 5 anos'], checkin: '2026-12-10', checkout: '2026-12-12', adultos: 2, idades: [5] },
  { nome: 'idade com a palavra anos em msg separada', msgs: ['21/11 a 24/11', '2 adultos e 1 criança', '7 anos'], checkin: '2026-11-21', checkout: '2026-11-24', adultos: 2, idades: [7] },

  // --- formas de escrever a mesma coisa ---
  { nome: 'tudo numa mensagem so', msgs: ['21/11 a 24/11 para 2 adultos e 1 criança de 6 anos'], checkin: '2026-11-21', checkout: '2026-11-24', adultos: 2, idades: [6] },
  { nome: 'por extenso', msgs: ['de 21 a 24 de novembro', 'dois adultos', 'uma criança de seis anos'], checkin: '2026-11-21', checkout: '2026-11-24', adultos: 2, idades: [6] },
  { nome: 'com pontuacao grudada', msgs: ['21/11 a 24/11', '2.adultos', '1.criança de 6 anos'], checkin: '2026-11-21', checkout: '2026-11-24', adultos: 2, idades: [6] },
  { nome: 'idades entre parenteses', msgs: ['21/11 a 24/11', '2 adultos e 2 crianças (4/9)'], checkin: '2026-11-21', checkout: '2026-11-24', adultos: 2, idades: [4, 9] },
];

let falhas = [];
for (const c of CASOS) {
  const texto = conversa(...c.msgs);
  const d = M.extrairDeterminista(texto, HOJE);
  const problemas = [];
  if (!d) {
    problemas.push('nao extraiu nada');
  } else {
    if (d.checkin !== c.checkin) problemas.push('checkin=' + d.checkin);
    if (d.checkout !== c.checkout) problemas.push('checkout=' + d.checkout);
    if (c.adultos !== undefined && d.adults !== c.adultos) problemas.push('adultos=' + d.adults);
    if (c.idades && JSON.stringify((d.idades || []).sort()) !== JSON.stringify([...c.idades].sort())) {
      problemas.push('idades=' + JSON.stringify(d.idades));
    }
  }
  // Pedir de novo o que o hospede ja disse e a falha mais irritante de todas.
  if (c.idades && M.criancaSemIdade(texto)) problemas.push('PEDIRIA a idade de novo');
  if (problemas.length) falhas.push({ nome: c.nome, problemas });
}

console.log('conversas testadas: ' + CASOS.length + ' | lidas inteiras: ' + (CASOS.length - falhas.length) + ' | FALHAS: ' + falhas.length);
if (falhas.length) {
  console.log();
  falhas.forEach((f) => console.log('  ' + f.nome.padEnd(46) + ' -> ' + f.problemas.join(', ')));
}
process.exit(falhas.length ? 1 : 0);
