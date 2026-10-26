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

// --- bateria de 26/10/2026 (formatos que dependiam da IA) ---------------
const hoje26 = new Date('2026-10-26T12:00:00-03:00');
const det26 = (s) => {
  const d = m.extrairDeterminista('Hóspede: ' + s, hoje26);
  return d ? [d.checkin, d.checkout, d.adults, d.idades || []] : null;
};
conferir('bateria', 'chegamos/saimos', det26('chegamos dia 20 e saímos dia 23 de novembro, somos 4'), ['2026-11-20', '2026-11-23', 4, []]);
conferir('bateria', 'espanhol del/al', det26('dos adultos y un niño de 6 años del 10 al 15 de enero'), ['2027-01-10', '2027-01-15', 2, [6]]);
conferir('bateria', 'espanhol 2 ninos', det26('2 adultos y 2 niños de 8 y 11 años, del 3 al 8 de febrero'), ['2027-02-03', '2027-02-08', 2, [8, 11]]);
conferir('bateria', 'mim e minha esposa', det26('Quero reservar de 1 a 3 de dezembro para mim e minha esposa'), ['2026-12-01', '2026-12-03', 2, []]);
const esc = require('../dist/modules/bella/escalonamento.js');
conferir('bateria', 'preciso de uma pessoa', esc.hospedePediuAtendente('tem alguém aí? preciso de uma pessoa'), true);
conferir('bateria', 'insatisfeito = reclamacao', Boolean(esc.motivoParaHumano({ falaDoHospede: 'Estou muito insatisfeito com o atendimento', resposta: 'texto suficientemente longo aqui', respostasAnteriores: [] })), true);
conferir('bateria', 'tem vaga sabado nao escala', esc.motivoParaHumano({ falaDoHospede: 'Tem vaga para sábado?', resposta: 'texto suficientemente longo aqui', respostasAnteriores: [] }), null);

// --- analise de 26/10/2026: conversa sem hotel e reserva em andamento -----
{
  const L = (...l) => l.join('\n');
  const sem = (c) => esc.conversaSemAssuntoDeHotel(c, m.apenasFalasDoHospede(c));
  conferir('analise', 'conversa pessoal (moto)', sem(L('Hóspede: oi Victor', 'Nós: fala', 'Hóspede: sobre o financiamento da moto', 'Hóspede: consegue segurar ela até sexta', 'Hóspede: quero dar uns 5mil de entrada')), true);
  conferir('analise', 'hospede so com bom dia', sem(L('Hóspede: Bom dia')), false);
  conferir('analise', 'hospede pergunta de pet', sem(L('Hóspede: boa tarde', 'Hóspede: vocês aceitam cachorro?', 'Hóspede: é pequeno')), false);
  conferir('analise', 'reserva em andamento', esc.reservaEmAndamento('Nós: Solicitação de reserva realizada! Para confirmar, leia atentamente'), true);
  conferir('analise', 'orcamento nao e andamento', esc.reservaEmAndamento('Nós: Segue o link com os valores e a disponibilidade'), false);
}

// --- apartamento pelo tipo (26/10/2026) ---------------------------------
{
  const tipo = (s) => {
    const r = m.apartamentosPorTipo('Hóspede: ' + s);
    return r ? `${r.length}x${r[0].adultos}` : null;
  };
  conferir('tipo', '4 apartamentos Superior duplos', tipo('disponibilidade do dia 24 a 29 de março 4 apartamentos Superior duplos.'), '4x2');
  conferir('tipo', '2 quartos triplos', tipo('2 quartos triplos'), '2x3');
  conferir('tipo', '3 aptos de casal', tipo('3 aptos de casal de 10/11 a 12/11'), '3x2');
  conferir('tipo', 'pergunta da planta', tipo('o apartamento tem 2 quartos de casal?'), null);
  conferir('tipo', 'com crianca nao decide', tipo('2 apartamentos duplos e 1 criança'), null);
  conferir('tipo', 'dois (02) quartos individuais', tipo('entrada terça-feira 03/11 pela manhã, saída 05/11 ....por ora dois (02) quartos individuais standard'), '2x1');
  conferir('tipo', 'duas suites duplas', tipo('preciso de duas suítes duplas'), '2x2');
  conferir('tipo', 'tem dois quartos de casal?', tipo('vocês tem dois quartos de casal?'), null);
}

// --- entrada pela manha (26/10/2026) -------------------------------------
{
  const cedo = (s) => m.entradaPelaManha('Hóspede: ' + s);
  conferir('manha', 'entrada 03/11 pela manha', cedo('entrada terça-feira 03/11 pela manhã, saída 05/11'), true);
  conferir('manha', 'chegamos as 9h', cedo('chegamos dia 10 às 9h'), true);
  conferir('manha', 'chegada cedo', cedo('a chegada vai ser cedo'), true);
  conferir('manha', 'NAO: saida pela manha', cedo('entrada 03/11, saída 05/11 pela manhã'), false);
  conferir('manha', 'NAO: chegada 20h', cedo('chegada às 20h'), false);
  conferir('manha', 'NAO: so datas', cedo('entrada 03/11 saída 05/11'), false);
}

// --- pedido de atendente (26/10/2026) ------------------------------------
for (const t of ['quero falar com um atendente', 'pode me passar para uma pessoa?', 'atendente por favor', 'quero atendimento humano',
  'pode me ligar?', 'falar com a recepção', 'quero falar com o Victor', 'Atendente', 'hablar con una persona']) {
  conferir('atendente', t, esc.hospedePediuAtendente(t), true);
}
for (const t of ['o atendente foi muito atencioso na última vez', 'a recepção funciona 24h?', 'quero falar sobre a reserva',
  'quero passar o réveillon aí', 'o Victor me atendeu ontem, obrigado']) {
  conferir('atendente', 'NAO: ' + t, esc.hospedePediuAtendente(t), false);
}
{
  const fonte = require('fs').readFileSync(require('path').join(__dirname, '../src/modules/assist/assist.module.ts'), 'utf8');
  const cedo = fonte.indexOf('PEDIU UMA PESSOA, no que disse por ultimo');
  const faltam = fonte.indexOf("'faltam dados (' +");
  conferir('ordem', 'pedido de atendente antes do faltam dados', cedo > 0 && cedo < faltam, true);
}

// --- auditoria diaria: o que ela aponta (26/10/2026) --------------------
{
  const aud = require('../dist/common/auditoria-respostas.js');
  const tipos = (t) => aud.auditarResposta(t).map((x) => x.tipo).sort();
  conferir('auditoria', 'ja anotei', tipos('Já anotei o aviso de chegada após as 18h para a equipe.'), ['prometeu registro/aviso interno']);
  conferir('auditoria', 'preco', tipos('O valor da diária é de R$ 430,00 para o casal.'), ['preço em reais']);
  conferir('auditoria', 'late gratuito', tipos('O late check-out é gratuito quando há disponibilidade.'), ['custo de early/late check-out']);
  conferir('auditoria', 'link de fora', tipos('Veja em https://www.booking.com/hotel/br/bosque.html'), ['link que não é do hotel']);
  conferir('auditoria', 'texto quebrado', tipos('Olá {{nome}}, segue undefined'), ['texto quebrado ou instrução interna']);
  conferir('auditoria', 'resposta boa com link', tipos('Segue o link:\n\nhttps://sbreserva.silbeck.com.br/hotelbosque/pt-br/reserva/busca/?checkin=2026-11-10&checkout=2026-11-12&adultos-000001=2'), []);
  conferir('auditoria', 'resposta boa do cafe', tipos('Sim, o café da manhã está incluso na diária e é servido das 7h às 10h.'), []);
}

// --- ordem das guardas na extensao --------------------------------------
// Achado de 26/10/2026: o texto final era montado ANTES das guardas, e todas
// as criadas desde 13/10 nao tinham efeito na extensao. Se esta conferencia
// falhar, alguem voltou a montar o texto antes delas.
{
  const fonte = require('fs').readFileSync(require('path').join(__dirname, '../src/modules/assist/assist.module.ts'), 'utf8');
  const posTextoFinal = fonte.indexOf('const textoFinal = garantirLink');
  const guardas = ['semPrecoInventado(draft.text', 'semPromessaDeRegistro(draft.text)', 'semGarantiaDeVaga(draft.text', 'semRaciocinioVazado(draft.text)'];
  for (const g of guardas) {
    conferir('ordem', `${g.split('(')[0]} antes do texto final`, fonte.indexOf(g) > 0 && fonte.indexOf(g) < posTextoFinal, true);
  }
}

console.log(falhas ? `\n${falhas} FALHA(S) - nao publicar` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
