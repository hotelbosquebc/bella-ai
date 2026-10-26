/**
 * Quando a Bella NAO deve responder sozinha.
 *
 * Decisao do dono em 09/10/2026: a Bella responde automaticamente em todos os
 * canais, e tudo que ela puder resolver sozinha, resolve. Mas "tudo" nao e
 * "qualquer coisa" - ha assunto que, errado, custa dinheiro ou custa o
 * hospede. Nesses casos ela cala e passa para a recepcao.
 *
 * As regras ficam AQUI, em codigo, e nao em instrucao de prompt. O projeto ja
 * aprendeu essa licao varias vezes: texto pronto vence regra escrita longe, e
 * uma instrucao de prompt e exatamente uma regra escrita longe. O modelo pode
 * ignora-la; uma funcao nao.
 *
 * O GuardrailsService continua cuidando do anti-prejuizo (cancelamento,
 * reembolso, desconto, confianca baixa). Aqui ficam os casos que faltavam.
 */

/** O hospede esta PEDINDO uma pessoa. Nao se discute: passa. */
const PEDIU_HUMANO: RegExp[] = [
  /\b(falar|conversar)\s+com\s+(uma?\s+)?(pessoa|humano|atendente|gerente|recep[cç][aã]o|respons[aá]vel)\b/i,
  /\b(quero|queria|gostaria de)\s+(falar|conversar)\s+com\s+algu[eé]m\b/i,
  // "preciso de uma pessoa", "preciso falar com alguem" (bateria de 26/10/2026)
  /\bpreciso\s+(de\s+uma\s+pessoa|falar\s+com\s+algu[eé]m|de\s+um\s+atendente)\b/i,
  // Pergunta do dono (26/10/2026): "se o hospede pedir atendimento humano,
  // atendente ou algo similar". Formas que escapavam:
  // "falar com a recepcao", "falar com o setor de reservas"
  /\b(falar|conversar)\s+com\s+(a|o)\s+(recep[cç][aã]o|equipe|setor|gerente|gerência|respons[aá]vel|atendente|atendimento)/i,
  // "pode me passar para uma pessoa?", "encaminha pra um atendente"
  /\b(passa|passar|transfere|transferir|encaminha|encaminhar)\s+(para|pra|pro)\s+(um|uma|o|a)?\s*(atendente|humano|pessoa|gerente|recep|equipe|algu[eé]m)/i,
  // "quero atendimento humano", "atendente humano", "atendente por favor"
  /\batendimento\s+humano\b|\batendente\s+(humano|real|de\s+verdade|por\s+favor)\b|^\s*atendente\s*[?!.]*\s*$/im,
  // "pode me ligar?", "me liga" - ligacao e com uma pessoa
  /\b(me\s+liga|me\s+ligue|pode(ria)?\s+me\s+ligar|liga\s+pra\s+mim|me\s+chama\s+no\s+telefone)\b/i,
  // O "Victor, especialista em reservas" do roteiro da recepcao
  /\b(falar|conversar)\s+com\s+o\s+victor\b/i,
  /\b(me\s+)?(passa|transfere|transferir)\s+para\s+(um|uma)?\s*(atendente|humano|pessoa|gerente)\b/i,
  // Sem \b no fim: 'robô' termina em acento, e acento nao conta como letra
  // para a borda de palavra - "isso é um robô?" nao casava.
  /\b(isso|voc[êe])\s+[ée]\s+(um\s+)?(rob[oô]|bot\b|m[aá]quina)/i,
  /\bhablar con (una persona|un humano|alguien|un agente)\b/i,
  /\b(talk|speak) (to|with) (a )?(human|person|agent|someone)\b/i,
];

/** Reclamacao. Resposta automatica em cima de hospede irritado piora tudo. */
const RECLAMACAO: RegExp[] = [
  /\b(p[ée]ssimo|horr[ií]vel|inaceit[aá]vel|absurdo|vergonha|descaso)\b/i,
  /\b(reclama[cç][aã]o|reclamar|procon|processar|advogado|justi[cç]a)\b/i,
  /\b(nojento|sujo|imundo|barata|rato|mofo|infiltra[cç][aã]o)\b/i,
  /\b(fui\s+mal\s+atendid|me\s+trataram\s+mal|falta\s+de\s+respeito)/i,
  // "estou muito insatisfeito com o atendimento" (bateria de 26/10/2026)
  /\b(insatisfeit[oa]s?|decepcionad[oa]s?|indignad[oa]s?|lament[áa]vel)\b/i,
  /\b(quero\s+meu\s+dinheiro\s+de\s+volta)\b/i,
  /\b(terrible|awful|unacceptable|disgusting)\b/i,
  /\b(p[ée]simo|horrible|inaceptable|asqueroso)\b/i,
];

/**
 * Dinheiro escrito na resposta.
 *
 * A Bella NUNCA informa preco - regra da casa desde o inicio. Ela manda o
 * link, e o link mostra o valor. Se um numero em reais apareceu no texto, ela
 * inventou ou leu errado, e inventar preco e o erro mais caro que existe aqui.
 */
const DINHEIRO = /R\$\s*\d|\b\d+[.,]\d{2}\s*reais\b|\breais\s*\d/i;

/** Promessa que so uma pessoa pode cumprir. */
const PROMESSA_HUMANA: RegExp[] = [
  /\b(vou|irei)\s+(verificar|conferir|checar|confirmar)\s+(com|junto)/i,
  /\b(te\s+)?(retorno|retornarei|aviso|avisarei)\s+(em\s+breve|mais\s+tarde|assim\s+que)/i,
  /\b(j[áa]\s+)?(reservei|bloqueei|garanti|separei)\s+(o|a|seu|sua)\b/i,
  /\bvou\s+registrar\s+(a|o|sua|seu)\b/i,
];

/**
 * A propria Bella anunciou que vai passar para uma pessoa.
 *
 * So frases de ENTREGA feita ou anunciada. A oferta ("se preferir, basta
 * pedir que eu encaminho") nao entra: e convite, nao pedido de ajuda.
 */
const BELLA_PASSOU_ADIANTE: RegExp[] = [
  /\b(vou|irei)\s+(te\s+)?(encaminhar|transferir|repassar)\b/i,
  /\b(j[áa]\s+)?(encaminhei|transferi|repassei)\b/i,
  /\b(um|uma)\s+(atendente|pessoa\s+da\s+(nossa\s+)?equipe|especialista|colega)\s+(vai|ir[áa])\s+(te\s+|lhe\s+)?(responder|atender|ajudar|retornar|falar)/i,
  /\bnossa\s+equipe\s+(vai|ir[áa])\s+(te\s+|lhe\s+)?(responder|retornar|entrar\s+em\s+contato)/i,
  /\b(voy\s+a\s+(derivar|transferir)|un\s+agente\s+(le|te)\s+va\s+a\s+(responder|atender))/i,
];

/**
 * O hospede escreveu numa lingua que a Bella nao atende?
 *
 * Deliberadamente conservador: so acusa o que e INEQUIVOCO. Nao importamos a
 * deteccao de idioma do modulo de atendimento de proposito - ela vive no
 * assist, que depende deste modulo, e o import de volta fecharia um ciclo.
 *
 * Dois sinais, os dois sem ambiguidade:
 *  - alfabeto que nao e o nosso (chines, japones, coreano, arabe, hebraico,
 *    cirilico, tailandes, grego);
 *  - palavras curtas e frequentes de frances, alemao e italiano que NAO
 *    existem em portugues, espanhol ou ingles.
 *
 * Na duvida, devolve null e a Bella responde - errar escalando demais cansa a
 * recepcao e mata o proposito de ela atender sozinha.
 */
export function idiomaNaoAtendido(texto: string): string | null {
  const t = (texto || '').trim();
  if (t.length < 3) return null;

  const alfabetos: [RegExp, string][] = [
    [/[\u4e00-\u9fff]/, 'chinês'],
    [/[\u3040-\u30ff]/, 'japonês'],
    [/[\uac00-\ud7af]/, 'coreano'],
    [/[\u0600-\u06ff]/, 'árabe'],
    [/[\u0590-\u05ff]/, 'hebraico'],
    [/[\u0400-\u04ff]/, 'russo'],
    [/[\u0e00-\u0e7f]/, 'tailandês'],
    [/[\u0370-\u03ff]/, 'grego'],
  ];
  for (const [r, nome] of alfabetos) if (r.test(t)) return nome;

  const baixo = t.toLowerCase();
  const frances = /\b(bonjour|bonsoir|s'il vous pla[îi]t|merci|chambre|nuits?|je voudrais|avez-vous|combien)\b/;
  const alemao = /\b(guten tag|guten morgen|zimmer|n[äa]chte|danke|haben sie|ich m[öo]chte|wie viel)\b/;
  const italiano = /\b(buongiorno|buonasera|camera|notti|grazie|vorrei|avete|quanto costa)\b/;
  if (frances.test(baixo)) return 'francês';
  if (alemao.test(baixo)) return 'alemão';
  if (italiano.test(baixo)) return 'italiano';

  return null;
}

/**
 * O hospede PEDIU para falar com uma pessoa?
 *
 * Exportada sozinha porque os dois caminhos precisam dela: o automatico
 * (canais) para escalar, e o da extensao para entregar o contato ao inves de
 * seguir tentando resolver. Era so o caminho automatico que enxergava isso.
 */
export function hospedePediuAtendente(texto: string): boolean {
  return PEDIU_HUMANO.some((r) => r.test(texto || ''));
}

/**
 * O hospede travou no site: nao aparece disponibilidade, ou o link nao abre.
 *
 * Decisao do dono em 20/10/2026. Este e o contato mais quente que existe - ele
 * JA decidiu reservar e esbarrou num obstaculo. Hoje a Bella insiste no link,
 * que e a pior resposta possivel, e o hospede desiste em silencio.
 *
 * A Bella nao tem como conferir: do servidor o Cloudflare bloqueia a consulta
 * ao Silbeck (403 "Just a moment", confirmado em producao em 20/10/2026), e no
 * Reveillon o site realmente nao mostra nada com menos de 5 diarias. Entao ela
 * nao discute e nao adivinha: passa para quem pode abrir o sistema e olhar.
 */
const TRAVOU_NO_SITE: RegExp[] = [
  // "nao tem disponibilidade", "sem disponibilidade", "nao aparece nada"
  /\bn[ãa]o\s+(?:tem|h[áa]|aparece|mostra|consta|achei|encontrei|acho|encontro)\b[^.!?]{0,30}\b(?:disponibilidade|vaga|aparta|quarto|nada|op[çc][ãa]o|data)/i,
  /\bsem\s+disponibilidade\b/i,
  /\b(?:est[áa]|ficou|aparece como)\s+(?:indispon[íi]vel|esgotado|lotado)\b/i,
  // "o link nao abre", "nao consigo acessar", "deu erro no site"
  /\b(?:link|site|p[áa]gina)\b[^.!?]{0,25}\bn[ãa]o\s+(?:abre|abriu|funciona|funcionou|carrega|carregou|vai)\b/i,
  /\bn[ãa]o\s+(?:consigo|consegui|estou conseguindo|to conseguindo)\b[^.!?]{0,30}\b(?:acessar|abrir|entrar|reservar|ver|visualizar|fazer)\b/i,
  /\b(?:deu|dá|da)\s+erro\b/i,
  // Espanhol - hospede argentino e rotina aqui
  /\bno\s+(?:hay|aparece|muestra|tengo|puedo)\b[^.!?]{0,30}\b(?:disponibilidad|habitaci[óo]n|nada|acceder|abrir|entrar)/i,
];

export function hospedeTravouNoSite(texto: string): boolean {
  return TRAVOU_NO_SITE.some((r) => r.test(texto || ''));
}

/**
 * Nota fiscal: so uma pessoa responde.
 *
 * Regra do dono (21/10/2026): o hotel SEMPRE emite nota fiscal de
 * hospedagem, mas QUEM e o tomador - o hospede, a empresa dele ou o portal
 * onde a reserva foi feita - depende da reserva, e precisa ser analisado por
 * alguem antes de confirmar qualquer coisa. Caso que motivou: a Bella
 * inventou que a nota "se solicita na recepcao no momento do check-out".
 */
const NOTA_FISCAL = /\bnota\s+fiscal\b|\bnota\s+d[ae]\s+(?:hospedagem|estadia|reserva|di[áa]ria)|\bnotas\s+fiscais\b|\bnfs?-?e\b|\bnf\b|\bcupom\s+fiscal\b|\bfactura\b|\binvoice\b/i;

export function falaDeNotaFiscal(texto: string): boolean {
  return NOTA_FISCAL.test(texto || '');
}

/**
 * A unica coisa que a Bella pode afirmar sobre nota fiscal.
 *
 * Procedimento passado pelo dono em 21/10/2026: pessoa fisica ou empresa,
 * pedida na recepcao no check-out, com CPF ou CNPJ, razao social, endereco e
 * e-mail; entregue impressa ou por e-mail; reserva feita pelo site tambem tem
 * nota. O que NAO entra: em nome de quem sai - reserva de portal pode ter a
 * nota emitida para o portal, e isso uma pessoa confere.
 */
export function fraseOficialNotaFiscal(idioma: 'pt' | 'es' | 'en' = 'pt'): string {
  if (idioma === 'es') {
    return (
      'Sí, el hotel emite factura de hospedaje, para persona física o empresa. ' +
      'Se solicita en la recepción al hacer el check-out, informando el documento (CPF o CNPJ), razón social, dirección y e-mail, ' +
      'y puede entregarse impresa o por e-mail. Nuestro equipo va a confirmar los datos de su reserva para la emisión.'
    );
  }
  if (idioma === 'en') {
    return (
      'Yes, the hotel issues an invoice for the stay, for individuals or companies. ' +
      'It is requested at the front desk at check-out, with your tax ID, company name, address and e-mail, ' +
      'and can be printed or sent by e-mail. Our team will confirm your booking details for the issuance.'
    );
  }
  return (
    'Sim, o hotel emite nota fiscal de hospedagem, para pessoa física ou empresa. ' +
    'Ela é solicitada na recepção no momento do check-out, informando CPF ou CNPJ, razão social, endereço e e-mail, ' +
    'e pode ser entregue impressa ou enviada por e-mail. Nossa equipe vai confirmar os dados da sua reserva para a emissão.'
  );
}

/**
 * Troca tudo o que a resposta diz sobre nota fiscal pela frase oficial.
 *
 * Qualquer detalhe alem dela - para quem sai, quando, onde pedir, que dado
 * informar - e decisao de uma pessoa. Recorte por frase, como nas outras
 * guardas: o resto da resposta continua valendo.
 */
export function semNotaFiscalInventada(texto: string, idioma: 'pt' | 'es' | 'en' = 'pt'): string {
  const original = texto || '';
  if (!falaDeNotaFiscal(original)) return original;
  const oficial = fraseOficialNotaFiscal(idioma);
  let colocou = false;
  const linhas = original.split(/\r?\n/).map((linha) =>
    linha
      .split(/(?<=[.!?])\s+/)
      .map((f) => {
        if (!falaDeNotaFiscal(f)) return f;
        if (colocou) return '';
        colocou = true;
        return oficial;
      })
      .filter(Boolean)
      .join(' ')
      .trim(),
  );
  return linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface DadosDaDecisao {
  /** O que o hospede acabou de escrever. */
  falaDoHospede: string;
  /** O que a Bella pretende responder. */
  resposta: string;
  /** Respostas que a Bella ja mandou antes nesta conversa. */
  respostasAnteriores?: string[];
}

/**
 * Devolve o motivo para passar a conversa a um humano, ou null para seguir
 * respondendo sozinha.
 *
 * A ordem importa: o pedido explicito do hospede vem primeiro, porque nenhum
 * outro criterio deve passar por cima dele.
 */
export function motivoParaHumano(dados: DadosDaDecisao): string | null {
  const fala = dados.falaDoHospede || '';
  const resposta = dados.resposta || '';

  if (PEDIU_HUMANO.some((r) => r.test(fala))) {
    return 'o hóspede pediu para falar com uma pessoa';
  }

  if (RECLAMACAO.some((r) => r.test(fala))) {
    return 'o hóspede fez uma reclamação';
  }

  if (falaDeNotaFiscal(fala)) {
    return 'o hóspede perguntou sobre nota fiscal: verificar o tomador (hóspede, empresa ou portal) antes de confirmar';
  }

  if (hospedeTravouNoSite(fala)) {
    return 'o hóspede não conseguiu ver disponibilidade ou usar o link';
  }

  if (alteracaoDeReservaExistente(fala)) {
    return 'o hóspede quer alterar uma reserva já feita (ajuste no sistema e nos valores)';
  }

  const outraLingua = idiomaNaoAtendido(fala);
  if (outraLingua) {
    return `o hóspede escreveu em ${outraLingua}, idioma que a Bella não atende`;
  }

  if (!resposta.trim() || resposta.trim().length < 15) {
    return 'a resposta saiu vazia ou curta demais para ser enviada';
  }

  if (DINHEIRO.test(resposta)) {
    return 'a resposta trazia valor em dinheiro, e a Bella não informa preços';
  }

  if (PROMESSA_HUMANA.some((r) => r.test(resposta))) {
    return 'a resposta prometia algo que depende de uma pessoa';
  }

  // Ela mesma disse que vai passar para alguem: e o "nao sei" dela. Sem
  // marcar a conversa, a promessa ficava no ar - ninguem era avisado e o
  // hospede esperava uma pessoa que nunca vinha. Regra do dono (21/10/2026):
  // o que ela nao souber vai para a equipe, com alerta no painel.
  if (BELLA_PASSOU_ADIANTE.some((r) => r.test(resposta))) {
    return 'a Bella não soube responder e passou para a equipe';
  }

  // A mesma resposta de novo quer dizer que ela nao esta resolvendo. Repetir
  // pela terceira vez e so fazer o hospede desistir sozinho.
  const anteriores = dados.respostasAnteriores ?? [];
  if (anteriores.some((a) => praticamenteIgual(a, resposta))) {
    return 'a Bella já tinha respondido isso e não resolveu';
  }

  return null;
}

/** Dois textos dizem a mesma coisa? Comparacao por palavras, sem acento. */
export function praticamenteIgual(a: string, b: string): boolean {
  const palavras = (t: string) =>
    new Set(
      (t || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean),
    );
  const A = palavras(a);
  const B = palavras(b);
  if (!A.size || !B.size) return false;
  let comuns = 0;
  A.forEach((p) => {
    if (B.has(p)) comuns++;
  });
  return comuns / Math.max(A.size, B.size) >= 0.9;
}

/**
 * Hospede que JA reservou e quer mudar a reserva: so a equipe faz.
 *
 * Caso real (22/10/2026): "Fiz uma reserva ontem pelo site, codigo 032703" e
 * "gostaria de saber se e possivel incluir uma crianca de 10 anos na mesma
 * acomodacao". A Bella trataria como orcamento novo e pediria datas. Resposta
 * do dono: e possivel desde que o apartamento nao passe de 6 pessoas, e o
 * ajuste - no sistema e nos valores - e feito pela equipe de reservas.
 *
 * A reserva pode ter sido dita antes e o pedido de mudanca agora, por isso
 * sao dois textos: a conversa inteira do hospede e o que ele disse por ultimo.
 */
const RESERVA_EXISTENTE =
  /\b(?:fiz|fizemos|tenho|temos)\s+(?:uma\s+)?reserva\b|\bj[áa]\s+(?:fiz|fizemos|tenho|temos)\s+(?:uma\s+)?reserva\b|\breserv(?:ei|amos)\b|\b(?:minha|nossa|mi|nuestra)\s+reserva\b|\bc[óo]digo\s+(?:da\s+(?:minha\s+)?reserva|\d)|\breserva\s+(?:n[º°o.]|n[úu]mero|c[óo]digo|\d)|\blocalizador\b/i;

const PEDE_MUDANCA =
  /\b(?:inclu[íi]r|incluo|acrescentar|adicionar|colocar\s+mais|alterar|altera[çc][ãa]o|mudar|trocar|aumentar|diminuir|tirar|remover|estender|prorrogar|antecipar|adiar|levar\s+mais|agregar|cambiar|modificar)(?![a-zà-ÿ])|\bmais\s+(?:uma?|1|2)\s+(?:pessoa|crian[çc]a|adulto|h[óo]spede|di[áa]ria|noite)/i;

export function alteracaoDeReservaExistente(falasDoHospede: string, falaRecente?: string): boolean {
  const recente = falaRecente && falaRecente.trim() ? falaRecente : falasDoHospede;
  return RESERVA_EXISTENTE.test(falasDoHospede || '') && PEDE_MUDANCA.test(recente || '');
}

/**
 * Conversa que nao tem NADA de hotel: pessoal, fornecedor, outro assunto.
 *
 * Analise de 26/10/2026: a sugestao automatica disparava em toda conversa
 * aberta no WhatsApp Web, e a Bella "respondia" papo de financiamento de moto,
 * "vou trazer seu pote", compras - com coisas como "parece que voce mandou
 * mensagem para o numero errado". Na sugestao AUTOMATICA, conversa assim fica
 * sem sugestao; no clique, a Bella responde como sempre.
 *
 * Os sinais sao especificos de hotel de proposito ("valor" e "pessoas"
 * aparecem em qualquer conversa). Com menos de 3 falas do outro lado nao
 * decide: pode ser um hospede que so disse "bom dia".
 */
const SINAL_DE_HOTEL =
  /hotel|bosque|reserv|di[áa]rias?|hosped|h[óo]spede|apartamento|\bapto|su[íi]te|check-?\s?in|check-?\s?out|estadia|pernoite|or[çc]amento|disponibilidade|caf[ée] da manh|estacionamento|piscina|praia|wi-?fi|silbeck|\bbella\b|adultos?|crian[çc]as?|beb[êe]|r[ée]veillon|feriado|\b\d{1,2}\s*\/\s*\d{1,2}\b|habitaci|hospedaje|alojamiento|\broom\b|booking|ingresso|recep[çc][ãa]o|excurs|grupo de|cachorr|\bpets?\b|animais|animal|quartos?|aceitam|voc[êe]s t[êe]m|tem vaga/i;

export function conversaSemAssuntoDeHotel(conversa: string, falasDoOutroLado: string): boolean {
  const linhas = (falasDoOutroLado || '').split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 3) return false;
  // Sem os rotulos "Hospede:"/"Nos:" - "hospede" e sinal de hotel, e o rotulo
  // esta em toda linha de qualquer conversa.
  const semRotulos = (conversa || '').replace(/^[ \t]*(?:H[óo]spede|N[óo]s)[ \t]*(?:\(hoje\))?[ \t]*:/gim, '');
  return !SINAL_DE_HOTEL.test(semRotulos);
}

/**
 * A conversa ja passou do orcamento: a reserva esta em pagamento/confirmacao.
 * Le so as NOSSAS falas - sao os textos fixos que a recepcao manda nessa fase.
 */
const FASE_DE_RESERVA =
  /solicita[çc][ãa]o de reserva realizada|pagamento confirmado|reserva confirmada|reserva efetivada|voucher|comprovante|sinal de 50|encaminhad[oa] ao financeiro/i;

export function reservaEmAndamento(nossasFalas: string): boolean {
  return FASE_DE_RESERVA.test(nossasFalas || '');
}

/**
 * Curriculo e venda nao sao hospede: vao direto para uma pessoa, sem IA.
 *
 * Regra do dono (21/10/2026): quem manda curriculo ou oferece produto e
 * servico nao quer reservar nem tirar duvida sobre o hotel. A Bella gastava
 * extracao, resposta e varias idas e vindas com quem nunca ia reservar. Agora
 * sai UMA mensagem curta, pronta, e a conversa fica com a equipe.
 *
 * "Tem vaga?" sozinho e pergunta de QUARTO: so conta como emprego com a
 * palavra de trabalho junto. E quem fala de estadia (datas, pessoas) segue
 * como hospede, mesmo que diga "parceria" ou "fornecedor" no meio.
 */
const CURRICULO: RegExp[] = [
  /\bcurr[íi]culos?\b|\bcurriculum\b|\bcurr[íi]culo\s+vitae\b/i,
  /\bvagas?\s+(?:de|para|pra)\s+(?:emprego|trabalho|trabalhar|est[áa]gio|camareir[ao]|recepcionista|recep[çc][ãa]o|gar[çc]o[mn]|cozinh|copeir|auxiliar|servi[çc]os\s+gerais|manuten[çc][ãa]o|limpeza|jovem\s+aprendiz)/i,
  /\b(?:est[ãa]o|vcs\s+est[ãa]o|voc[êe]s\s+est[ãa]o)\s+contratando\b/i,
  /\b(?:procuro|procurando|preciso\s+de|busco|buscando)\s+(?:um\s+)?(?:emprego|trabalho|servi[çc]o)\b/i,
  /\b(?:quero|gostaria\s+de|queria)\s+trabalhar\s+(?:a[íi]|no\s+hotel|com\s+voc[êe]s|na\s+empresa|nesse\s+hotel|neste\s+hotel)/i,
  /\boportunidades?\s+de\s+(?:emprego|trabalho)\b/i,
];

const VENDAS: RegExp[] = [
  /\b(?:gostaria|queria|quero)\s+de\s+apresentar\b|\bgostaria\s+de\s+apresentar\b/i,
  /\b(?:sou|somos)\s+(?:representantes?|consultor(?:a|es)?|vendedor(?:a|es)?)\b/i,
  /\brepresento\s+(?:a|uma)\s+(?:empresa|marca)\b/i,
  /\bproposta\s+comercial\b|\bparceria\s+comercial\b/i,
  /\b(?:nossos?|nossas?)\s+(?:produtos?|servi[çc]os|solu[çc][õo]es|cat[áa]logo)\b/i,
  /\b(?:sou|somos)\s+(?:fornecedor(?:es)?|distribuidor(?:a|es)?)\b/i,
  /\b(?:tr[áa]fego\s+pago|marketing\s+digital|gest[ãa]o\s+de\s+redes|google\s+meu\s+neg[óo]cio)\b/i,
  /\b(?:aumentar|alavancar|dobrar)\s+(?:as\s+|suas\s+|a\s+sua\s+|o\s+seu\s+)?(?:vendas|reservas|faturamento|ocupa[çc][ãa]o)\b/i,
];

const FALA_DE_ESTADIA =
  /\b\d{1,2}\s*(?:\/|de\s+)\s*(?:\d{1,2}|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)|\b\d{1,2}\s*(?:adultos?|pessoas?|h[óo]spedes?|crian[çc]as?)\b|\b(?:check-?in|check-?out|di[áa]rias?|hospedagem|hospedar|reservar|reserva\s+para)\b/i;

export function assuntoForaDoAtendimento(texto: string): 'curriculo' | 'vendas' | null {
  const t = texto || '';
  if (FALA_DE_ESTADIA.test(t)) return null;
  if (CURRICULO.some((r) => r.test(t))) return 'curriculo';
  if (VENDAS.some((r) => r.test(t))) return 'vendas';
  return null;
}
