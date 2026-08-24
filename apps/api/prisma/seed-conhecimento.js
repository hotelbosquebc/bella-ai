/*
 * Seed do treinamento da Bella: base de conhecimento + respostas rápidas.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Em jul/2026 o Postgres free do Render (bella-db) expirou e foi deletado. O
 * seed.js recriava hotel/admin/políticas, mas os conhecimentos e os atalhos
 * tinham sido carregados via API e viviam SÓ no banco — então se perderam junto.
 * Este script versiona esse conteúdo no repositório para que uma perda de banco
 * nunca mais custe o treinamento da Bella.
 *
 * Idempotente: faz upsert por (hotel, título) e por (hotel, atalho). Pode rodar
 * a cada deploy sem duplicar nada.
 *
 * ⚠️ ITENS COM `revisar: true` entram DESATIVADOS (active: false).
 * O texto original desses tópicos se perdeu com o banco; só sobrou o rótulo no
 * ESTADO.md. A regra do dono é que a Bella não invente — então em vez de gravar
 * um conteúdo deduzido, o item fica inativo até alguém do hotel escrever o texto
 * real em /knowledge. Conhecimento inativo não é injetado no prompt.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const HOTEL_ID = process.env.DEFAULT_HOTEL_ID ?? 'hotel-do-bosque';

/* ------------------------------------------------------------------ *
 * Base de conhecimento
 * ------------------------------------------------------------------ */
const conhecimentos = [
  // --- Confirmados: conteúdo registrado no ESTADO.md, seguro para uso ---
  {
    title: 'Café da manhã',
    content:
      'O café da manhã está incluso na diária e é servido no restaurante do térreo, das 7h às 10h. É um BUFFET: frutas, pães, frios, bolos e opções vegetarianas. RESTRIÇÕES: para quem não consome lactose, as opções disponíveis são frutas e pães. Os pães contêm glúten — não há opção sem glúten, e é importante informar isso com clareza a quem perguntar, em vez de dizer apenas que "há opções". Nunca prometa preparo especial ou item fora do buffet.',
  },
  {
    title: 'Piscina',
    content:
      'O Hotel do Bosque NÃO possui piscina. Se o hóspede perguntar, responda de forma clara e educada — nunca sugira que há piscina nem prometa estrutura de lazer que o hotel não tem.',
  },
  {
    title: 'Estacionamento',
    content:
      'O estacionamento é GRATUITO. É rotativo (as vagas não são fixas) e cada apartamento tem direito a uma vaga, já inclusa na diária — sempre há ao menos uma vaga disponível. Sempre que perguntarem se é grátis ou pago, responda claramente que é gratuito e que a vaga está inclusa na diária. Veículo ADICIONAL (segundo carro do mesmo apartamento) tem custo extra, está sujeito à disponibilidade e precisa ser RESERVADO COM ANTECEDÊNCIA para garantir a vaga — não basta chegar com o carro. O valor é flutuante, então NÃO informe preço: oriente o hóspede a solicitar e confirmar com a recepção antes da viagem.\n' +
      'COBERTO? Há vagas cobertas e vagas descobertas. Como o estacionamento é rotativo, não dá para garantir qual delas o hóspede vai usar — varia conforme a ocupação do dia. Responda exatamente assim, sem prometer vaga coberta.',
  },
  {
    title: 'Ano Novo / Réveillon — pacote mínimo de 5 diárias',
    content:
      'QUANDO VALE: o pacote está ativo de 27/12 a 03/01 e alcança qualquer reserva que inclua a virada (31/12). A REGRA: é um pacote fechado de 5 diárias, e de 1 a 5 diárias o valor TOTAL é o mesmo. Acima de 5, as noites extras entram normalmente. COMO FALAR (importante): apresente como característica da temporada e como VANTAGEM, nunca como negativa. Quem pediria 2 ou 3 diárias leva 5 pelo mesmo valor — são dias extras sem custo adicional para aproveitar a cidade na melhor época. Nada de "infelizmente", "não é possível" ou "só aceitamos": diga com leveza que no Réveillon a estadia é um pacote de 5 diárias e que o total já contempla o período completo. ATENÇÃO — o site não explica isso: pesquisando menos de 5 diárias nesse período ele simplesmente não mostra disponibilidade, e o hóspede acha que estamos lotados. Por isso o link enviado já vai com as 5 diárias, para ele ver os valores. Se ele disser que "não aparece disponibilidade" nessas datas, verifique quantas noites pesquisou: quase sempre é isso — explique a regra e oriente a refazer com 5 diárias, sem dizer que estamos sem vagas. Como sempre, você NÃO informa valores: explica a regra e envia o link.',
  },
  {
    title: 'Tipos de veículo aceitos no estacionamento',
    content:
      'ACEITAMOS: carros, caminhonetes, SUVs e veículos similares — tudo que não seja maior que uma van pequena. Se perguntarem especificamente por caminhonete ou SUV, confirme que sim, sem rodeios.\n' +
      'VAN e MICRO-ÔNIBUS: NÃO garanta. Em alguns casos pode ser liberado, mas depende de verificação — encaminhe para o setor de reservas confirmar antes da viagem. Nunca diga que cabe nem que não cabe por conta própria.\n' +
      'ÔNIBUS: nunca é liberado, o hotel não tem espaço. Pode informar isso diretamente, com cordialidade — não encaminhe para a equipe, pois a resposta é sempre não.',
  },
  {
    title: 'Capacidade do apartamento',
    content:
      'Cada apartamento acomoda no máximo 6 pessoas. O valor da diária é calculado conforme a quantidade de pessoas no apartamento.',
  },
  {
    title: 'Localização e endereço',
    content:
      'Hotel do Bosque — Av. Brasil, 22, Balneário Camboriú/SC, CEP 88330-040.',
  },
  {
    title: 'Horário do setor de reservas',
    content:
      'O setor de reservas atende das 9h às 12h e das 14h30 às 17h30. Fora desse horário a solicitação é registrada e respondida no próximo horário de atendimento.',
  },
  {
    title: 'Formas e condições de pagamento',
    content:
      'Pagamento com 5% de desconto no pix. Parcelamento em até 10x, sendo até 3x sem juros, com valor MÍNIMO de parcela de R$ 200,00 (ou seja, o número de parcelas depende do valor total da reserva). IMPORTANTE para a Bella: no caminho que ela conduz, o hóspede reserva no próprio site e paga ali, no momento de concluir a reserva — é o pagamento que confirma. Sinal, entrada e prazos de pagamento valem para reservas feitas pela equipe e NÃO devem ser informados pela Bella.',
  },
  {
    title: 'Secador de cabelo e ferro de passar',
    content:
      'Os apartamentos dispõem de secador de cabelo. O ferro de passar pode ser solicitado na recepção.',
  },
  {
    title: 'Pets',
    content:
      'O hotel é pet-friendly e aceita pets de PEQUENO PORTE, até 12 kg, sem cobrança de diária do pet. O pet PODE ficar sozinho no apartamento, mas se incomodar os demais hóspedes o tutor deve retornar imediatamente. É PROIBIDO circular nas áreas comuns do hotel: ao passar por qualquer área interna, o pet deve estar no colo. Não tem acesso ao restaurante. Em caso de descumprimento das normas, dano ou necessidade de limpeza adicional, há cobrança de taxa — informe que existe, mas NÃO cite valor; quem informa valores é a equipe.',
  },
  {
    title: 'Atendimento em espanhol',
    content:
      'O hotel recebe muitos hóspedes do Uruguai e da Argentina. Se o hóspede escrever em espanhol, responda em espanhol, mantendo o mesmo tom acolhedor.',
  },
  {
    title: 'Negociação, descontos e casos especiais',
    content:
      'A Bella NÃO negocia preço, desconto, meia diária, cortesia ou condição especial, e não informa tarifas de cabeça. Nesses casos, e também para grupos, excursões e atletas, encaminhe para a equipe humana do setor de reservas. Grupos e atletas são atendidos presencialmente ou por um atendente.',
  },

  // --- Extraídos das conversas reais do WhatsApp (14/08/2026) ---
  // São respostas que a própria equipe deu a hóspedes; por isso entram ativas.
  {
    title: 'Camas e acomodação no apartamento',
    content:
      'Acomodamos até 6 pessoas no máximo por apartamento. Cada apartamento tem 1 cama de casal e 2 de solteiro; as demais pessoas ficam em colchão extra. Se o hóspede pedir camas separadas, informe essa composição.',
  },
  {
    title: 'Cozinha no apartamento',
    content:
      'Os apartamentos têm cozinha e o hóspede pode utilizá-la livremente durante a estadia.',
  },
  {
    title: 'Lavanderia',
    content:
      'O hotel NÃO tem lavanderia. Os apartamentos têm um pequeno tanque de lavar e, próximo ao hotel, há algumas opções de lavanderia.',
  },
  {
    title: 'Suíte Bosque (categoria)',
    content:
      'A Suíte Bosque fica no 7º e no 8º andar — são os andares MAIS ALTOS do hotel. Se o hóspede falar em "último andar", "andar de cima", "lá em cima" ou "vista melhor", é dela que ele está falando: confirme que a Suíte Bosque fica no 7º e 8º andar. É a única categoria com DOIS banheiros (social e o da suíte do casal) e com chuveiro de aquecimento a GÁS. Acomoda até 6 hóspedes, com Wi-Fi e ar-condicionado. O secador de cabelo é solicitado na recepção. Não prometa andar específico entre o 7º e o 8º, nem número de apartamento: isso é definido pela recepção conforme a ocupação.',
  },
  {
    title: 'Problemas do hóspede no site de reservas',
    content:
      'A senha do site é criada pelo próprio hóspede; se não lembrar, deve usar "esqueci a senha" para receber uma senha temporária por e-mail. Se ainda assim não conseguir concluir, a equipe de reservas resolve — encaminhe para ela. A Bella NÃO realiza reservas pelo WhatsApp e não deve oferecer esse caminho por conta própria.',
  },
  {
    title: 'Site e WhatsApp têm o mesmo preço',
    content:
      'O site de reservas é o mesmo canal usado no WhatsApp — os valores são os mesmos. O pagamento via pix no site libera 5% de desconto.',
  },
  {
    title: 'Escolinhas de futebol e grupos esportivos',
    content:
      'O hotel não recebe reservas de escola de futebol. Grupos, excursões e equipes esportivas não são atendidos pela Bella — encaminhe para a equipe de reservas.',
  },
  {
    title: 'Currículos e vagas de emprego',
    content:
      'Se alguém enviar currículo ou perguntar sobre vagas, responda com cordialidade que no momento não estamos contratando e que o contato fica registrado. Não é assunto de reservas.',
  },

  {
    title: 'Wi-Fi',
    content:
      'O Wi-Fi é gratuito e a SENHA é sempre "bosque00", em todo o hotel. O NOME DA REDE muda: cada roteador tem um nome diferente, e o hóspede deve se conectar ao mais próximo do apartamento onde estiver. Por isso não informe um nome de rede específico — diga que ele verá algumas redes do hotel, deve escolher a mais próxima e usar essa mesma senha.',
  },
  {
    title: 'Descontos autorizados',
    content:
      'O ÚNICO desconto que você pode informar é o de 5% para pagamento via pix no site do hotel. Qualquer outro desconto, condição especial ou percentual maior depende de autorização da gerência e você NÃO tem como concedê-lo nem prometê-lo. Se o hóspede pedir desconto além disso, não negue de forma seca nem invente um valor: diga com cordialidade que vai encaminhar para a equipe de reservas avaliar, e informe o horário de atendimento dela.',
  },

  // --- Informado pelo hotel em 14/08/2026 (material do site + cartão de boas-vindas) ---
  {
    title: 'Categorias de apartamentos',
    content:
      'São 4 categorias, do andar mais baixo para o mais alto: Standard (1º e 2º), Luxo (3º e 4º), Superior (5º e 6º) e Suíte Bosque (7º e 8º).\n' +
      'TODAS têm a mesma planta: sala de estar com sofá, TV LCD 32" a cabo (54 canais), telefone/interfone, mesa com cadeiras, sacada com vista, cozinha equipada (geladeira, fogão, pia e utensílios básicos, incluindo jogo de panelas e talheres), 2 dormitórios (um com cama de casal box queen size e outro com 2 camas de solteiro box), ar-condicionado frio de janela nos dois dormitórios, banheiro e pequena área de serviço com tanque.\n' +
      'DIFERENÇAS: a Suíte Bosque é a única com DOIS banheiros (social + suíte do casal) e chuveiro com aquecimento a GÁS. Standard, Luxo e Superior têm um banheiro e chuveiro ELÉTRICO. A Standard tem TV apenas na sala; Luxo e Superior têm TV também no quarto de casal.\n' +
      'LUXO x SUPERIOR — cuidado, é pergunta frequente: a planta é a mesma e a diferença NÃO é o andar. O Luxo fica MAIS BAIXO (3º e 4º) que o Superior (5º e 6º). O que distingue o Luxo é o MOBILIÁRIO: foi a última das duas a passar por reforma, então está mais atualizada. Nunca diga que o Luxo fica em andar mais alto, e não invente vista, metragem ou comodidade que não esteja listada aqui.',
  },
  {
    title: 'Limpeza dos apartamentos',
    content:
      'A limpeza é diária, das 8h às 15h. A louça é de responsabilidade do hóspede. A limpeza NÃO é realizada quando há pets ou hóspedes dentro do apartamento no momento.',
  },
  {
    title: 'Ingressos',
    content:
      'Todos os ingressos são vendidos diretamente na recepção do hotel. O hóspede compra com a equipe na própria recepção.',
  },
  {
    title: 'Menores de idade',
    content:
      'Menores devem estar sempre acompanhados dos pais. Quando viajam com outro responsável (avós, tios, terceiros), é obrigatória a autorização de viagem assinada, no modelo oficial do governo. Sem essa autorização o menor não pode se hospedar.',
  },
  {
    title: 'Distância da praia',
    content:
      'O hotel fica a aproximadamente 100 metros da praia — poucos minutos a pé.',
  },
  {
    title: 'Entorno e transporte',
    content:
      'O hotel fica no centro de Balneário Camboriú, com tudo por perto (mercado, farmácia, restaurantes). O ponto do ônibus gratuito da cidade fica em frente ao hotel.',
  },
  {
    title: 'Transfer do aeroporto',
    content:
      'O transfer é feito por uma agência parceira, pelo telefone +55 47 9634-2095. O hóspede fala diretamente com a agência.',
  },
  {
    title: 'Early check-in e late check-out',
    content:
      'Ambos estão sujeitos à disponibilidade. Quando há disponibilidade no momento, não há custo. Mas para GARANTIR a entrada antecipada ou a saída tardia, só reservando uma diária completa adicional. Nunca prometa antecipação ou saída tardia como certa: dependem da ocupação no dia.',
  },
  {
    title: 'Normas da casa',
    content:
      'Regras da casa, que a Bella pode informar quando perguntarem: é PROIBIDO FUMAR no apartamento, inclusive na sacada. Não emprestamos toalhas de praia e não é permitido levar as toalhas de banho para fora do hotel. A chave deve ser deixada na recepção ao sair, e o fechamento da conta é feito na entrega da chave, com conferência do apartamento. Pessoas não hospedadas não podem entrar sem aviso prévio à recepção. Pedimos silêncio, principalmente após as 22h. A voltagem do hotel é 220V, há bebidas à venda na recepção e o ramal da recepção funciona 24h: basta discar 9. O hotel não se responsabiliza por objetos ou dinheiro deixados dentro dos apartamentos. SOBRE MULTAS: ao explicar qualquer uma dessas regras, diga apenas que o descumprimento PODE ACARRETAR MULTA — NUNCA informe valores de multa, mesmo que o hóspede insista. Se ele quiser saber o valor, encaminhe para a equipe.',
  },
  {
    title: 'Política infantil no site de reservas',
    content:
      'A política infantil do site é a mesma do atendimento (0 a 6 anos cortesia, 7 a 9 anos meia, a partir de 10 anos tarifa de adulto) e o próprio site já aplica o cálculo quando o hóspede informa as idades. Basta o hóspede reservar normalmente pelo link.',
  },

  // --- Respostas do hotel ao questionário (19/08/2026) ---
  {
    title: 'Quem pode fazer o check-in',
    content:
      'No check-in o TITULAR da reserva precisa estar presente. Outra pessoa só pode realizar o check-in e retirar a chave se o titular tiver cadastrado o nome dela na reserva com antecedência. Se o hóspede perguntar se um amigo ou parente pode chegar antes e pegar a chave, explique essa regra e oriente a informar o nome à equipe de reservas antes da viagem.',
  },
  {
    title: 'Berço',
    content:
      'O hotel tem berço, sem custo. É necessário SOLICITAR COM ANTECEDÊNCIA para garantir a disponibilidade — não é certo que haverá um livre se o pedido for feito na chegada. Oriente o hóspede a pedir junto à equipe de reservas.',
  },
  {
    title: 'Guarda-volumes / bagagem',
    content:
      'O hotel guarda as bagagens sem custo. O hóspede pode deixar as malas antes do check-in e também depois do check-out, e aproveitar o dia na cidade.',
  },
  {
    title: 'Horário de chegada e atraso',
    content:
      'O check-in é a partir das 14h e o hóspede pode chegar em QUALQUER horário depois disso — a recepção funciona 24 horas. IMPORTANTE: se a chegada passar das 18h, ele precisa comunicar o atraso, senão a reserva pode ser caracterizada como no-show. Sempre que alguém avisar que chega tarde, à noite ou de madrugada, tranquilize e reforce esse aviso.',
  },
  {
    title: 'Elevadores e acessibilidade',
    content:
      'O hotel tem 2 elevadores. Sobre apartamento adaptado para cadeirante ou mobilidade reduzida: o hotel possui um, mas ele está ocupado por uma reserva de longo período, SEM previsão de liberação. Se perguntarem, informe com honestidade que no momento não temos apartamento adaptado disponível — não prometa nem crie expectativa, e ofereça encaminhar à equipe de reservas para avaliar alternativas.',
  },
  {
    title: 'Cancelamento: reserva direta x operadora/OTA',
    content:
      'A Bella PODE informar as regras de cancelamento, porque são fixas — mas ANTES precisa saber ONDE a reserva foi feita, e essa pergunta vem primeiro. RESERVA DIRETA com o hotel (site oficial, WhatsApp ou recepção): valem as nossas faixas de multa por antecedência, conforme a Política de Cancelamento. RESERVA POR OPERADORA OU OTA (Booking, Expedia, Decolar, CVC, Airbnb, agências, sites de terceiros): as nossas regras NÃO se aplicam — valem as condições que o próprio hóspede contratou com aquela empresa, e é com ela que o cancelamento deve ser solicitado. Nunca informe as nossas faixas a quem reservou por terceiros: isso cria expectativa errada e vira reclamação. Se ele não souber dizer por onde reservou, pergunte com cordialidade antes de responder. Cancelamentos e alterações em si NUNCA são autorizados por você: explique a regra e encaminhe à equipe.',
  },
  {
    title: 'Hóspede que já reservou: confirmação, alteração ou cancelamento',
    content:
      'Quando o hóspede JÁ TEM uma reserva e traz um problema ou dúvida sobre ela — não recebeu a confirmação por e-mail, quer confirmar se a reserva entrou, já pagou e quer saber se caiu, quer alterar datas, incluir alguém ou cancelar — você NÃO tem acesso ao sistema de reservas e NÃO consegue consultar, confirmar nem alterar nada. Mas não encaminhe de mãos vazias: PRIMEIRO peça, com cordialidade, o NOME COMPLETO de quem fez a reserva ou o NÚMERO DA RESERVA, explicando que é para a equipe localizar. Um dos dois basta, não exija os dois. Depois diga que vai repassar ao nosso atendimento especializado. Colher esse dado antes de transferir evita que a equipe tenha que pedir de novo e resolve muito mais rápido. Respeite o horário: se o setor de reservas estiver atendendo, diga que está encaminhando agora; se estiver fora do horário, informe quando reabre e ofereça a recepção 24h pelo telefone (47) 3367-0211, sem prometer retorno imediato. NUNCA diga que a reserva está confirmada, que o pagamento foi identificado ou que "está tudo certo" — você não tem como saber, e afirmar isso gera hóspede chegando sem reserva. Não prometa prazo de resposta nem envio de e-mail.',
  },
  {
    title: 'Andares das categorias',
    content:
      'MAPA COMPLETO DOS ANDARES (informe exatamente assim quando perguntarem sobre andar, altura ou vista): 1º e 2º andar = Apartamento Standard. 3º e 4º andar = Apartamento Luxo. 5º e 6º andar = Apartamento Superior. 7º e 8º andar = Suíte Bosque. ATENÇÃO - erro comum: o LUXO NÃO fica mais alto que o Superior; ele fica ABAIXO (3º-4º contra 5º-6º). Nunca deduza o andar pelo nome da categoria nem associe "mais caro" ou "melhor" a "mais alto" - a ordem dos andares não segue a ordem das categorias. "Último andar", "andar mais alto" ou "lá em cima" = Suíte Bosque. Nunca prometa um andar específico dentro da categoria nem um número de apartamento: a distribuição é da recepção, conforme a ocupação do dia.',
  },
];

/* ------------------------------------------------------------------ *
 * Respostas rápidas (atalhos "/" na Caixa de Entrada)
 * ------------------------------------------------------------------ */
const REVISAR_ATALHO =
  '[REVISAR] O texto original deste atalho se perdeu com o banco. Reescreva em /quick-replies antes de usar.';

// Os atalhos do painel foram DESATIVADOS a pedido do hotel (19/08/2026): a
// recepcao ja usa os atalhos nativos do WhatsApp, digitando "/". Manter dois
// conjuntos concorrentes so criaria divergencia de texto.
//
// A lista abaixo existe para APAGAR os que este seed criou. Nao removemos
// tudo: um atalho cadastrado a mao no painel deve sobreviver.
const ATALHOS_A_REMOVER = ['24', 'banco', 'bomdia', 'confirmacao', 'confirmar', 'endereco', 'financeiro', 'ingressos'];

const respostasRapidas = [
];

async function main() {
  const hotel = await prisma.hotel.findUnique({ where: { id: HOTEL_ID } });
  if (!hotel) {
    throw new Error(
      `Hotel "${HOTEL_ID}" não encontrado. Rode o seed.js antes deste script.`,
    );
  }

  let ativos = 0;
  let inativos = 0;

  for (const k of conhecimentos) {
    const active = !k.revisar;
    const content = k.revisar
      ? `[REVISAR — conteúdo original perdido na expiração do banco. Reescreva com a informação real do hotel e ative.]\n\n${k.content}`
      : k.content;

    const existing = await prisma.knowledgeDocument.findFirst({
      where: { hotelId: hotel.id, title: k.title },
    });

    if (existing) {
      // Não reativa nem sobrescreve um item que já foi revisado à mão no painel.
      if (existing.active && k.revisar) {
        continue;
      }
      await prisma.knowledgeDocument.update({
        where: { id: existing.id },
        data: { content, active },
      });
    } else {
      await prisma.knowledgeDocument.create({
        data: { hotelId: hotel.id, title: k.title, type: 'faq', content, active },
      });
    }

    if (active) ativos += 1;
    else inativos += 1;
  }

  // Remove os atalhos que este seed criou (o hotel usa os atalhos nativos do
  // WhatsApp). Idempotente: se ja foram apagados, deleteMany nao faz nada.
  const removidos = await prisma.quickReply.deleteMany({
    where: { hotelId: hotel.id, shortcut: { in: ATALHOS_A_REMOVER } },
  });

  for (const r of respostasRapidas) {
    const existing = await prisma.quickReply.findFirst({
      where: { hotelId: hotel.id, shortcut: r.shortcut },
    });
    if (existing) {
      await prisma.quickReply.update({
        where: { id: existing.id },
        data: { title: r.title, content: r.content },
      });
    } else {
      await prisma.quickReply.create({
        data: { hotelId: hotel.id, shortcut: r.shortcut, title: r.title, content: r.content },
      });
    }
  }

  console.log(
    `Treinamento da Bella: ${ativos} conhecimentos ativos, ${inativos} aguardando revisão. ` +
      `Atalhos do painel removidos: ${removidos.count} (a recepção usa os atalhos nativos do WhatsApp).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
