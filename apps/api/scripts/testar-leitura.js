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
  conferir('auditoria', 'inventario vazado', tipos('INVENTÁRIO:\n\nOlá! Sou a Bella'), ['texto quebrado ou instrução interna']);
}

// --- pedidos de esclarecimento contam por MENSAGEM (27/10/2026) ---------
{
  const saudacao = 'Nós: Olá! Sou a Bella, assistente online do Hotel do Bosque.\nPara verificarmos os valores e disponibilidade por gentileza me informe:\n📆 Período da estadia (data de entrada e saída);\n👪 Quantidade total de pessoas;';
  conferir('esclarecimento', 'saudacao padrao = 1 pedido', m.tentativasDeEsclarecimento(saudacao + '\nHóspede: de 31/10 a 03/11'), 1);
  conferir('esclarecimento', 'saudacao + nova pergunta = 2', m.tentativasDeEsclarecimento(saudacao + '\nHóspede: oi\nNós: Não entendi, pode me explicar?'), 2);
}

// --- disponibilidade: as 4 categorias esgotadas = sem vaga (28/10/2026) --
{
  const { SilbeckAvailabilityService } = require('../dist/modules/reservations/silbeck-availability.service.js');
  const s = new SilbeckAvailabilityService();
  const sem = (html) => s.interpretar(html).semDisponibilidade;
  conferir('vaga', 'nenhuma categoria na listagem = sem vaga', sem('<div class="aviso"><p>Nenhum apartamento encontrado para o período selecionado. Tente outras datas.</p></div>'), true);
  conferir('vaga', 'aviso classico', sem('<p>Não há disponibilidade para o período</p>'), true);
  conferir('vaga', 'com categoria = tem vaga', sem('<div>Apartamento Luxo</div><div>Apenas 2 disponíveis</div><div>Apartamento Standard</div>'), false);
  conferir('vaga', 'html vazio nao decide', sem('<div></div>'), false);
}

// --- rascunho vazado antes da saudacao (27/10/2026) ----------------------
{
  const limpa = require('../dist/common/resposta-limpa.js');
  conferir('vazado', 'INVENTARIO: antes do Ola', limpa.semRaciocinioVazado('INVENTÁRIO:\n\nOlá! Sou a Bella, assistente online do Hotel do Bosque.\n\nQue bom que você já tem as datas.'),
    'Olá! Sou a Bella, assistente online do Hotel do Bosque.\n\nQue bom que você já tem as datas.');
  conferir('vazado', 'inventario com lista', limpa.semRaciocinioVazado('INVENTÁRIO:\n(a) período: 17/03 a 23/03\n(b) 4 pessoas\n\nOlá! Segue o link.'), 'Olá! Segue o link.');
  conferir('vazado', 'inventario sem saudacao', limpa.semRaciocinioVazado('**Inventário:**\n(a) 17 a 23/03\n\nPerfeito, para 4 pessoas segue o link.'), 'Perfeito, para 4 pessoas segue o link.');
  // Atendimento online primeiro (27/10/2026).
  const link = 'https://sbreserva.silbeck.com.br/hotelbosque/pt-br/reserva/busca/?checkin=2026-10-28&checkout=2026-11-04&adultos-000001=2';
  conferir('online', 'tira oferta de pix', limpa.semOfertaDeAtendente(`Segue o link:\n\n${link}\n\nSe preferir fazer a reserva por aqui mesmo pelo WhatsApp com pagamento via pix, basta pedir que eu encaminho para o nosso especialista em reservas.`, 'Casal com bebê\n28/10 a 04/11', false), `Segue o link:\n\n${link}`);
  conferir('online', 'NAO tira quando hospede pediu pix', limpa.semOfertaDeAtendente('Se preferir pelo WhatsApp com pix, eu encaminho.', 'posso pagar no pix?', false), 'Se preferir pelo WhatsApp com pix, eu encaminho.');
  conferir('online', 'NAO tira quando pediu atendente', limpa.semOfertaDeAtendente('Se preferir, encaminho para a equipe.', 'quero falar com alguém', true), 'Se preferir, encaminho para a equipe.');
  conferir('online', 'tira pedido de dados com link', limpa.semPedidoDeDadosComLink(`Olá! Sou a Bella, assistente online do Hotel do Bosque.\n\nPara verificarmos os valores e disponibilidade por gentileza me informe:\n\n· Período da estadia (data de entrada e saída);\n· Quantidade total de pessoas;\n· Caso tenha crianças menores de 10 anos, gentileza informar as idades.\n\nSegue o link:\n\n${link}`), `Olá! Sou a Bella, assistente online do Hotel do Bosque.\n\nSegue o link:\n\n${link}`);
  conferir('online', 'pedido de dados SEM link fica', limpa.semPedidoDeDadosComLink('Por gentileza me informe:\n· Período da estadia (data de entrada e saída);'), 'Por gentileza me informe:\n· Período da estadia (data de entrada e saída);');
  conferir('vazado', 'resposta normal intacta', limpa.semRaciocinioVazado('Perfeito!\n\nOlá de novo, segue o link.'), 'Perfeito!\n\nOlá de novo, segue o link.');
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

// --- leitura completa do pedido (bookingContext), sem IA e sem banco -----
// Casos reais em que cada funcao isolada acertava e o conjunto errava.
(async () => {
  const R = require('../dist/modules/reservations/reservation-engine.service.js');
  const banco = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => null }) });
  const semIA = { complete: async () => { throw new Error('sem ia nos testes'); } };
  // `extraido`: o que a IA devolveria na extracao, para casos que dependem dela.
  const pedido = async (conversa, extraido) => {
    const ia = extraido ? { complete: async () => ({ model: 'teste', toolInput: extraido }) } : semIA;
    const c = new m.AssistController(banco, ia, {}, {}, new R.ReservationEngineService({}), {}, { definirLeitorDoPedido() {} });
    const ctx = await c.bookingContext(conversa);
    return { ctx, decisoes: c.decisoesLink.map((d) => d.motivo) };
  };
  const saudacao = 'Nós: Olá! Sou a Bella, assistente online do Hotel do Bosque.\nPara verificarmos os valores e disponibilidade por gentileza me informe:\n📆 Período da estadia (data de entrada e saída);\n👪 Quantidade total de pessoas;';
  // 27/10/2026: pedido ontem, so "bom dia" hoje -> passou para humano sem link.
  const r1 = await pedido(saudacao + '\nHóspede: Gostaria de efetuar uma reserva de 31/10 a 03/11, seriam dois quartos para casal.\nHóspede (hoje): Olá,bom dia!!');
  conferir('pedido', 'dois quartos para casal + bom dia hoje', r1.decisoes, ['ocupacao pelo tipo de apartamento: 2x2', 'divisao escrita pelo hospede: 2 apartamentos', 'varios apartamentos: um link para cada']);
  conferir('pedido', 'dois quartos para casal: nao pergunta juntos', /JÁ ESCOLHEU/.test(r1.ctx), true);
  // 27/10/2026: "do dia 08/11 ao dia 13" + "03 adultos e um bebê" -> pediu a idade do bebe, sem link.
  const r2 = await pedido('Hóspede: preciso saber se a internet é boa\nNós: Olá! Esta é uma mensagem automática.\nHóspede (hoje): do dia 08/11 ao dia 13\nHóspede (hoje): para 03 adultos e um bebê\nHóspede (hoje): qual é o valor dos quartos por nome para que eu faça a escolha');
  conferir('pedido', '08/11 ao dia 13, 3 adultos e um bebe', r2.decisoes, ['link montado']);
  conferir('pedido', 'bebe vai como crianca 0-6', /checkin=2026-11-08&checkout=2026-11-13&adultos-000001=3&criancas-000003=1/.test(r2.ctx), true);

  // 28/10/2026: "dois quartos individuais" + datas -> perguntou "quantas pessoas?".
  // "Hoje e sair na sexta" quem le e a IA: o teste entrega o que ela devolveu em producao.
  const r3 = await pedido('Hóspede (hoje): Gostaria de reservar dois quartos individuais novamente\nHóspede (hoje): Hoje e sair na sexta',
    { checkin: '2026-10-28', checkout: '2026-10-30', adults: null, intent: 'booking' });
  conferir('pedido', 'dois quartos individuais = 2 apartamentos de 1', r3.decisoes, ['ocupacao pelo tipo de apartamento: 2x1', 'divisao escrita pelo hospede: 2 apartamentos', 'varios apartamentos: um link para cada']);

  // Bebe sem idade = crianca de 0 a 6 (regra do dono: bebe e sempre menor de 6).
  const oc = (s) => JSON.stringify(m.ocupacaoNaFala('Hóspede: ' + s));
  conferir('bebe', '3 adultos e um bebe', oc('para 03 adultos e um bebê'), JSON.stringify({ adultos: 3, idades: [1] }));
  conferir('bebe', '2 adultos e dois bebes', oc('2 adultos e dois bebês'), JSON.stringify({ adultos: 2, idades: [1, 1] }));
  conferir('bebe', 'bebe de 2 anos fica 2', oc('2 adultos e 1 bebê de 2 anos'), JSON.stringify({ adultos: 2, idades: [2] }));
  conferir('bebe', 'NAO: pergunta "aceitam bebe?"', m.ocupacaoNaFala('Hóspede: aceitam bebê?'), null);
  conferir('bebe', '2 adultos e o bebe', oc('somos 2 adultos e o bebê'), JSON.stringify({ adultos: 2, idades: [1] }));
  conferir('bebe', 'casal com bebe nao pede idade', m.criancaSemIdade('Hóspede: 2 adultos com bebê'), false);
  conferir('bebe', 'NAO: tem berco para bebe?', m.criancaSemIdade('Hóspede: tem berço para o bebê?'), true);

  // Mes so na primeira data.
  const per = (s) => JSON.stringify(m.intervalosNaFala('Hóspede: ' + s, hoje));
  conferir('periodo', '08/11 a 13', per('do dia 08/11 ao dia 13'), JSON.stringify([{ checkin: '2026-11-08', checkout: '2026-11-13' }]));
  conferir('periodo', '28/11 a 2 vira dezembro', per('28/11 a 2'), JSON.stringify([{ checkin: '2026-11-28', checkout: '2026-12-02' }]));
  conferir('periodo', 'NAO: 10/11 a 12 pessoas', per('10/11 a 12 pessoas'), '[]');
  conferir('periodo', 'NAO: dia 10/11 à 14h', per('dia 10/11 à 14h'), '[]');

  // Conversa de outros dias e contexto (29/10/2026): a Bella respondeu a uma
  // conversa de setembro porque hoje so tinham saido mensagens automaticas.
  {
    const ca = require('../dist/common/conversa-antiga.js');
    conferir('antiga', 'sem antiga: igual a antes', ca.comConversaAntiga('Hóspede (hoje): oi'), 'Conversa até aqui:\nHóspede (hoje): oi');
    const bloco = ca.comConversaAntiga('Hóspede (hoje): 01/11 a 02/11, 2 pessoas', 'Hóspede: LI E CONCORDO');
    conferir('antiga', 'antiga rotulada como so contexto', /DIAS ANTERIORES[\s\S]*LI E CONCORDO[\s\S]*CONVERSA RECENTE[\s\S]*01\/11/.test(bloco), true);
    // A divisao por data acontece na extensao: o servidor so ve "(hoje)".
    const fonteExt = require('fs').readFileSync(require('path').join(__dirname, '../../../whatsapp-extension/content.js'), 'utf8');
    const corpo = fonteExt.match(/function dividirPorIdade\(mensagens, datas\) \{[\s\S]*?\r?\n  \}\r?\n/)[0];
    const dividir = new Function(corpo + '; return dividirPorIdade;')();
    const d = (dias) => { const x = new Date(); x.setDate(x.getDate() - dias); return x.toLocaleDateString('pt-BR'); };
    const ms = ['Hóspede: LI E CONCORDO', 'Nós: Solicitação de reserva realizada', 'Nós (hoje): Para dúvidas urgentes', 'Hóspede (hoje): 01/11 a 02/11, 2 pessoas'];
    conferir('antiga', 'setembro sai da conversa recente', JSON.stringify(dividir(ms, [d(45), d(45), d(0), d(0)])), JSON.stringify({ recente: ms.slice(2).join('\n'), antiga: ms.slice(0, 2).join('\n') }));
    conferir('antiga', 'pedido de ontem continua recente', dividir(ms, [d(1), d(1), d(0), d(0)]).antiga, '');
    conferir('antiga', 'audio sem data herda a anterior', dividir(ms, [d(45), null, d(0), d(0)]).antiga, ms.slice(0, 2).join('\n'));
    conferir('antiga', 'tudo antigo: manda tudo', dividir(ms.slice(0, 2), [d(45), d(45)]).antiga, '');
  }

  console.log(falhas ? `\n${falhas} FALHA(S) - nao publicar` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.log('FALHA nos testes de pedido:', e.message);
  process.exit(1);
});
