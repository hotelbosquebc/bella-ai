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

let falhas = 0;
function semPeriodo(nome, fala) {
  const p = M.intervalosNaFala(M.semPrefixos('Hóspede: ' + fala), HOJE);
  if (p.length) { falhas++; console.log('FALHOU  ' + nome + ' -> inventou ' + JSON.stringify(p)); }
  else console.log('ok      ' + nome);
}
function semOcupacao(nome, fala) {
  const d = M.extrairDeterminista('Hóspede: 21/11 a 24/11\nHóspede: ' + fala, HOJE);
  if (d) { falhas++; console.log('FALHOU  ' + nome + ' -> inventou adultos=' + d.adults); }
  else console.log('ok      ' + nome);
}
function ocupacao(nome, fala, esperado) {
  const d = M.extrairDeterminista('Hóspede: 21/11 a 24/11\nHóspede: ' + fala, HOJE);
  const real = d ? d.adults : null;
  if (real !== esperado) { falhas++; console.log('FALHOU  ' + nome + ' -> ' + real + ' (esperado ' + esperado + ')'); }
  else console.log('ok      ' + nome);
}

console.log('--- periodo NAO pode ser inventado ---');
semPeriodo('entre 2 e 3 pessoas em novembro', 'quero saber o valor entre 2 e 3 pessoas, em novembro');
semPeriodo('entre 2 e 3 noites', 'penso em ficar entre 2 e 3 noites em novembro');
semPeriodo('3 novamente', 'reservei 3 novamente, dá certo?');
semPeriodo('valor 1.500', 'o valor é 1.500 reais?');
semPeriodo('telefone', 'meu telefone é 47 99999-8888');
semPeriodo('so uma data', 'chego dia 21/11');
semPeriodo('dois numeros soltos', 'somos 2 adultos e 3 crianças');

console.log();
console.log('--- ocupacao NAO pode ser inventada ---');
semOcupacao('sao 2 noites', 'são 2 noites apenas');
semOcupacao('sao 3 diarias', 'são 3 diárias');
semOcupacao('temos 2 malas', 'nós temos 2 malas grandes');
semOcupacao('eu e minha filha', 'eu e minha filha');
semOcupacao('eu e meu filho', 'eu e meu filho');
semOcupacao('duvida sobre dos', 'qual o valor dos hóspedes extras?');

console.log();
console.log('--- e as formas novas continuam valendo ---');
ocupacao('somos 2', 'somos 2', 2);
ocupacao('somos em 4', 'somos em 4', 4);
ocupacao('so nos dois', 'só nós dois', 2);
ocupacao('eu e minha esposa', 'eu e minha esposa', 2);
ocupacao('eu e meu marido', 'eu e meu marido', 2);

console.log();
console.log('--- datas novas continuam valendo ---');
[['21/11 à 24/11'], ['entre 21 e 24 de novembro'], ['do dia 21 ao dia 24 de novembro'],
 ['entrada 21/11 saída 24/11'], ['check in 21/11 check out 24/11'], ['chegando 21/11 e saindo 24/11'],
 ['21 nov a 24 nov'], ['vinte e um a vinte e quatro de novembro']].forEach(([f]) => {
  const p = M.intervalosNaFala(M.semPrefixos('Hóspede: ' + f), HOJE);
  const bate = p.length === 1 && p[0].checkin === '2026-11-21' && p[0].checkout === '2026-11-24';
  if (!bate) { falhas++; console.log('FALHOU  ' + f + ' -> ' + JSON.stringify(p)); }
  else console.log('ok      ' + f);
});

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo passou');
process.exit(falhas ? 1 : 0);
