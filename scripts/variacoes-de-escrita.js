const fs = require('fs'), path = require('path');
const ts = require(path.join(process.cwd(), 'node_modules/typescript'));
let src = fs.readFileSync('apps/api/src/modules/assist/assist.module.ts', 'utf8');
const corte = src.search(/^@(Controller|Module|Injectable)/m);
if (corte > 0) src = src.slice(0, corte);
src = src.replace(/^import .*$/gm, '');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('exports', 'module', 'require', js)(mod.exports, mod, require);
const M = mod.exports;
const HOJE = new Date('2026-10-14T12:00:00');

// ---------- PERÍODO: todas as formas de dizer 21 a 24 de novembro ----------
const PERIODOS = [
  '21/11 a 24/11', '21/11 até 24/11', '21/11 - 24/11', '21/11 à 24/11',
  '21/11/26 a 24/11/26', '21/11/2026 a 24/11/2026', '21.11 a 24.11',
  '21 a 24 de novembro', '21 a 24 novembro', 'dia 21 a 24 de novembro',
  'do dia 21 ao dia 24 de novembro', 'entre 21 e 24 de novembro',
  '21 de novembro a 24 de novembro', 'de 21/11 até 24/11',
  'entrada 21/11 saída 24/11', 'check in 21/11 check out 24/11',
  'chegando 21/11 e saindo 24/11', 'entrando dia 21 e saindo dia 24 de novembro',
  '21 nov a 24 nov', '21 a 24/11', 'vinte e um a vinte e quatro de novembro',
];

// ---------- PESSOAS: todas as formas de dizer 2 adultos ----------
const PESSOAS = [
  '2 adultos', '2adultos', '2.adultos', '2-adultos', 'dois adultos',
  '2 pessoas', '2 hospedes', '2 hóspedes', 'somos 2', 'seremos 2 pessoas',
  'para 2 pessoas', 'um casal', '1 casal', 'eu e minha esposa',
  'duas pessoas', '02 adultos', '2 adultos apenas', 'só nós dois',
];

// ---------- CRIANÇAS E IDADES: 2 adultos + criança de 5 ----------
const CRIANCAS = [
  '2 adultos e 1 criança de 5 anos',
  '2 adultos e uma criança de cinco anos',
  '2 adultos, 1 criança (5)',
  '2 adultos e 1 criança 5 anos',
  '2 adultos + 1 criança de 5 anos',
  '2 adultos e um filho de 5 anos',
  '2 adultos e uma menina de 5 anos',
  '2 adultos com 1 bebê de 5 anos',
  'casal com uma criança de 5 anos',
  '2 adultos e 1 criança, ela tem 5 anos',
  '2 adultos e 1 criança de 5 aninhos',
];

let total = 0, falhas = [];
function testa(grupo, fala, verifica) {
  total++;
  const t = 'Hóspede (hoje): ' + fala;
  let r;
  try { r = verifica(t); } catch (e) { r = 'ERRO: ' + e.message; }
  if (r !== true) falhas.push({ grupo, fala, problema: r });
}

PERIODOS.forEach((f) =>
  testa('período', f, (t) => {
    const p = M.intervalosNaFala(M.semPrefixos(t), HOJE);
    if (p.length !== 1) return 'leu ' + p.length + ' períodos';
    if (p[0].checkin !== '2026-11-21' || p[0].checkout !== '2026-11-24') return JSON.stringify(p[0]);
    return true;
  }),
);
PESSOAS.forEach((f) =>
  testa('pessoas', f, (t) => {
    const d = M.extrairDeterminista('Hóspede: 21/11 a 24/11\n' + t, HOJE);
    if (!d) return 'nao extraiu';
    if (d.adults !== 2) return 'adultos=' + d.adults;
    return true;
  }),
);
CRIANCAS.forEach((f) =>
  testa('crianças', f, (t) => {
    const d = M.extrairDeterminista('Hóspede: 21/11 a 24/11\n' + t, HOJE);
    if (!d) return 'nao extraiu';
    const n = M.normalizarOcupacao({ ...d });
    if (n.adults !== 2) return 'adultos=' + n.adults;
    if (n.children0_6 !== 1) return 'criancas0_6=' + n.children0_6;
    return true;
  }),
);

console.log('variações testadas: ' + total + ' | entendidas: ' + (total - falhas.length) + ' | NÃO entendidas: ' + falhas.length);
console.log();
const porGrupo = {};
falhas.forEach((f) => { (porGrupo[f.grupo] = porGrupo[f.grupo] || []).push(f); });
for (const [g, lista] of Object.entries(porGrupo)) {
  console.log('--- ' + g.toUpperCase() + ' (' + lista.length + ' falhas) ---');
  lista.forEach((f) => console.log('   ' + JSON.stringify(f.fala).padEnd(48) + ' -> ' + f.problema));
  console.log();
}
