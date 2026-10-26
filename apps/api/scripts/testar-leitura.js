/**
 * Casos REAIS da leitura de pedidos (datas, pessoas, idades), para rodar antes
 * de publicar qualquer mudanca na leitura.
 *
 * Criado em 26/10/2026 depois de uma correcao (3482ae5) quebrar outra frase
 * no mesmo dia: "1 crianca + 2 adultos" passou a sair sem adultos. Cada caso
 * aqui veio de uma conversa real - o lado positivo e o negativo.
 *
 * Uso (depois de compilar):  npx nest build && node scripts/testar-leitura.js
 */
const m = require('../dist/modules/assist/assist.module.js');

const hoje = new Date('2026-10-22T12:00:00-03:00');
let falhas = 0;
const conferir = (grupo, descricao, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? 'ok   ' : 'FALHA'} [${grupo}] ${descricao} -> ${JSON.stringify(obtido)}${ok ? '' : `  (esperado ${JSON.stringify(esperado)})`}`);
};

// --- adultos -----------------------------------------------------------
const adultos = (s) => {
  const r = m.adultosNaFala(m.semPrefixos('Hóspede: ' + s));
  return [r.adultos, r.chegamDepois];
};
conferir('adultos', '3 adultos', adultos('3 adultos'), [3, 0]);
conferir('adultos', 'correcao vence', adultos('2 adultos. Na verdade somos 4 adultos'), [4, 0]);
conferir('adultos', 'soma sem tempo', adultos('3 adultos e mais 1 adulto'), [4, 0]);
conferir('adultos', 'chega depois', adultos('3 adultos e uma criança de 5 anos. Em uns 2 ou três dias tera mais um adulto que vai ficar com nós no apto.'), [3, 1]);
conferir('adultos', 'crianca + adultos', adultos('1 criança + 2 adultos'), [2, 0]);
conferir('adultos', 'eu e mais 2', adultos('eu e mais 2 adultos e 1 criança de 5 anos'), [3, 0]);
conferir('adultos', 'adultos + crianca', adultos('Somos 2 adultos + 1 criança de 5 anos'), [2, 0]);

// --- ocupacao (adultos + idades) ---------------------------------------
const ocup = (s) => {
  const o = m.ocupacaoNaFala(s);
  return o ? [o.adultos, o.idades] : null;
};
conferir('ocupacao', '2 criancas 12 anos', ocup('Hóspede: 30/12 a 03/01\n3 adultos\n2 crianças 12 anos'), [3, [12, 12]]);
conferir('ocupacao', '2 criancas de 5 anos', ocup('Hóspede: 2 adultos e 2 crianças de 5 anos'), [2, [5, 5]]);
conferir('ocupacao', 'idades diferentes', ocup('Hóspede: 2 adultos e 2 crianças de 12 e 8 anos'), [2, [12, 8]]);
conferir('ocupacao', 'bebe de 6 meses', ocup('Hóspede: 3 adultos e um bebê de 6 meses'), [3, [0]]);
conferir('ocupacao', '1 ano e 6 meses', ocup('Hóspede: 2 adultos e 1 bebê de 1 ano e 6 meses'), [2, [1]]);
conferir('ocupacao', 'moro ha 10 anos nao e idade', ocup('Hóspede: moro aqui há 10 anos, somos 2 adultos'), null);
conferir('ocupacao', 'adulto/cama nao vira idade', ocup('Hóspede: 2 hóspedes 1 criança 1 adulto 1 cama de casal'), null);
conferir('idade', 'pede a idade nesse caso', m.criancaSemIdade('Hóspede: 2 hóspedes 1 criança 1 adulto 1 cama de casal'), true);
conferir('idade', 'daqui 2 meses nao e idade', m.criancaSemIdade('Hóspede: daqui a 2 meses vamos, 2 adultos'), false);

// --- leitura completa sem IA --------------------------------------------
const det = (s) => {
  const d = m.extrairDeterminista(s, hoje);
  return d ? [d.checkin, d.checkout, d.adults] : null;
};
conferir('determinista', '4 funcionarios', det('Hóspede (hoje): estou procurando estadia para 4 funcionários.\nDo dia 26 a 30/10.'), ['2026-10-26', '2026-10-30', 4]);
conferir('determinista', 'personas', det('Hóspede: 4 personas de 10/01 a 15/01'), ['2027-01-10', '2027-01-15', 4]);
conferir('determinista', 'funcionarios em pergunta', det('Hóspede: os funcionários falam inglês? 26 a 30/10'), null);

// --- divisao por apartamento -------------------------------------------
const emCada = (s, total) => {
  const r = m.pessoasEmCadaApartamento(s, total);
  return r ? `${r.length}x${r[0].adultos}` : null;
};
conferir('divisao', '4 em cada', emCada('Pode ser 4 pessoas em cada apartamento', 8), '2x4');
conferir('divisao', '4 em cada com 7', emCada('4 em cada', 7), null);
conferir('divisao', 'cafe em cada andar', emCada('o café é servido em cada andar?', 8), null);

// --- periodos ------------------------------------------------------------
const per = (s) => m.periodosPedidos(s, hoje).join(' | ');
conferir('periodos', 'lista por semana', per('26/10\n27/10\n28/10\n29/10\n02/11\n03/11\n04/11\n05/11'), '26/10 a 29/10 | 02/11 a 05/11');
conferir('periodos', 'semana virando o mes', per('Segunda: 30/11\nTerça: 01/12\nQuarta: 02/12\nQuinta: 03/12'), '30/11 a 03/12');
conferir('periodos', 'dois periodos com a', per('10/11 a 12/11 ou 20/11 a 22/11'), '10/11 a 12/11 | 20/11 a 22/11');

console.log(falhas ? `\n${falhas} FALHA(S) - nao publicar` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
