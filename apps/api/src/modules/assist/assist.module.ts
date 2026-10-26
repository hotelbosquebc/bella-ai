import { Body, Controller, Get, Module, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { createHash } from 'crypto';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { BellaModule } from '../bella/bella.module';
import { ModelRouterService } from '../bella/model-router.service';
import { BellaOrchestratorService } from '../bella/bella-orchestrator.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PoliciesModule } from '../policies/policies.module';
import { PoliciesService } from '../policies/policies.service';
import { DEFAULT_GREETING, DEFAULT_GREETING_EN, DEFAULT_GREETING_ES, MASTER_PROMPT, STAY_EXTRACTION_TOOL } from '../bella/prompts';
import { contextoDeHorario, isWithinBusinessHours, HORARIO_RESERVAS_TEXTO } from '../bella/business-hours';
import { normalizar } from '../attachments/attachments.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { ReservationEngineService } from '../reservations/reservation-engine.service';
import { SilbeckAvailabilityService } from '../reservations/silbeck-availability.service';

import { corrigirLinks, garantirLink } from '../../common/links';
import { semPromessaDeRegistro } from '../../common/registro';
import { semCustoDeHorarioExtra } from '../../common/horario-extra';
import { semRaciocinioVazado, semAssuntoNaoPerguntado } from '../../common/resposta-limpa';
import { semGarantiaDeVaga } from '../../common/disponibilidade';
import { fraseTemPreco, semPrecoInventado } from '../../common/preco';
// Mudaram para common/ para o orquestrador dos canais usar a mesma trava.
export { fraseTemPreco, semPrecoInventado };
import { motivoParaHumano, falaDeNotaFiscal, fraseOficialNotaFiscal, semNotaFiscalInventada } from '../bella/escalonamento';
import { blocoDeContato, mensagemForaDoAtendimento } from '../../common/contato';
import { ehMensagemAutomatica, chaveDeModelo, modelosRepetidos } from '../../common/mensagem-automatica';
import { hospedePediuAtendente, hospedeTravouNoSite, assuntoForaDoAtendimento, alteracaoDeReservaExistente, reservaEmAndamento, conversaSemAssuntoDeHotel } from '../bella/escalonamento';
// Reexportado para nao quebrar quem ja importava daqui (e os testes).
export { corrigirLinks, garantirLink };

/**
 * Deixa a mensagem apresentável no WhatsApp. O prompt já pede isso, mas o
 * modelo às vezes cola o link no texto ("reservas:https://...") — e aí o
 * WhatsApp quebra o endereço e o hóspede recebe um link morto. Aqui a regra
 * é aplicada de forma determinística, sem depender da obediência do modelo.
 */
export function formatarParaWhatsApp(texto: string): string {
  return (texto || '')
    // markdown não renderiza no WhatsApp: **negrito** apareceria com asteriscos
    .replace(/\*\*(.+?)\*\*/g, '$1')
    // todo link isolado em sua própria linha
    .replace(/[ \t]*(https?:\/\/\S+?)([.,;:]?)(?=\s|$)/g, '\n\n$1\n\n')
    // no máximo uma linha em branco entre blocos
    .replace(/\n{3,}/g, '\n\n')
    // espaços sobrando nas pontas de cada linha (o texto após o link vinha com
    // um espaço à esquerda, herdado de onde a URL foi recortada)
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .trim();
}



/**
 * So o que o HOSPEDE escreveu.
 *
 * Segue o autor: uma linha sem prefixo pertence a quem falou antes, porque no
 * WhatsApp so a PRIMEIRA linha de um balao leva o prefixo. Sem isso, "4
 * adultos" na segunda linha some - e as travas concluem que o hospede nao
 * informou algo que estava escrito.
 */
export function apenasFalasDoHospede(conversation: string): string {
  const saida: string[] = [];
  let doHospede = false;
  for (const linha of (conversation || '').split(/\r?\n/)) {
    if (/^\s*H[óo]spede\s*(\(hoje\))?\s*:/i.test(linha)) doHospede = true;
    else if (/^\s*N[óo]s\s*(\(hoje\))?\s*:/i.test(linha)) doHospede = false;
    if (doHospede) saida.push(linha);
  }
  return saida.join('\n');
}

/** So as falas do hospede marcadas como de HOJE ("Hóspede (hoje): ..."), com as linhas de continuacao. */
export function apenasFalasDoHospedeDeHoje(conversation: string): string {
  const saida: string[] = [];
  let pega = false;
  for (const linha of (conversation || '').split(/\r?\n/)) {
    if (/^\s*H[óo]spede\s*\(hoje\)\s*:/i.test(linha)) pega = true;
    else if (/^\s*(H[óo]spede|N[óo]s)\s*(\(hoje\))?\s*:/i.test(linha)) pega = false;
    if (pega) saida.push(linha);
  }
  return saida.join('\n');
}

/**
 * Os assuntos que a Bella responde, e com que frequencia.
 *
 * Nao guardamos "qual resposta ela usou" - cada sugestao e escrita na hora, nao
 * escolhida de uma lista. O que da para medir e o ASSUNTO: reconhecemos o tema
 * pelo vocabulario da propria sugestao. Uma mensagem pode tocar dois assuntos
 * (cafe e estacionamento na mesma resposta) e conta nos dois: a pergunta e o
 * que ela mais fala, nao uma classificacao exclusiva.
 */
export const TEMAS: { tema: string; padrao: RegExp }[] = [
  { tema: 'Orçamento com link', padrao: /sbreserva|link (abaixo|para reserva)|realizar a reserva|finalizar a reserva/i },
  { tema: 'Disponibilidade', padrao: /disponibilidade|dispon[íi]vel|esgotad|sem vaga|lotad/i },
  { tema: 'Café da manhã', padrao: /caf[ée] da manh[ãa]|buffet|desjejum/i },
  { tema: 'Estacionamento', padrao: /estacionamento|vaga|garagem|carro/i },
  { tema: 'Categorias e andares', padrao: /standard|luxo|superior|su[íi]te bosque|andar/i },
  { tema: 'Check-in e check-out', padrao: /check ?-? ?in|check ?-? ?out|hor[áa]rio de entrada|14h|12h/i },
  { tema: 'Crianças e berço', padrao: /crian[çc]a|ber[çc]o|menor de idade|pol[íi]tica infantil/i },
  { tema: 'Pets', padrao: /\bpet\b|animal de estima[çc][ãa]o|cachorro|c[ãa]o\b|12 ?kg/i },
  { tema: 'Pacote de Ano Novo', padrao: /ano novo|r[ée]veillon|virada|5 di[áa]rias/i },
  { tema: 'Pagamento e desconto', padrao: /\bpix\b|parcel|cart[ãa]o|desconto|forma de pagamento/i },
  { tema: 'Cancelamento e multa', padrao: /cancelamento|cancelar|multa|no ?-? ?show/i },
  { tema: 'Wi-Fi', padrao: /wi ?-? ?fi|internet|senha da rede|bosque00/i },
  { tema: 'Localização e praia', padrao: /praia|centro|localiza|pertinho|quadra|[ôo]nibus gratuito/i },
  { tema: 'Transfer e aeroporto', padrao: /transfer|aeroporto|navegantes|traslado/i },
  { tema: 'Estrutura do hotel', padrao: /elevador|guarda ?-? ?volumes|academia|piscina|recep[çc][ãa]o 24/i },
  { tema: 'Ingressos e passeios', padrao: /ingresso|beto carrero|unipraias|passeio|parque/i },
  { tema: 'Grupos (passa p/ humano)', padrao: /grupo|atendente|nossa equipe vai|encaminh/i },
  { tema: 'Apresentação', padrao: /sou a bella|assistente (online|virtual)/i },
];

/** Em que assuntos esta sugestao toca. */
export function temasDaSugestao(texto: string): string[] {
  const t = texto || '';
  return TEMAS.filter((x) => x.padrao.test(t)).map((x) => x.tema);
}

/**
 * Texto reduzido ao que importa para comparar duas mensagens.
 *
 * Tira acento, pontuacao e caixa. Numeros viram "0": duas mensagens iguais que
 * so mudam a data ou a quantidade ("para 2 adultos" x "para 4 adultos") sao a
 * MESMA resposta para efeito de atalho.
 */
export function chaveDeTexto(t: string): string {
  return (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\d+/g, '0')
    .replace(/[^a-z0\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quanto duas mensagens se parecem, de 0 a 1 (Jaccard sobre palavras). */
export function parecenca(a: string, b: string): number {
  const A = new Set(chaveDeTexto(a).split(' ').filter(Boolean));
  const B = new Set(chaveDeTexto(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let comuns = 0;
  A.forEach((p) => { if (B.has(p)) comuns++; });
  return comuns / (A.size + B.size - comuns);
}

/**
 * Uma mensagem serve de atalho?
 *
 * Atalho e texto que se repete IGUAL para hospedes diferentes. Fica de fora:
 *
 * - o que leva link do motor: cada orcamento tem datas e ocupacao proprias;
 * - o que tem valor em dinheiro: por regra da casa a Bella nao fala preco, e um
 *   preco congelado num atalho envelhece e vira informacao errada;
 * - o curto demais ("ok", "obrigada"), que ninguem precisa de botao para
 *   escrever, e o longo demais, que quase nunca se repete inteiro.
 */
export function serveDeAtalho(texto: string): boolean {
  const t = (texto || '').trim();
  if (t.length < 60 || t.length > 1200) return false;
  if (/sbreserva|silbeck/i.test(t)) return false;
  if (/R\$|\breais\b|\bvalor de\b|\bdi[áa]ria de\b/i.test(t)) return false;
  return true;
}

/**
 * A partir de quanto duas mensagens sao "a mesma resposta".
 *
 * Medido, nao chutado. Em pares reais de resposta reescrita a parecenca ficou
 * entre 0,38 e 0,64; entre respostas de assuntos diferentes, entre 0,03 e 0,18.
 * A folga entre 0,18 e 0,38 e larga, e 0,32 fica com margem dos dois lados:
 * junta o mesmo assunto dito com outras palavras sem colar cafe com check-in.
 */
export const SEMELHANTE = 0.32;

/**
 * Junta mensagens parecidas em grupos.
 *
 * Guloso e proposital: percorre da mais frequente para a menos e encaixa cada
 * texto no primeiro grupo parecido o bastante. Nao busca o agrupamento otimo -
 * busca uma lista curta de candidatos que uma pessoa vai revisar antes de
 * virar botao.
 */
export function agrupar(textos: string[], limiar = SEMELHANTE): { texto: string; vezes: number }[] {
  const grupos: { textos: string[] }[] = [];
  for (const t of textos) {
    const g = grupos.find((x) => parecenca(x.textos[0], t) >= limiar);
    if (g) g.textos.push(t);
    else grupos.push({ textos: [t] });
  }
  return grupos
    .map((g) => ({
      // representante: o mais parecido com todos os outros do grupo, e nao o
      // primeiro que apareceu - assim o botao recebe a versao mais tipica.
      texto: g.textos
        .map((t) => ({ t, nota: g.textos.reduce((s, o) => s + parecenca(t, o), 0) }))
        .sort((a, b) => b.nota - a.nota)[0].t,
      vezes: g.textos.length,
    }))
    .sort((a, b) => b.vezes - a.vezes);
}

/** Apelido curto e livre para o atalho (o que a pessoa digita depois da barra). */
export function sugerirApelido(tema: string | undefined, usados: string[]): string {
  const base = (tema || 'resposta')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 2)
    .join('-');
  if (!usados.includes(base)) return base;
  for (let i = 2; i < 50; i++) if (!usados.includes(base + i)) return base + i;
  return base + Date.now();
}

/**
 * A licao pode virar regra no prompt?
 *
 * O aprendizado automatico e util e perigoso pela mesma razao: ele generaliza.
 * Uma correcao pontual do atendente ("dessa vez cobramos X") viraria regra
 * permanente. Estas travas existem porque sao regras da casa, e nao preferencia
 * de redacao - por isso ficam no codigo, antes da aprovacao humana, e nao como
 * pedido no prompt:
 *
 * - dinheiro: a Bella nao fala preco, e preco congelado envelhece e vira erro;
 * - reserva: ela nunca fecha reserva, so manda o link do site;
 * - tamanho: regra que nao cabe em duas linhas nao e regra, e um texto pronto.
 */
export function licaoAceitavel(texto: string): { ok: boolean; motivo?: string } {
  const t = (texto || '').trim();
  if (t.length < 15) return { ok: false, motivo: 'curta demais' };
  if (t.length > 240) return { ok: false, motivo: 'longa demais' };
  if (/R\$|\breais\b|\bpre[çc]o de\b|\bvalor de\b|\bcusta\b|\bdi[áa]ria de\b/i.test(t)) {
    return { ok: false, motivo: 'fala de valores' };
  }
  if (/\b(fazer|efetuar|realizar|confirmar|fechar)\s+(a\s+)?reservas?\b/i.test(t)) {
    return { ok: false, motivo: 'sugere fechar reserva' };
  }
  return { ok: true };
}

/**
 * A ultima fala do hospede, inteira.
 *
 * Nao e "a ultima linha": uma mensagem de varias linhas so leva o prefixo na
 * primeira, entao pegar a ultima linha perderia metade da pergunta. Pega o
 * ultimo bloco contiguo de falas dele.
 */
export function ultimaFalaDoHospede(conversation: string): string {
  const linhas = (conversation || '').split(/\r?\n/);
  const bloco: string[] = [];
  let dentro = false;
  for (let i = linhas.length - 1; i >= 0; i--) {
    const l = linhas[i];
    const inicioNosso = /^\s*N[óo]s\s*(\(hoje\))?\s*:/i.test(l);
    const inicioHospede = /^\s*H[óo]spede\s*(\(hoje\))?\s*:/i.test(l);
    if (dentro) {
      // ja achamos o fim do bloco; subimos ate encontrar onde ele comeca
      bloco.unshift(l);
      if (inicioHospede) break;
      if (inicioNosso) { bloco.shift(); break; }
      continue;
    }
    if (inicioHospede) { bloco.unshift(l); dentro = true; break; }
    if (l.trim() && !inicioNosso) { bloco.unshift(l); dentro = true; }
    else if (inicioNosso) return '';
  }
  return bloco
    .join('\n')
    .replace(/^\s*H[óo]spede\s*(\(hoje\))?\s*:\s*/i, '')
    .trim();
}

/**
 * TUDO que o hospede falou desde a nossa ultima resposta.
 *
 * Caso real (15/10/2026): a hospede mandou tres mensagens seguidas - "o
 * pagamento a gente faz no ato?", "caso de cancelamento tem taxa? como
 * funciona a reserva" e "tem cafe da manha?". A instrucao mandava responder "a
 * ULTIMA mensagem", entao so o cafe entrou no pedido. A pergunta do
 * cancelamento ficou sem resposta e o atendente teve de mandar a politica a
 * mao.
 *
 * No WhatsApp as pessoas escrevem assim: varias mensagens curtas em vez de um
 * paragrafo. Olhar so a ultima e perder metade do que foi perguntado.
 */
export function falasPendentesDoHospede(conversation: string): string[] {
  const linhas = (conversation || '').split(/\r?\n/);
  const pendentes: string[] = [];
  for (const linha of linhas) {
    const nossa = linha.match(/^\s*N[óo]s\s*(?:\(hoje\))?\s*:\s*(.*)$/i);
    if (nossa) {
      // A saudacao automatica do WhatsApp NAO e resposta.
      //
      // Caso real (20/10/2026): o hospede pergunta, o WhatsApp dispara sozinho
      // o "Olá, seja bem-vindo(a)! ... clique no link abaixo", e a pergunta
      // dele saia da lista de pendencias como se tivesse sido respondida. Ela
      // aparece em quase toda conversa nova, entao a primeira pergunta do
      // hospede era justamente a que mais se perdia.
      if (ehMensagemAutomatica(nossa[1] || '')) continue;
      // Respondemos de verdade: o que veio antes ja foi tratado.
      pendentes.length = 0;
      continue;
    }
    const m = linha.match(/^\s*H[óo]spede\s*(?:\(hoje\))?\s*:\s*(.+)$/i);
    if (m && m[1].trim()) pendentes.push(m[1].trim());
  }
  return pendentes;
}

/**
 * Onde a resposta deve mirar.
 *
 * Caso real (08/09/2026): depois de varias perguntas ja respondidas, o hospede
 * perguntou "Que horas pode entra e que teria que sair" - check-in e check-out,
 * duas coisas numa frase so. O modelo tem a conversa inteira na frente e se
 * dispersa nela; aqui a ultima fala e destacada e a mira fica explicita.
 *
 * As duas metades importam na mesma medida. So "responda a ultima" faria ela
 * responder metade de uma mensagem com duas perguntas - reclamacao real deste
 * mesmo mes. So "responda tudo" faz ela repetir o que ja foi respondido.
 */
export function contextoDaPergunta(conversation: string): string {
  const pendentes = falasPendentesDoHospede(conversation);
  if (!pendentes.length) {
    const ultima = ultimaFalaDoHospede(conversation);
    if (!ultima) return '';
    return (
      `\n\nRESPONDA AGORA A ESTA MENSAGEM DO HÓSPEDE:\n"${ultima.slice(0, 600)}"\n` +
      `Responda TUDO o que está nela — se traz duas perguntas, responda as duas. ` +
      `E só isso: o que já foi respondido antes na conversa não se repete.`
    );
  }

  if (pendentes.length === 1) {
    return (
      `\n\nRESPONDA AGORA A ESTA MENSAGEM DO HÓSPEDE:\n"${pendentes[0].slice(0, 600)}"\n` +
      `Responda TUDO o que está nela — se traz duas perguntas, responda as duas. ` +
      `E só isso: o que já foi respondido antes na conversa não se repete.`
    );
  }

  // Varias mensagens seguidas sem resposta nossa: listar TODAS, numeradas.
  // Numerada, nenhuma se perde no meio do paragrafo - foi exatamente assim que
  // a pergunta do cancelamento ficou sem resposta em 15/10/2026.
  const lista = pendentes.map((p, i) => `${i + 1}. "${p.slice(0, 300)}"`).join('\n');
  return (
    `\n\nO HÓSPEDE MANDOU ${pendentes.length} MENSAGENS SEGUIDAS e nenhuma foi respondida ainda:\n${lista}\n` +
    `Responda TODAS, uma por uma, sem pular nenhuma — inclusive as do meio, que são as que mais se perdem. ` +
    `Se não souber alguma, diga que vai encaminhar aquele ponto à equipe, em vez de ignorá-lo. ` +
    `Não repita o que já foi respondido antes na conversa.`
  );
}

/**
 * O hospede fez uma PERGUNTA sobre como as coisas funcionam - nao pediu
 * orcamento.
 *
 * Caso real (15/10/2026): "Vamos chegar por volta das 23:30. Seria uma estadia
 * ate no outro dia as 23:30?" A palavra "estadia" fazia isso parecer pedido de
 * orcamento; sem datas nem ocupacao, a Bella responderia PEDINDO periodo e
 * quantidade de pessoas - quando o hospede queria saber como funciona a
 * diaria. Foi o atendente que teve de explicar na mao.
 *
 * Tres condicoes juntas, porque qualquer uma sozinha erraria:
 *
 *  1. e pergunta (tem "?" ou comeca com palavra interrogativa);
 *  2. NAO ha data nem quantidade de pessoas na fala - quem diz "10 a 15/11
 *     para 2 pessoas, quanto fica?" esta pedindo orcamento, com interrogacao
 *     e tudo;
 *  3. o assunto e uma REGRA da casa (horario, diaria, check-in, pet, cafe...),
 *     que e o que a base de conhecimento sabe responder.
 */
export function duvidaSobreRegra(falaDoHospede: string, temDados: boolean): boolean {
  const t = semPrefixos(falaDoHospede || '').toLowerCase();
  if (!t.trim() || temDados) return false;

  const ehPergunta = /\?/.test(t) || /^\s*(qual|quais|como|quando|onde|quanto tempo|posso|pode|tem|voc[êe]s t[êe]m|at[ée] que horas|a partir de que horas)\b/i.test(t);
  if (!ehPergunta) return false;

  // Perguntou PREÇO? Entao e orcamento, por mais que fale de regra. "Quanto
  // custa a estadia?" precisa continuar pedindo periodo e pessoas - se virasse
  // duvida, a Bella responderia sobre a diaria e nunca mandaria o link.
  if (/\b(quanto custa|quanto fica|quanto sai|qual o valor|valores|pre[çc]o|or[çc]amento|cota[çc][aã]o|tarifa)/i.test(t)) return false;


  // Cada palavra traz a propria terminacao, inclusive o plural.
  //
  // Duas armadilhas aprendidas aqui: a borda final e (?![a-zà-ÿ]) e nao \b,
  // porque "café" termina em acento e acento nao conta como letra para o \b do
  // JavaScript; e os radicais precisam prever o plural, senao "berço" casa
  // "berç" e o "o" seguinte derruba a borda. Sem borda nenhuma, "pet" casaria
  // dentro de "petisco".
  const assuntoDeRegra =
    /\b(di[áa]rias?|estadias?|pernoites?|check-?ins?|check-?outs?|hor[áa]rios?|que horas|entradas?|sa[íi]das?|chegar|chegadas?|limpezas?|arruma[çc][aã]o|caf[ée]|wi-?fi|estacionamentos?|pets?|anima(?:l|is)|piscinas?|ber[çc]os?|crian[çc]as?|bagagens?|malas?|elevador(?:es)?|lavanderias?|cozinhas?|ferro|secador(?:es)?|cancelamentos?|pagamentos?|pix)(?![a-zà-ÿ])/i;
  return assuntoDeRegra.test(t);
}

/**
 * Vale a pena gastar uma chamada de IA extraindo dados de estadia?
 *
 * Cada sugestao custava DUAS chamadas ao Gemini: uma para extrair datas e
 * ocupacao, outra para escrever. No plano gratuito isso estourou a cota no meio
 * da tarde (429 registrado em 08/09/2026 as 17:02) e a Bella passou a devolver
 * o texto de emergencia - que, de fora, parecia burrice dela.
 *
 * Metade dessas chamadas nao precisava existir: "aceita pet?", "que horas posso
 * entrar?", "onde fica o hotel?" nao tem data nem quantidade para extrair. Se o
 * hospede nao escreveu NADA que pareca estadia, pulamos a extracao.
 *
 * O teste e de proposito frouxo - qualquer numero solto ja passa. Errar para o
 * lado de gastar a chamada e barato; errar para o outro lado seria deixar de
 * montar um orcamento que o hospede pediu.
 */
export function pareceOrcamento(falasDoHospede: string): boolean {
  const t = falasDoHospede || '';
  return (
    /\d/.test(t) ||
    /\b(hoje|amanh[ãa]|fim de semana|final de semana|feriado|natal|ano novo|r[ée]veillon|carnaval|p[áa]scoa)\b/i.test(t) ||
    /\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)\b/i.test(t) ||
    /\b(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i.test(t) ||
    /\b(casal|fam[íi]lia|adultos?|crian[çc]as?|pessoas?|hospedes?|quartos?|apartamentos?|di[áa]rias?)\b/i.test(t) ||
    /\b(valor|pre[çc]o|or[çc]amento|disponibilidade|dispon[íi]vel|reserva|hospedagem|estadia)\b/i.test(t) ||
    // hospede estrangeiro tambem pede orcamento, e nao usa nenhuma palavra acima
    /\b(disponible|disponibilidad|fechas|personas|noches|habitaci[oó]n|habitaciones|precio|presupuesto)\b/i.test(t) ||
    /\b(available|availability|nights|rooms?|price|dates|guests?)\b/i.test(t)
  );
}


/**
 * A conversa veio com autoria (quem falou cada linha)?
 *
 * O leitor da extensao tem um caminho de emergencia: quando nao consegue casar
 * os baloes, manda o texto cru da tela - sem os prefixos "Hospede:" e "Nos:".
 * E util (melhor contexto imperfeito do que resposta nenhuma), mas TODAS as
 * travas deterministas leem esses prefixos: idioma, foco na ultima pergunta,
 * data, ocupacao e a triagem de orcamento.
 *
 * Sem autoria, apenasFalasDoHospede devolve vazio e cada trava conclui, em
 * silencio, que o hospede nao disse nada - que e exatamente a conclusao errada.
 * Registrado no diagnostico em 09/09/2026 como "sem assunto de estadia" em
 * conversas nas quais o hospede tinha escrito periodo e quantidade.
 */
export function temAutoria(conversation: string): boolean {
  return /^\s*(H[óo]spede|N[óo]s)\s*(\(hoje\))?\s*:/im.test(conversation || '');
}

/**
 * Os dias extraidos aparecem MESMO no que o hospede escreveu?
 *
 * A trava anterior perguntava "o hospede citou alguma data?" - fraca demais.
 * Caso real (09/09/2026): ele escreveu "Final novembro" e "6 dias", e o extrator
 * devolveu 01/12 a 07/12. A Bella entao respondeu "para 6 pessoas em dezembro" e
 * consultou disponibilidade num periodo que ninguem pediu. Periodo VAGO virou
 * periodo exato, com a confianca de quem foi informado.
 *
 * Agora exigimos corroboracao: o dia da entrada e o da saida precisam aparecer
 * como numero na fala do hospede. "22/11 a 27/11" corrobora 2026-11-22; "final
 * novembro" nao corrobora dia nenhum.
 *
 * A excecao sao as expressoes relativas que apontam um periodo unico e
 * resolvivel - "amanha", "fim de semana", "natal", "ano novo". Essas o extrator
 * PODE converter, e exigir digito ali seria recusar data legitima. Nome de mes
 * solto ("final de novembro", "em janeiro") nao entra nessa lista de proposito:
 * e justamente o caso ambiguo que gerou o erro.
 */
export function datasCorroboradas(falasDoHospede: string, checkin?: string | null, checkout?: string | null): boolean {
  const t = falasDoHospede || '';
  if (!checkin && !checkout) return true;

  const relativaResolvivel =
    /\b(hoje|amanh[ãa]|depois de amanh[ãa]|fim de semana|final de semana|feriado|natal|ano novo|r[ée]veillon|carnaval|p[áa]scoa)\b/i;
  if (relativaResolvivel.test(t)) return true;

  const numeros = new Set((t.match(/\d{1,2}/g) || []).map((n) => String(Number(n))));
  const diaAparece = (data?: string | null) => {
    if (!data) return true;
    const m = data.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (!m) return true;
    return numeros.has(String(Number(m[2])));
  };

  return diaAparece(checkin) && diaAparece(checkout);
}

/**
 * O hospede pediu mais de um periodo na mesma conversa?
 *
 * Caso real (09/09/2026): "22/11 a 27/11" e, na mensagem seguinte, "E para 5
 * pessoas 27/09 a 28/09". A extracao devolveu UM orcamento so - as datas do
 * primeiro pedido com a quantidade do segundo - e o link saiu com a combinacao
 * que ninguem pediu. Misturar dois pedidos e pior que nao responder: parece
 * atendimento feito, e esta errado.
 */
export function periodosPedidos(falasDoHospede: string, hoje = new Date()): string[] {
  return intervalosNaFala(falasDoHospede, hoje).map((p) => {
    const br = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
    return br(p.checkin) + ' a ' + br(p.checkout);
  });
}

/**
 * Meses por prefixo, de proposito.
 *
 * O hospede digita rapido e erra: "28janwiro a 02 fevereiro" e uma mensagem
 * real de 10/09/2026. Casar so a grafia certa deixaria a frase inteira sem
 * leitura. Tres letras bastam para nao haver confusao entre meses.
 */
const MESES: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

/**
 * Datas em espanhol viram o formato que a leitura ja conhece.
 *
 * Hospede argentino e rotina aqui, e "del 10 al 15 de enero" nao era lido:
 * "al" nao era separador e "enero", "febrero", "octubre"... nao eram mes
 * (bateria de 26/10/2026). Sem leitura no codigo, o periodo dependia da IA -
 * e com a IA congestionada a resposta nao saia.
 */
export function datasEmEspanhol(texto: string): string {
  const meses: Record<string, string> = {
    enero: 'janeiro', febrero: 'fevereiro', marzo: 'março', abril: 'abril', mayo: 'maio', junio: 'junho',
    julio: 'julho', agosto: 'agosto', septiembre: 'setembro', setiembre: 'setembro', octubre: 'outubro',
    noviembre: 'novembro', diciembre: 'dezembro',
  };
  return (texto || '')
    .replace(
      /\b(enero|febrero|marzo|mayo|junio|julio|septiembre|setiembre|octubre|noviembre|diciembre)\b/gi,
      (mes) => meses[mes.toLowerCase()] ?? mes,
    )
    .replace(/(\d{1,2})\s+al\s+(\d{1,2})/gi, '$1 a $2')
    .replace(/\bdel\s+(\d{1,2})\s+a\s+/gi, 'de $1 a ');
}

/**
 * Lista de DIAS, um por linha: dias seguidos formam UM periodo.
 *
 * Caso real (22/10/2026): a hospede mandou as segundas a quintas de sete
 * semanas, uma data por linha ("Segunda-feira: 26/10", "Terca-feira: 27/10",
 * ...). A leitura de periodos juntava as datas de duas em duas (26-27, 28-29)
 * e saiam treze periodos errados. Regra do dono: em cada sequencia, o PRIMEIRO
 * dia e a entrada e o ULTIMO e a saida - 26/10 a 29/10, e assim por semana.
 *
 * Dias seguidos, e nao o cabecalho "Semana N", e o que separa os periodos:
 * assim a semana que atravessa o mes (30/11, 01/12, 02/12, 03/12) continua
 * sendo uma so, e funciona tambem sem cabecalho nenhum.
 *
 * So entra com pelo menos quatro linhas que sejam praticamente so a data, e
 * desiste se sobrar dia solto (sem o dia seguinte, nao da para saber se e
 * entrada ou saida) - ai a leitura de antes continua valendo.
 */
export function periodosDeListaDeDias(
  texto: string,
  hoje = new Date(),
): { checkin: string; checkout: string }[] | null {
  const linhaDeData =
    /^\s*[-•*·]?\s*(?:[a-zà-ÿ]+(?:-[a-zà-ÿ]+)?\s*[:,.\-–]?\s*)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:[-–(]?\s*[a-zà-ÿ]+(?:-[a-zà-ÿ]+)?\)?)?\s*$/i;
  const datas: { d: number; m: number; a?: string }[] = [];
  for (const linha of (texto || '').split(/\r?\n/)) {
    const m = linha.match(linhaDeData);
    if (m) datas.push({ d: Number(m[1]), m: Number(m[2]), a: m[3] });
  }
  if (datas.length < 4) return null;

  const hojeUTC = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const DIA = 86400000;
  const tempos: number[] = [];
  for (const x of datas) {
    if (x.d < 1 || x.d > 31 || x.m < 1 || x.m > 12) return null;
    let ano = x.a ? Number(x.a.length === 2 ? '20' + x.a : x.a) : new Date(hojeUTC).getUTCFullYear();
    let t = Date.UTC(ano, x.m - 1, x.d);
    if (new Date(t).getUTCMonth() !== x.m - 1) return null; // 31/11 e afins
    // Sem ano: data que ja passou e do ano que vem; e a lista anda para a
    // frente - uma data "menor" que a anterior virou o ano.
    if (!x.a && t < hojeUTC) t = Date.UTC(++ano, x.m - 1, x.d);
    const anterior = tempos[tempos.length - 1];
    if (anterior !== undefined && t < anterior && !x.a) t = Date.UTC(ano + 1, x.m - 1, x.d);
    tempos.push(t);
  }

  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const saida: { checkin: string; checkout: string }[] = [];
  let inicio = tempos[0];
  let fim = tempos[0];
  for (let i = 1; i <= tempos.length; i++) {
    const t = tempos[i];
    if (t !== undefined && t - fim === DIA) {
      fim = t;
      continue;
    }
    if (fim === inicio) return null; // dia solto: nao da para dizer se e entrada ou saida
    saida.push({ checkin: iso(inicio), checkout: iso(fim) });
    if (t !== undefined) {
      if (t <= fim) return null; // repetida ou fora de ordem: nao e uma lista de dias
      inicio = t;
      fim = t;
    }
  }
  return saida.length ? saida : null;
}

/**
 * Todos os periodos que o hospede escreveu, em qualquer das formas usuais.
 *
 * Antes so lia "10/10 a 12/10". Mas em conversa de hotel o periodo vem escrito
 * de varios jeitos - "14 a 19 janeiro", "28 janeiro a 02 fevereiro", "de 8 a 13
 * de setembro" - e cada forma que a gente nao le vira uma chamada de IA gasta,
 * ou pior, um orcamento errado.
 *
 * Devolve TODOS os intervalos achados: um pedido com duas alternativas ("14 a
 * 19 janeiro OU 28 de janeiro a 02 de fevereiro") precisa ser reconhecido como
 * dois, nao colapsado num so.
 */
export function intervalosNaFala(
  texto: string,
  hoje = new Date(),
  // Opcional e so de saida: quem quiser saber POR QUE nao saiu periodo passa
  // este objeto e le depois. Assim a assinatura antiga continua valendo em
  // todos os pontos que ja chamavam a funcao.
  diagnostico?: { descartadosPorDuracao: number },
): { checkin: string; checkout: string }[] {
  // Tira os prefixos de quem falou ANTES de qualquer leitura de data.
  //
  // Alguns chamadores ja passavam o texto limpo e outros nao, e isso decidia o
  // resultado sem ninguem perceber: a distancia maxima entre duas datas soltas
  // e de 25 caracteres, e o prefixo "Hóspede (hoje): " come 16 deles. Por isso
  // "Entrada 15/10/26 / Saida 16/10/26" era lido (23 caracteres) e "check in
  // 20/11 / check out 23/11" nao (27). O primeiro funcionava por sorte.
  //
  // semPrefixos tambem normaliza pontuacao e numero por extenso, e aplicar
  // duas vezes nao muda nada - entao quem ja limpava continua igual.
  const t = semPrefixos(datasEmEspanhol(texto || '')).replace(
    /\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\s*(a|até|ate|-|–)\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/gi,
    (_todo, d1, m1, a1, sep, d2, m2, a2) =>
      `${d1}/${m1}${a1 ? '/' + a1 : ''} ${sep} ${d2}/${m2}${a2 ? '/' + a2 : ''}`,
  );
  const mes = (p: string) => MESES[(p || '').slice(0, 3).toLowerCase()] || 0;

  // Lista de dias, um por linha: ver periodosDeListaDeDias.
  const daLista = periodosDeListaDeDias(t, hoje);
  if (daLista) return daLista;

  const brutos: { d1: number; m1: number; a1?: string; d2: number; m2: number; a2?: string }[] = [];
  const push = (d1: any, m1: any, d2: any, m2: any, a1?: string, a2?: string) => {
    if (m1 && m2) brutos.push({ d1: Number(d1), m1: Number(m1), a1, d2: Number(d2), m2: Number(m2), a2 });
  };

  // Escritas em literal, e nao montadas com new RegExp: as barras invertidas
  // sobrevivem intactas e o que se le aqui e o que roda.
  //
  // 10/10 a 12/10  |  16/01/2027 a 20/01/2027
  const rNumerico = /\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\s*(?:a|à|ao|até|ate|-|–)\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b/gi;
  // Prefixos de mes escolhidos para NAO colidir com palavra comum. Com o
  // prefixo de tres letras de antes, "2 a 3 mais ou menos" virava maio, "2 a 3
  // juntos" virava junho, "2 a 3 outros" outubro, e "dia 21 a 23 agora em
  // novembro" virava AGOSTO. Nos meses com colisao exigimos mais letras (maio,
  // junh, julh, agos, outu, nove, marco); nos outros o prefixo curto continua,
  // porque e onde o hospede erra a grafia ("janwiro").
  //
  // 28 janeiro a 02 fevereiro  |  28 de janeiro até 2 de fevereiro
  //
  // Separadores: alem de "a/ate", tambem "as"/"as" (o hospede escreve "29
  // dezembro as 1 Janeiro", sem crase) e "e" (em "entre 29 dezembro e 1
  // janeiro"). Aqui "e" e seguro porque o padrao exige MES dos dois lados -
  // "entre 2 e 3 pessoas" nao tem como casar. Caso real de 16/10/2026: pedido
  // de Reveillon ficou sem link porque "as" nao estava na lista.
  // O ANO depois do mes, de 2 ou 4 digitos, e opcional em cada ponta:
  // "24 dez 26 a 3 jan 27" (caso real de 20/10/2026). Sem capturar o ano, o
  // "26" era lido como se fosse dia e o periodo saia torto - a Bella nao
  // montava link e ainda respondia com datas de outra conversa.
  const rDoisMeses = /\b(\d{1,2})\s*(?:de\s*)?(jan|fev|mar[cç]o|abr|maio|junh|julh|agos|set|outu|nove|dez)[a-zç]*\.?(?:\s*(?:de\s*)?(\d{4}|\d{2})\b)?\s*(?:at[ée]|ao|[aà]s|a|à|e|-|–)\s*(\d{1,2})\s*(?:de\s*)?(jan|fev|mar[cç]o|abr|maio|junh|julh|agos|set|outu|nove|dez)[a-zç]*\.?(?:\s*(?:de\s*)?(\d{4}|\d{2})\b)?/gi;
  // 14 a 19 janeiro  |  de 8 a 13 de setembro
  const rUmMes = /\b(\d{1,2})\s*(?:a|à|ao|até|ate|-|–)\s*(\d{1,2})\s*(?:de\s*)?(jan|fev|mar[cç]o|abr|maio|junh|julh|agos|set|outu|nove|dez)[a-zç]*/gi;
  // 15 a 17/10  |  15 a 17/10/2026 - o mes vem so na segunda data
  const rUmMesNumerico = /\b(\d{1,2})\s*(?:a|à|ao|até|ate|-|–)\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b/gi;

  let m: RegExpExecArray | null;
  while ((m = rNumerico.exec(t)) !== null) push(m[1], m[2], m[4], m[5], m[3], m[6]);
  // Grupos: dia1, mes1, ano1, dia2, mes2, ano2 - os anos sao opcionais.
  while ((m = rDoisMeses.exec(t)) !== null) push(m[1], mes(m[2]), m[4], mes(m[5]), m[3], m[6]);
  while ((m = rUmMes.exec(t)) !== null) push(m[1], mes(m[3]), m[2], mes(m[3]));
  // "15 a 17/10": o mes vem so na segunda data. So entra em acao se nenhuma das
  // leituras acima achou periodo - senao, em "15/10 a 17/10", ela leria o MES da
  // primeira data como dia ("10 a 17/10") e inventaria um segundo periodo.
  if (!brutos.length) {
    while ((m = rUmMesNumerico.exec(t)) !== null) push(m[1], m[3], m[2], m[3], m[4], m[4]);
  }

  // Dias num balao, mes em outro.
  //
  // Caso real (11/09/2026): "Gostaria de reservar a Stander do dia 21 a 23?",
  // nos perguntamos "Deste mes?", e ele respondeu so "Novembro" na mensagem
  // seguinte. Nenhum balao tem o periodo inteiro - e a Bella respondeu pedindo
  // a data que ele ja tinha dado.
  //
  // So junta quando e inequivoco: os dias vem com "dia/dias" na frente (senao
  // "2 a 3 pessoas" viraria periodo) e ha UM mes citado, por extenso, na fala
  // dele. Dois meses citados, ou nenhum, e ambiguo - fica com a IA.
  if (!brutos.length) {
    const rSoDias = /\bdias?\s*(\d{1,2})\s*(?:a|à|ao|até|ate|-|–)\s*(?:dia\s*)?(\d{1,2})\b/gi;
    // Outras formas de dizer o mesmo intervalo, todas vistas em atendimento:
    // "entre 21 e 24", "do dia 21 ao dia 24", "entrando dia 21 e saindo dia 24".
    // "entre 21 e 24". O que vem DEPOIS do segundo numero decide se sao datas:
    // "entre 2 e 3 pessoas" e "entre 2 e 3 noites" sao quantidade, nao periodo,
    // e viravam 02 a 03 do mes citado - um orcamento para as datas erradas.
    const rEntre =
      /\bentre\s*(?:o\s*)?(?:dia\s*)?(\d{1,2})\s*e\s*(?:o\s*)?(?:dia\s*)?(\d{1,2})\b(?!\s*(?:pessoas?|adultos?|crian|h[óo]spedes?|noites?|di[áa]rias?|di[áa]rias|quartos?|apartamentos?|anos?))/gi;
    const rDoDiaAo = /\bdo\s*dia\s*(\d{1,2})\s*(?:a|ao|at[ée])\s*(?:o\s*)?(?:dia\s*)?(\d{1,2})\b/gi;
    // Tambem "chegamos dia 20 e saimos dia 23 de novembro" (bateria de 26/10/2026).
    const rEntrandoSaindo =
      /\b(?:entrando|chegando|chegamos|chego|chegaremos|entramos|entro)\s*(?:no\s*)?(?:dia\s*)?(\d{1,2})\b[^\d\n]{0,20}\b(?:saindo|sa[íi]mos|saio|sairemos|voltamos|volto)\s*(?:no\s*)?(?:dia\s*)?(\d{1,2})\b/gi;
    const rMesSolto = /\b(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/gi;
    const citados = new Set<number>();
    let mm: RegExpExecArray | null;
    while ((mm = rMesSolto.exec(t)) !== null) citados.add(mes(mm[1]));
    if (citados.size === 1) {
      const unico = [...citados][0];
      while ((m = rSoDias.exec(t)) !== null) push(m[1], unico, m[2], unico);
        while ((m = rEntre.exec(t)) !== null) push(m[1], unico, m[2], unico);
        while ((m = rDoDiaAo.exec(t)) !== null) push(m[1], unico, m[2], unico);
        while ((m = rEntrandoSaindo.exec(t)) !== null) push(m[1], unico, m[2], unico);
    }
  }

  // Mes abreviado: "21 nov a 24 nov", "21 nov. a 24 nov.".
  //
  // O \b depois da abreviacao e o que torna isso seguro: "3 novamente" nao
  // casa, porque depois de "nov" vem letra. Sem ele, voltariamos ao bug que
  // fez "dia 21 a 23 agora em novembro" virar agosto.
  // Este bloco roda SEMPRE, e nao so quando nada foi encontrado.
  //
  // Caso real (20/10/2026): a hospede pediu tres orcamentos, um deles escrito
  // "20 a 22 nov 26". Como o periodo de dezembro ja tinha sido lido, o bloco
  // das abreviacoes nunca rodava e novembro sumia em silencio - a Bella
  // respondia sobre um periodo so. Periodos repetidos nao sao problema: o
  // conjunto `vistos` mais abaixo elimina duplicata.
  {
    // O guarda e (?![a-z]) e nao \b: com "nov." o \b vinha DEPOIS do ponto, e
    // entre "." e espaco nao ha fronteira de palavra - entao "21 nov. a 24
    // nov." nunca casava, apesar do comentario acima dizer que sim.
    const rDoisAbrev = /\b(\d{1,2})\s*(?:de\s*)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?(?![a-zà-ÿ])\s*(?:at[ée]|ao|[aà]s|a|à|-|–)\s*(\d{1,2})\s*(?:de\s*)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?(?![a-zà-ÿ])/gi;
    while ((m = rDoisAbrev.exec(t)) !== null) push(m[1], mes(m[2]), m[3], mes(m[4]));
    {
      const rUmAbrev = /\b(\d{1,2})\s*(?:a|à|ao|até|ate|-|–)\s*(\d{1,2})\s*(?:de\s*)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?(?![a-zà-ÿ])/gi;
      while ((m = rUmAbrev.exec(t)) !== null) push(m[1], mes(m[3]), m[2], mes(m[3]));
    }
  }

  // Duas datas completas ligadas por PALAVRAS, e nao por "a":
  //   "entrada 21/11 saída 24/11", "check in 21/11 check out 24/11",
  //   "chegando 21/11 e saindo 24/11".
  //
  // So entra se nada acima achou periodo, e o que separa as duas datas nao
  // pode conter digito - assim tres datas soltas na conversa nao viram um
  // intervalo inventado.
  if (!brutos.length) {
    // O que separa as duas datas pode incluir a QUEBRA DE LINHA: no WhatsApp
    // as pessoas mandam "Entrada 15/10/26" e "Saida 16/10/26" em mensagens
    // separadas. Antes exigiamos tudo na mesma linha e o periodo nao era lido.
    // O limite de 25 caracteres continua impedindo que duas datas distantes na
    // conversa sejam coladas num intervalo que ninguem pediu.
    const rDuasDatas = /\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b[^\d]{1,25}\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b/gi;
    while ((m = rDuasDatas.exec(t)) !== null) push(m[1], m[2], m[4], m[5], m[3], m[6]);
  }

  const hojeUTC = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
  const vistos = new Set<string>();
  const saida: { checkin: string; checkout: string }[] = [];

  for (const b of brutos) {
    const monta = (d: number, mm: number, ano?: string) => {
      if (d < 1 || d > 31 || mm < 1 || mm > 12) return null;
      const yyyy = ano ? Number(ano.length === 2 ? '20' + ano : ano) : hojeUTC.getUTCFullYear();
      let data = new Date(Date.UTC(yyyy, mm - 1, d));
      if (data.getUTCMonth() !== mm - 1) return null; // 31/02 e afins
      // Sem ano: data que ja passou e do ano que vem.
      if (!ano && data < hojeUTC) data = new Date(Date.UTC(yyyy + 1, mm - 1, d));
      return data;
    };
    const entrada = monta(b.d1, b.m1, b.a1);
    let saidaData = monta(b.d2, b.m2, b.a2);
    if (!entrada || !saidaData) continue;
    // Virada de ano: "28 de dezembro a 02 de janeiro".
    if (saidaData <= entrada && !b.a2) {
      saidaData = new Date(Date.UTC(saidaData.getUTCFullYear() + 1, saidaData.getUTCMonth(), saidaData.getUTCDate()));
    }
    if (saidaData <= entrada) continue;

    // Estadia longa demais e erro de leitura, nao pedido de hospede.
    //
    // Caso real (19/10/2026): "pro dia 31 a dia 1 dezembro". Novembro nao tem
    // dia 31, entao a leitura escorregou para 31/12; como o dia 1 de dezembro
    // vem antes, a regra da virada de ano o jogou para 2027 e saiu um periodo
    // de 335 diarias. Nenhum site devolve disponibilidade para isso, e o
    // hospede ficaria sem link sem entender por que.
    //
    // 60 noites e folgado para hotelaria: acima disso, devolvemos nada e a IA
    // pergunta as datas - melhor gastar a chamada do que adivinhar.
    const noites = Math.round((saidaData.getTime() - entrada.getTime()) / 86400000);
    if (noites > 60) {
      if (diagnostico) diagnostico.descartadosPorDuracao++;
      continue;
    }

    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const chave = iso(entrada) + '|' + iso(saidaData);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push({ checkin: iso(entrada), checkout: iso(saidaData) });
  }

  // Ordem estavel: quando avisamos que ha dois periodos, eles saem na ordem
  // em que acontecem, nao na ordem em que os regex casaram.
  return saida.sort((a, b) => (a.checkin < b.checkin ? -1 : 1));
}

/**
 * Extracao sem IA, para quando a frase nao tem o que interpretar.
 *
 * "10/10 a 12/10 / 2 adultos" nao precisa de modelo nenhum - e data e numero,
 * escritos por extenso. Mas cada sugestao gastava uma chamada so para ler isso,
 * e a chamada de extracao virou a maior consumidora do teto de 20 requisicoes
 * por minuto: em 10/09/2026 as VINTE ultimas quedas eram todas de extracao, com
 * o Google pedindo 30 a 46 segundos de espera. Toda vez que o teto estourava, a
 * ocupacao voltava vazia e a resposta saia sem link.
 *
 * Aqui a conversa e lida no codigo. So devolve resultado quando os tres dados
 * saem inteiros e sem ambiguidade; em qualquer duvida devolve null e a IA
 * assume, como antes. E melhor gastar a chamada do que adivinhar.
 *
 * Ano: DD/MM sem ano vira a proxima ocorrencia a partir de hoje - "10/10" em
 * setembro e outubro deste ano; em novembro seria outubro do ano que vem.
 */
export function extrairDeterminista(falasDoHospede: string, hoje = new Date()): any | null {
  const t = falasDoHospede || '';

  // Um periodo, e apenas um: duas alternativas tem tratamento proprio.
  const periodos = intervalosNaFala(t, hoje);
  if (periodos.length !== 1) return null;

  // Ocupacao: so a forma explicita. "casal", "familia" e afins ficam com a IA.
  const daFala = ocupacaoNaFala(t);
  // Numero e palavra na MESMA linha ([ \t], nunca \s): senao o fim de uma linha
  // cola no comeco da proxima.
  const semPref = semPrefixos(t);
  // A ULTIMA declaracao vence, nao a primeira.
  //
  // Caso real (20/10/2026): a hospede abriu com "somos um casal e dos adultos"
  // e, na mensagem seguinte, foi direto ao ponto: "Somos 4 adultos". Pegando a
  // primeira ocorrencia, o orcamento sairia para 2 pessoas. Ao longo de uma
  // conversa o hospede corrige e precisa o que disse - o numero mais recente e
  // o que vale.
  // "mais 1 adulto" nao e a quantidade: ver adultosNaFala.
  const lidosAdultos = adultosNaFala(semPref).adultos;
  const mAdultos = lidosAdultos === null ? null : [String(lidosAdultos), String(lidosAdultos)];
  // Alem de "pessoas" e "hospedes", as palavras com que o hospede realmente diz
  // quem sao. Caso real (16/10/2026): "Entrada 17/10 Saida 20/10 / 3 homens" -
  // o periodo foi lido, "3 homens" nao, e a Bella nao montou o link.
  // So entram palavras que designam ADULTO: "meninos", "garotas" e afins ficam
  // de fora de proposito, porque mudam a tarifa e quem decide e a IA.
  // Sem \b no fim: depois de letra acentuada ("moças") ele nao casa.
  //
  // Hospedagem de empresa (22/10/2026): "estadia para 4 funcionarios" nao
  // era lida, e a Bella ficou sem a ocupacao. Entram as palavras de equipe.
  const mPessoas = semPref.match(
    // Plural e singular escritos por extenso onde o "s?" nao resolve:
    // "homens?" casaria "homen", nunca "homem".
    /\b(\d{1,2})[ \t]*(?:pessoas?|hóspedes?|hospedes?|homens|homem|mulheres|mulher|rapazes|rapaz|moças?|mocas?|amigos?|amigas?|colegas?|senhores|senhor|senhoras?|funcion[áa]ri[oa]s?|colaborador(?:es|as?)?|trabalhador(?:es|as?)?|t[ée]cnic[oa]s?|profissionais|profissional|oper[áa]ri[oa]s?|integrantes?|participantes?|passageir[oa]s?|viajantes?|personas?)(?![a-zà-ÿ])/i,
  );
  const temCrianca = PALAVRA_DE_CRIANCA.test(semPref);

  let adultos: number | null = null;
  let idades: number[] = [];
  if (daFala) {
    // "3 adultos e 1 criança de 13 anos": adultos e idades, ditos por ele.
    adultos = daFala.adultos;
    idades = daFala.idades;
  } else if (mAdultos) {
    adultos = Number(mAdultos[1]);
    if (temCrianca) return null; // citou criança sem idade: quem decide é a IA
  } else if (mPessoas && !temCrianca) {
    adultos = Number(mPessoas[1]);
  } else if (!temCrianca && adultosDeCasal(semPref)) {
    // O numero vem da propria funcao: "2 casais" sao 4 adultos, nao 2.
    adultos = adultosDeCasal(semPref);
  } else if (!temCrianca && adultosDeFrase(semPref)) {
    // "somos 2", "so nos dois", "eu e minha esposa".
    adultos = adultosDeFrase(semPref);
  }
  if (!adultos || adultos < 1 || adultos > 15) return null;

  // Varios apartamentos: a COMPOSICAO de cada um nao sai de regex, mas a
  // quantidade sai - e com ela o bookingContext ja sabe pedir quantas pessoas
  // ficam em cada quarto, sem gastar IA. Caso real (17/09/2026): "13/11 a 14/11
  // / 4 pessoas 2 quartos com 2 camas de solteiro" ficou sem resposta porque a
  // leitura desistia aqui e a IA estava sem cota.
  //
  // "familias" e "casais" contam como apartamentos: "Sao 3 familias" (21/09)
  // significa tres apartamentos separados, um por familia. "casal" no singular
  // NAO entra aqui - aquilo e a ocupacao de um apartamento so (ver
  // adultosDeCasal).
  // Descrever a planta NAO e pedir apartamentos.
  //
  // Caso real (20/10/2026): "todos os apartamentos SAO DE dois quartos?" era
  // pergunta sobre a planta, virou apartamentos=2, e o link saiu sem ocupacao.
  // O lookbehind corta as formas de descricao ("sao de", "e de", "possuem",
  // "tem"); "preciso de 2 quartos" e "quero 2 quartos" continuam valendo.
  const mQuartos = semPref.match(
    /(?<!\b(?:s[ãa]o|[ée]|eh|possuem|possui|t[êe]m|tem|cont[êe]m|contam|conta)\s+(?:de\s+)?)\b(\d{1,2})[ \t]*(?:apartamentos?|quartos?|apt[os]?\.?|su[íi]tes?|fam[íi]lias|casais|habitaciones)\b/i,
  );
  const apartamentos = mQuartos ? Number(mQuartos[1]) : 1;
  if (apartamentos < 1 || apartamentos > 8) return null;

  return {
    checkin: periodos[0].checkin,
    checkout: periodos[0].checkout,
    adults: adultos,
    children0_6: 0,
    children7_9: 0,
    idades,
    intent: 'booking',
    apartamentos,
    semIA: true,
  };
}

/**
 * Palavras que indicam crianca - nos tres idiomas que atendemos.
 *
 * Havia duas listas e nenhuma tinha "menina"; depois virou uma lista so, mas
 * ainda so em portugues. Em 16/09/2026 uma hospede paraguaia escreveu "mis 4
 * hijos de 20 15 14 10 anos" e a trava de ocupacao, cega para o espanhol,
 * concluiu que ela nao tinha dito quantas pessoas eram - APAGOU o numero que a
 * IA havia extraido, e sem ocupacao nao ha link.
 */
const PALAVRA_DE_CRIANCA =
  // "pequeno" de PORTE nao e crianca: "uma pet porte pequeno" (21/10/2026)
  // virou crianca sem idade e prendeu o link.
  // "son" (filho, em ingles) so com quem diz de quem e: solto, casava dentro
  // de "perSONas" e no "son" do espanhol ("son 4 adultos") - 22/10/2026.
  /(crian[çc]a|menor|filh[oa]|beb[êe]|net[oa]|menin[oa]|garot[oa]|adolescente|sobrinh[oa]|entead[oa]|(?<!(?:porte|pet|c[ãa]o|cachorr[oa]|gat[oa])\s{1,3})pequen[oa](?!\s+porte)|hij[oa]|ni[ñn][oa]|nen[ea]|chic[oa]|nieto|child|kid|\b(?:my|our|a|one|two|\d)\s+sons?\b|\bsons\b|daughter|baby)/i;

/** Como se diz "pessoa" nos tres idiomas. */
const PALAVRA_DE_PESSOA = /(pessoa|persona|adulto|adult|h[óo]spede|hu[ée]sped|guest|gente|people|person)/i;

/** Como se diz "anos" nos tres idiomas. */
const PALAVRA_DE_IDADE = /(anos?|años?|years?|yo\b)/i;

/**
 * Numero escrito por extenso vira digito.
 *
 * Caso real (14/10/2026): "29/12 a 02/01" e "Dois adultos, um bebê de dois
 * anos". Estava tudo dito - periodo, adultos e a idade da crianca - e a Bella
 * pediu a idade de volta. As datas ela leu; a ocupacao, nada: TODA leitura de
 * quantidade procura digito, e ali nao havia nenhum.
 *
 * "dos" fica de FORA de proposito. Em espanhol e dois, mas em portugues e
 * contracao: "o valor dos hospedes adicionais" viraria "2 hospedes" e
 * inventaria uma ocupacao que ninguem pediu. Espanhol com numero por extenso
 * continua com a IA - errar calado numa ocupacao e pior do que nao saber.
 */
/** "vinte e um" -> 21. Feito antes das unidades, senao sobraria "20 e 1". */
const DEZENA_COMPOSTA = /\b(vinte|trinta)\s+e\s+(um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove)\b/gi;
const UNIDADE: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
};
const NUMERO_POR_EXTENSO: [RegExp, string][] = [
  [/\b(uma?|un|one)\b/gi, '1'],
  [/\b(duas|dois|two)\b/gi, '2'],
  // "dos" em espanhol e dois, mas em portugues e "de os" - por isso ficou de
  // fora por muito tempo. Caso real (20/10/2026): hospede argentina escreveu
  // "somos um casal e dos adultos" (= 4 pessoas) e a Bella respondeu "grupo de
  // 3 adultos", chutando.
  //
  // So converte colado numa palavra de PESSOA, e nunca depois de "um", "cada"
  // e afins - assim "um dos adultos tem 70 anos" continua intacto, que e onde
  // o portugues usaria a contracao.
  [
    // Listar o que NAO converte e frageil: "o valor dos hospedes extras" e
    // portugues legitimo e passava. Entao a regra e ao contrario - so converte
    // onde ha contexto de ENUMERAR gente: comeco da frase, ou depois de
    // "somos", "e", "y", virgula ou "+". "o valor dos hospedes" nao tem nada
    // disso antes e fica intacto.
    /(?<=^|\n|\bsomos\s|\bseremos\s|\bsomos\s|\bson\s|\bseriamos\s|\be\s|\by\s|,\s|\+\s|\bmais\s|\bm[áa]s\s)dos\s+(?=(?:adultos?|pessoas?|personas?|h[óo]spedes?|hu[ée]spedes?|crian[çc]as?|ni[ñn][oa]s?|hij[oa]s?|homens|mulheres)\b)/gi,
    '2 ',
  ],
  [/\b(tr[êe]s|three)\b/gi, '3'],
  [/\b(quatro|cuatro|four)\b/gi, '4'],
  [/\b(cinco|five)\b/gi, '5'],
  [/\b(seis|six)\b/gi, '6'],
  [/\b(sete|siete|seven)\b/gi, '7'],
  [/\b(oito|ocho|eight)\b/gi, '8'],
  [/\b(nove|nueve|nine)\b/gi, '9'],
  // "dez" e o numero dez E a abreviacao de dezembro. Caso real (19/10/2026):
  // "29 de dez a 03 de jan" virava "29 de 10 a 03 de jan" e a data saia torta,
  // enquanto "29 de dezembro" funcionava. Quando vem logo depois de um dia
  // ("29 dez", "29 de dez"), e mes - nao converte. "somos dez" segue virando 10.
  [/(?<!\d\s{0,3})(?<!\d\s{0,3}de\s{0,3})\b(dez|diez|ten)\b/gi, '10'],
  [/\b(onze|once|eleven)\b/gi, '11'],
  [/\b(doze|doce|twelve)\b/gi, '12'],
  [/\b(treze|trece|thirteen)\b/gi, '13'],
  [/\b(ca?torze|catorce|fourteen)\b/gi, '14'],
  [/\b(quinze|fifteen)\b/gi, '15'],
  [/\b(dezesseis|sixteen)\b/gi, '16'],
  [/\b(dezessete|seventeen)\b/gi, '17'],
];

export function numerosPorExtenso(texto: string): string {
  let t = texto || '';
  t = t.replace(DEZENA_COMPOSTA, (_todo, dezena, unidade) =>
    String((String(dezena).toLowerCase() === 'vinte' ? 20 : 30) + (UNIDADE[String(unidade).toLowerCase()] || 0)),
  );
  for (const [r, n] of NUMERO_POR_EXTENSO) t = t.replace(r, n);
  return t;
}

/**
 * Tira os prefixos de quem falou ("Hospede:", "Nos (hoje):").
 *
 * A conversa chega com um prefixo por linha, e a leitura de ocupacao casava o
 * numero do FIM de uma linha com o "Hospede" do COMECO da seguinte:
 * "Hospede: 10/10 a 12/10" + "Hospede: Casal" virava "10 hospedes". Toda leitura
 * de quantidade passa por aqui antes.
 */
export function semPrefixos(texto: string): string {
  const semQuemFalou = (texto || '').replace(
    /^[ \t]*(?:H[óo]spede|N[óo]s)[ \t]*(?:\(hoje\))?[ \t]*:[ \t]*/gim,
    '',
  );

  // Pontuacao grudada entre o numero e a palavra.
  //
  // Caso real (13/10/2026): "13/10/26 a 15/10/26" e "1.pessoa". As datas saiam
  // certas, a ocupacao voltava vazia, e a Bella pediu de volta a quantidade de
  // hospedes que ele acabara de escrever. Era o PONTO: "1 pessoa" e "1pessoa"
  // funcionavam, "1.pessoa" nao.
  //
  // Numero-pontuacao-NUMERO fica intacto: "1.500" e "21.11" nao sao quantidade
  // grudada e nao podem virar duas coisas.
  const semPontoGrudado = semQuemFalou.replace(/(\d)[.\-:;](?=[A-Za-zÀ-ÿ])/g, '$1 ');

  // Numero por extenso vira digito.
  //
  // Caso real (14/10/2026): "Dois adultos, um bebê de dois anos" - tudo dito,
  // nenhum digito, e toda leitura de quantidade procura digito.
  //
  // As duas correcoes ficam AQUI, e nao em cada regex: toda leitura de
  // quantidade passa por esta funcao, entao um lugar so resolve adultos,
  // pessoas, criancas, casais, apartamentos e idades de uma vez.
  return numerosPorExtenso(semPontoGrudado);
}

/**
 * "4 casais" = 4 apartamentos de 2 adultos.
 *
 * O gerador de um link por apartamento ja existia, mas dependia de o extrator
 * (IA) devolver a lista de apartamentos. Para "4 casais (8 pessoas)" ele nao
 * devolveu, e o pedido caiu na regra generica de "mais de 6 pessoas, pergunte
 * como dividir" - quando a divisao JA estava dita. O dono mostrou em
 * 13/10/2026 como a resposta deveria ser: um link numerado por apartamento.
 *
 * Casal e duas pessoas, e dois e o que vai no link de cada apartamento. No
 * modelo que o dono escreveu os links saíram com um adulto cada; seria o preco
 * de uma pessoa so aparecendo para ele.
 *
 * Devolve null quando houver qualquer ambiguidade - e o extrator segue
 * mandando. Melhor nao decidir do que decidir errado.
 */
export function apartamentosDeCasais(
  falasDoHospede: string,
): { adultos: number; criancas0_6: number; criancas7_9: number }[] | null {
  const t = semPrefixos(falasDoHospede || '');

  // Mesma guarda de adultosDeCasal: em "17/10 casal" o 10 nao e quantidade.
  const m = t.match(/(?<![\d\/])(\d{1,2})[ \t]*casa(?:l|is)\b/i);
  if (!m) return null;

  const n = Number(m[1]);
  if (n < 2 || n > 8) return null; // 1 casal e um apartamento so; acima de 8 e grupo

  // Crianca junto torna a divisao ambigua: em que apartamento ela fica?
  if (PALAVRA_DE_CRIANCA.test(t)) return null;

  // "4 casais em 2 apartamentos" é o hospede dizendo outra coisa.
  if (/\bapartamento|\bapto|\bquarto|\bsu[íi]te/i.test(t)) return null;

  return Array.from({ length: n }, () => ({ adultos: 2, criancas0_6: 0, criancas7_9: 0 }));
}

/**
 * A divisao por apartamento, lida no CODIGO, um trecho por apartamento.
 *
 * Caso real (21/10/2026): "um apartamento com 2 adultos e uma crianca com 12
 * anos e o outro com 2 adultos e duas criancas 9 e 6 anos". O extrator (IA)
 * devolveu os dois apartamentos SEM as criancas, e saiu link de 2 adultos para
 * cada um - mais um terceiro, "todos juntos", para 4 adultos. A frase se le
 * sozinha: corta em "o outro" / quebra de linha, e cada pedaco passa pelo
 * mesmo leitor de ocupacao que ja acerta "2 adultos e 1 crianca de 12 anos".
 *
 * Devolve null na duvida (crianca sem idade num pedaco, apartamento acima de
 * 6, menos de dois pedacos com gente): ai segue o caminho de antes.
 */
export function divisaoPorApartamento(
  falasDoHospede: string,
): { adultos: number; idades: number[]; criancas0_6: number; criancas7_9: number }[] | null {
  const t = semPrefixos(falasDoHospede || '');
  if (!/\b(aptos?|apartamentos?|quartos?|su[íi]tes?|outr[oa])\b/i.test(t)) return null;
  const pedacos = t.split(/\r?\n|;|\b(?:e\s+)?(?:o|a|no|na|em|num|numa)\s+outr[oa]\b/i);
  const lista: { adultos: number; idades: number[]; criancas0_6: number; criancas7_9: number }[] = [];
  for (const p of pedacos) {
    const pedaco = p.trim();
    if (!pedaco) continue;
    const comIdade = ocupacaoNaFala(pedaco);
    if (comIdade) {
      lista.push({ adultos: comIdade.adultos, idades: comIdade.idades, criancas0_6: 0, criancas7_9: 0 });
      continue;
    }
    // Crianca sem idade neste pedaco: nao da para classificar - desiste.
    if (PALAVRA_DE_CRIANCA.test(pedaco)) return null;
    const adultos = pedaco.match(/(?<![\d\/])(\d{1,2})\s*(?:adultos?|pessoas?|h[óo]spedes?)(?![a-zà-ÿ])/i);
    if (adultos) {
      lista.push({ adultos: Number(adultos[1]), idades: [], criancas0_6: 0, criancas7_9: 0 });
    } else if (/\bcasal\b/i.test(pedaco)) {
      lista.push({ adultos: 2, idades: [], criancas0_6: 0, criancas7_9: 0 });
    }
  }
  if (lista.length < 2 || lista.length > 5) return null;
  if (lista.some((a) => a.adultos < 1 || a.adultos + a.idades.length > 6)) return null;
  return lista;
}

/**
 * "4 pessoas em cada apartamento" = o total dividido em partes iguais.
 *
 * Caso real (21/10/2026): 8 pessoas; a Bella disse que eram precisos dois
 * apartamentos e perguntou a divisao, o hospede respondeu "Pode ser 4 pessoas
 * em cada apartamento" - e ela pediu a divisao de novo e passou para a equipe.
 * Os outros leitores esperam um numero POR apartamento ("3 em um, 4 no
 * outro"); aqui e um numero so, que vale para todos.
 *
 * Com "2 apartamentos de 4" a conta vem inteira. Com "4 em cada" o numero de
 * apartamentos sai do total ja dito, e so quando a divisao e exata: 7 pessoas
 * com "4 em cada" e o hospede pensando em outra coisa.
 *
 * Crianca no pedido torna ambiguo (quem fica onde, com que idade): null.
 */
export function pessoasEmCadaApartamento(
  falasDoHospede: string,
  totalDito: number,
): { adultos: number; idades: number[]; criancas0_6: number; criancas7_9: number }[] | null {
  const t = semPrefixos(falasDoHospede || '');
  const gente = String.raw`(?:pessoas?|adultos?|h[óo]spedes?)`;
  const aptos = String.raw`(?:aptos?|apartamentos?|quartos?|su[íi]tes?)`;
  const formas = [
    // "4 pessoas em cada apartamento", "4 em cada", "4 para cada um"
    new RegExp(String.raw`(?<![\d\/.,])(\d{1,2})[ \t]*${gente}?[ \t]+(?:em|por|para|pra|no|na)[ \t]+cada(?![a-zà-ÿ])`, 'gi'),
    // "4 por apartamento"
    new RegExp(String.raw`(?<![\d\/.,])(\d{1,2})[ \t]*${gente}?[ \t]+por[ \t]+${aptos}(?![a-zà-ÿ])`, 'gi'),
    // "4 pessoas cada", "2 apartamentos com 4 pessoas cada"
    new RegExp(String.raw`(?<![\d\/.,])(\d{1,2})[ \t]*${gente}[ \t]+cada(?![a-zà-ÿ])`, 'gi'),
  ];
  let porApto = 0;
  let posicao = -1;
  for (const re of formas) {
    for (const m of t.matchAll(re)) {
      if ((m.index ?? 0) > posicao) {
        posicao = m.index ?? 0;
        porApto = Number(m[1]);
      }
    }
  }
  // "2 apartamentos de 4", "dois quartos com 4 pessoas"
  let quantos = 0;
  const reAptos = new RegExp(
    String.raw`(?<![\d\/.,])(\d{1,2})[ \t]*${aptos}[ \t]+(?:de|com|para|pra)[ \t]+(\d{1,2})(?![\d\/.,])(?:[ \t]*${gente})?`,
    'gi',
  );
  for (const m of t.matchAll(reAptos)) {
    if ((m.index ?? 0) >= posicao) {
      posicao = m.index ?? 0;
      quantos = Number(m[1]);
      porApto = Number(m[2]);
    }
  }
  if (porApto < 1 || porApto > 6) return null;
  if (!quantos) {
    if (!totalDito || totalDito % porApto !== 0) return null;
    quantos = totalDito / porApto;
  } else if (totalDito && quantos * porApto !== totalDito) {
    return null;
  }
  if (quantos < 2 || quantos > 5) return null;
  return Array.from({ length: quantos }, () => ({ adultos: porApto, idades: [], criancas0_6: 0, criancas7_9: 0 }));
}

/**
 * "4 apartamentos Superior duplos" = 4 apartamentos de 2 adultos.
 *
 * Caso real (26/10/2026): agencia pediu "24 a 29 de marco 4 apartamentos
 * Superior duplos". O tipo do apartamento JA diz a ocupacao, mas nenhuma
 * leitura entendia: faltou "quantidade de adultos", e a IA improvisou
 * perguntando se havia criancas. Regra do dono: sem crianca citada, sao so
 * adultos.
 *
 * Entre a quantidade e o tipo cabem ate duas palavras (a categoria:
 * "Superior", "Suite Bosque"). Com crianca na fala, nao decide.
 */
export function apartamentosPorTipo(
  falasDoHospede: string,
): { adultos: number; idades: number[]; criancas0_6: number; criancas7_9: number }[] | null {
  const t = semPrefixos(falasDoHospede || '');
  if (PALAVRA_DE_CRIANCA.test(t)) return null;
  const ocupacao: Record<string, number> = { individua: 1, single: 1, dupl: 2, casal: 2, tripl: 3, 'quádrupl': 4, quadrupl: 4, 'quíntupl': 5, quintupl: 5, 'sêxtupl': 6, sextupl: 6 };
  const m = t.match(
    /(?<![\d\/])(\d{1,2})[ \t]*(?:apartamentos?|aptos?|quartos?|su[íi]tes?|unidades?)[ \t]+(?:(?:de[ \t]+)?[a-zà-ÿ]+[ \t]+){0,2}?(?:de[ \t]+)?(individua(?:l|is)|single|dupl[oa]s?|casal|tripl[oa]s?|qu[áa]drupl[oa]s?|qu[íi]ntupl[oa]s?|s[êe]xtupl[oa]s?)(?![a-zà-ÿ])/i,
  );
  if (!m) return null;
  // "o apartamento tem 2 quartos de casal?" e pergunta sobre a PLANTA, nao
  // pedido de dois apartamentos: fora quando e pergunta ou vem depois de
  // "tem/possui/com".
  const i = m.index ?? 0;
  if (/\b(?:tem|t[êe]m|possui|possuem|com)[ \t]*$/i.test(t.slice(Math.max(0, i - 15), i))) return null;
  const fimRel = t.slice(i).search(/[.!\n]|\?/);
  if (fimRel >= 0 && t[i + fimRel] === '?') return null;
  const quantos = Number(m[1]);
  const tipo = m[2].toLowerCase();
  const chave = Object.keys(ocupacao).find((k) => tipo.startsWith(k));
  const porApto = chave ? ocupacao[chave] : 0;
  if (!porApto || quantos < 1 || quantos > 10) return null;
  return Array.from({ length: quantos }, () => ({ adultos: porApto, idades: [], criancas0_6: 0, criancas7_9: 0 }));
}

/**
 * Quantas criancas o hospede disse, mesmo sem a idade ("4 adultos e tres
 * criancas" -> 3). Vale a ULTIMA mencao: ao longo da conversa ele corrige.
 */
export function quantasCriancasNaFala(falasDoHospede: string): number {
  const t = semPrefixos(falasDoHospede || '');
  const re = /(?<![\d\/])(\d{1,2})\s*(?:crian[çc]as?|filh[oa]s?|menores|beb[êe]s?|ni[ñn][oa]s?|hij[oa]s?|kids?|children)(?![a-zà-ÿ])/gi;
  const achados = [...t.matchAll(re)];
  return achados.length ? Number(achados[achados.length - 1][1]) : 0;
}

/**
 * "3 em um apto / 4 em outro apto" = 2 apartamentos, de 3 e de 4.
 *
 * Caso real (20/10/2026): a hospede escreveu a divisao com todas as letras, o
 * extrator nao devolveu a lista de apartamentos e o pedido caiu em "7 pessoas:
 * pedir a divisao" - perguntando o que ela tinha acabado de dizer. Sem link,
 * a IA improvisou: afirmou vaga que ninguem consultou e escreveu precos (que a
 * guarda cortou, deixando "Para 3 pessoas:" vazio na mensagem).
 *
 * Mesma prudencia de apartamentosDeCasais: crianca na conversa torna a conta
 * ambigua (quem fica onde, com que idade), e ai quem decide segue o extrator.
 */
export function apartamentosDeclarados(
  falasDoHospede: string,
): { adultos: number; criancas0_6: number; criancas7_9: number }[] | null {
  const t = semPrefixos(falasDoHospede || '');
  if (PALAVRA_DE_CRIANCA.test(t)) return null;

  const re = /(?<![\d\/.,])(\d{1,2})[ \t]*(?:pessoas?|adultos?|h[óo]spedes?)?[ \t]+(?:em|no|na|num|numa|pra|para)[ \t]+(?:(?:um|uma|1|outro|outra|o[ \t]+outro|a[ \t]+outra|mais[ \t]+um)[ \t]+)?(?:aptos?|apartamentos?|quartos?|su[íi]tes?)(?![a-zà-ÿ])/gi;
  const completos = [...t.matchAll(re)];
  if (!completos.length) return null;
  // "4 em um quarto e 3 em outro": o segundo vem sem o substantivo. So vale
  // depois de um completo, senao "2 em outro horario" viraria apartamento.
  const elipse = /(?<![\d\/.,])(\d{1,2})[ \t]*(?:pessoas?|adultos?|h[óo]spedes?)?[ \t]+(?:em|no|na|num|numa)[ \t]+(?:o[ \t]+|a[ \t]+)?(?:outro|outra)(?![a-zà-ÿ])(?![ \t]+(?:aptos?|apartamentos?|quartos?|su[íi]tes?|dia|hor[áa]rio|m[êe]s|per[íi]odo)(?![a-zà-ÿ]))/gi;
  const ns = [...completos, ...t.matchAll(elipse)]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((m) => Number(m[1]));
  if (ns.length < 2 || ns.length > 5) return null;
  if (ns.some((n) => n < 1 || n > 6)) return null;
  return ns.map((n) => ({ adultos: n, criancas0_6: 0, criancas7_9: 0 }));
}

/**
 * "casal" como PESSOAS, e nao como tipo de cama.
 *
 * E uma das palavras mais comuns do atendimento - "casal e 1 menina 13 anos",
 * "para um casal" - e valia 2 adultos so quando a IA estava de pe. Mas ela tem
 * uma armadilha real: "Somente 1 adulto. Cama de casal" (11/09/2026) e UMA
 * pessoa querendo cama de casal. Por isso "cama/quarto/apartamento/suite de
 * casal" nao conta, "casais" (plural, varios apartamentos) fica com a IA, e
 * quantidade escrita ("1 adulto") sempre vence.
 */
export function adultosDeCasal(texto: string): number | null {
  const t = semPrefixos(texto);
  // (?<![\d\/]) impede que o numero venha de uma data: em "17/10 casal" o "10"
  // nao e quantidade de casais.
  const comNumero = t.match(/(?<![\d\/])(\d{1,2})[ \t]*casa(?:l|is)\b/i);
  if (comNumero) {
    const n = Number(comNumero[1]);
    return n >= 1 && n <= 8 ? n * 2 : null;
  }
  if (/\bcasais\b/i.test(t)) return null; // plural sem numero: nao da para contar
  const pessoas = /(?<!cama\s(?:de\s)?|quarto\s(?:de\s)?|apartamento\s(?:de\s)?|apto\.?\s(?:de\s)?|su[íi]te\s(?:de\s)?)\bcasal\b/i;
  return pessoas.test(t) ? 2 : null;
}

/**
 * Idades escritas SEM a palavra "anos".
 *
 * Caso real (13/10/2026): "2 adultos e 2 crianças (3/9)". As datas foram
 * lidas, a ocupacao nao, e a Bella pediu de volta tudo que a hospede acabara
 * de escrever - inclusive as idades, que estavam ali entre parenteses.
 * Reconheciamos apenas "3 e 9 anos"; sem a palavra "anos", nada.
 *
 * O risco obvio e confundir com data: "2 criancas 21/11" nao pode virar duas
 * criancas de 21 e 11 anos. Tres guardas, juntas:
 *
 *  1. os numeros vem logo DEPOIS de "N criancas", a poucos caracteres;
 *  2. a QUANTIDADE de numeros bate com o N declarado;
 *  3. todo numero e <= 17 - crianca, por definicao, e menor de idade. E o que
 *     descarta "21/11": 21 nao e idade de crianca.
 *
 * Devolve null em qualquer duvida; quem le "anos" continua sendo o caminho
 * principal.
 */
export function idadesSemAPalavraAnos(linha: string): number[] | null {
  // O PONTO entra como separador: "4 niños (9.9.10.10)" sao quatro criancas
  // de 9, 9, 10 e 10 anos - formato de uma hospede argentina em 16/10/2026.
  // A guarda da quantidade protege o resto: em "2 crianças, custa 1.500" os
  // numeros lidos seriam 1 e 500, e 500 nao e idade de crianca.
  // O numero seguinte so e idade se NAO for a quantidade de outra coisa.
  // Caso real (26/10/2026): "1 crianca 1 adulto 1 cama" leu a crianca com 1
  // ano, e "1 crianca, 2 adultos" com 2 - link com idade inventada.
  const naoEIdade = String.raw`(?![ \t]*(?:adult|pesso|h[óo]sped|cama|quart|apto|apart|su[íi]t|noite|di[áa]ri|crian|beb|casal|pet|cachorr))`;
  const m = (linha || '').match(
    new RegExp(
      String.raw`(\d{1,2})\s*(?:crian[çc]as?|filh[oa]s?|menores?|ni[ñn][oa]s?|kids?|children)\b[^\d\n]{0,14}(\d{1,2}` +
        naoEIdade +
        String.raw`(?:\s*(?:[\/,;.e-]|y|and)\s*\d{1,2})*)`,
      'i',
    ),
  );
  // Sem quantidade, no SINGULAR, vale 1: "4 adulto e criança 7" (caso real de
  // 16/10/2026, pedido de Reveillon que ficou sem link). Exigir o singular e o
  // que mantem a guarda de pe - "criancas 7" continua ambiguo e fica com a IA,
  // porque nao da para saber quantas sao.
  const mUm = m
    ? null
    : (linha || '').match(
        new RegExp(
          String.raw`\b(?:um|uma|1)?\s*(?:crian[çc]a|filh[oa]|menor|ni[ñn][oa]|kid|child)\b[^\d\n]{0,14}(\d{1,2})\b` + naoEIdade,
          'i',
        ),
      );
  if (!m && !mUm) return null;

  if (mUm) {
    const idade = Number(mUm[1]);
    return idade >= 0 && idade <= 17 ? [idade] : null;
  }

  const quantas = Number(m![1]);
  if (!quantas || quantas > 10) return null;

  const numeros = m![2]
    .split(/\s*(?:[\/,;.-]|\be\b|\by\b|\band\b)\s*/i)
    .map((x) => x.trim())
    .filter((x) => /^\d{1,2}$/.test(x))
    .map(Number);

  if (numeros.length !== quantas) return null;
  if (numeros.some((n) => n > 17)) return null;

  return numeros;
}

/**
 * O FORMATO em que o hospede escreveu numeros - sem os numeros.
 *
 * "faltam dados" e a maior causa de nao sair link (14 das 40 decisoes de
 * 14/10/2026), e na maioria delas a DATA foi lida e a quantidade de pessoas
 * nao. Para consertar isso eu preciso saber COMO as pessoas escrevem - foi
 * assim que apareceram "1.pessoa" e "2 crianças (3/9)", um print de cada vez.
 *
 * Mas nao posso guardar o que o hospede escreve: o diagnostico e publico e a
 * conversa e dele. Entao guardamos so a FORMA: cada numero vira "N" e fica o
 * que vem logo depois, no maximo 12 letras.
 *
 *   "1.pessoa"            -> "N.pessoa"
 *   "somos 4 adultos"     -> "N adultos"
 *   "2 crianças (3/9)"    -> "N criancas", "N/N"
 *
 * Nenhum numero real, nenhum nome, nenhuma data - so o molde, que e
 * exatamente o que falta para eu escrever a leitura certa.
 */
export function formatosDeNumero(falasDoHospede: string): string[] {
  // Texto CRU, sem a normalizacao de pontuacao: aqui eu quero justamente ver
  // o ponto de "1.pessoa". Tira so o prefixo de quem falou.
  const t = (falasDoHospede || '').replace(/^[ \t]*(?:H[óo]spede|N[óo]s)[ \t]*(?:\(hoje\))?[ \t]*:[ \t]*/gim, '');
  const achados = new Set<string>();

  // Separador e so PONTUACAO: antes era "qualquer coisa que nao seja digito",
  // e letras entravam nele - "1.pessoa" saia como "N ssoa".
  const r = /(\d{1,2})([ \t]*[.\-:;,\/()]*[ \t]*)([A-Za-zÀ-ÿ]{1,12}|\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = r.exec(t)) !== null) {
    const separador = (m[2] || '').replace(/[^.-:;,/()]/g, '');
    const seguinte = /^\d+$/.test(m[3]) ? 'N' : (m[3] || '').toLowerCase();
    if (!seguinte) continue;
    const forma = 'N' + (separador || ' ') + seguinte;
    achados.add(forma.slice(0, 18));
    if (achados.size >= 8) break;
  }
  return [...achados];
}

/**
 * Quantas pessoas, quando a frase nao traz "N adultos".
 *
 * Formas reais que a leitura nao entendia (corpus de 14/10/2026):
 * "somos 2", "só nós dois", "eu e minha esposa".
 *
 * "sao N" ficou de FORA de proposito: "são 2 noites" e "são 3 diarias" viriam
 * junto e inventariam hospedes a partir da quantidade de dias. "somos" e
 * "seremos" falam de gente e so de gente.
 *
 * O casal por parentesco vale 2 e so entra com conjuge - "eu e minha filha"
 * NAO entra, porque ali ha um adulto e uma crianca de idade desconhecida, e
 * chutar dois adultos erraria a categoria no site.
 */
export function adultosDeFrase(texto: string): number | null {
  const t = semPrefixos(texto || '');

  const somos = t.match(/\b(?:somos|seremos|vamos\s+ser)\s*(?:em\s*)?(\d{1,2})\b/i);
  if (somos) {
    const n = Number(somos[1]);
    if (n >= 1 && n <= 15) return n;
  }

  const nos = t.match(/\bn[óo]s\s*(\d{1,2})\b/i);
  if (nos) {
    const n = Number(nos[1]);
    if (n >= 1 && n <= 15) return n;
  }

  // "para mim e minha esposa" tambem (bateria de 26/10/2026).
  if (/\b(?:eu|mim)\s+e\s+(?:a\s+|o\s+)?(?:minha|meu)\s+(?:esposa|esposo|marido|mulher|namorad[oa]|companheir[oa]|noiv[oa])\b/i.test(t)) {
    return 2;
  }

  return null;
}

/**
 * Idades que vieram em linhas separadas da palavra "crianca".
 *
 * Caso real (16/10/2026): "2 crianças" numa mensagem, "Uma de 10" na seguinte
 * e "Uma de 12" na outra. A leitura de idade olhava uma linha por vez e
 * precisava da palavra "crianca" junto do numero - entao nao via nada, e a
 * Bella pediu as idades que a hospede acabara de dar.
 *
 * O formato aceito e estreito de proposito: "<quantidade> de <idade>", com a
 * idade ate 17. "1 de 10" e uma crianca de 10 anos; "4 pessoas" nao casa,
 * porque nao tem o "de"; e uma linha com um numero solto tambem nao casa, para
 * nao transformar a resposta "4" de outra pergunta em idade.
 */
export function idadesEmLinhaSeparada(texto: string): number[] {
  const idades: number[] = [];
  for (const linha of semPrefixos(texto || '').split(/\r?\n/)) {
    const m = linha.trim().match(/^(\d{1,2})\s+de\s+(\d{1,2})\s*(?:anos?)?$/i);
    if (!m) continue;
    const quantas = Number(m[1]);
    const idade = Number(m[2]);
    if (quantas < 1 || quantas > 9 || idade > 17) continue;
    for (let k = 0; k < quantas; k++) idades.push(idade);
  }
  return idades;
}

/**
 * Quantos adultos o hospede disse - e quantos chegam DEPOIS.
 *
 * Caso real (26/10/2026): "3 adultos e uma crianca de 5 anos [...] Em uns 2
 * ou tres dias tera mais um adulto que vai ficar com nos no apto". A regra
 * "a ultima quantidade vence" (22/10) pegou "mais 1 adulto" e o link saiu
 * para UM adulto.
 *
 * - "mais N adultos" / "+N" / "outro adulto" e ACRESCIMO, nao declaracao.
 * - Com aviso de tempo na mesma frase ("em 2 dias", "depois", "vai chegar",
 *   "vai ficar") e alguem que fica so PARTE da estadia: o link sai com a
 *   ocupacao de entrada, e a resposta avisa do valor adicional (regra do
 *   dono, 26/10/2026).
 * - Sem aviso de tempo ("3 adultos e mais 1 adulto") soma no total.
 * - Declaracao nova ("somos 4 adultos") substitui a anterior e zera os
 *   acrescimos ditos antes dela.
 */
export function adultosNaFala(texto: string): { adultos: number | null; chegamDepois: number } {
  const t = texto || '';
  const acrescimo = /(?:mais|\+|outr[oa]s?)[ \t]*$/i;
  const parteDaEstadia =
    /\b(?:dias?|depois|chega|chegar[aã]?|chegando|vai ficar|v[aã]o ficar|ficar[aã]|a partir|metade|parte da|juntar|ap[oó]s|semana)\b/i;
  let base: number | null = null;
  let soma = 0;
  let depois = 0;
  for (const m of t.matchAll(/\b(\d{1,2})[ \t]*adultos?\b/gi)) {
    const i = m.index ?? 0;
    const n = Number(m[1]);
    const antes = t.slice(Math.max(0, i - 12), i);
    if (acrescimo.test(antes)) {
      const ini = Math.max(t.lastIndexOf('.', i), t.lastIndexOf('!', i), t.lastIndexOf('?', i), t.lastIndexOf('\n', i)) + 1;
      const fimRel = t.slice(i).search(/[.!?\n]/);
      const frase = t.slice(ini, fimRel < 0 ? t.length : i + fimRel);
      if (parteDaEstadia.test(frase)) depois += n;
      // Sem quantidade dita antes nao ha o que somar: "1 crianca + 2 adultos"
      // e "eu e mais 2 adultos" SAO a declaracao (corrigido no mesmo dia, 26/10:
      // essas frases ficavam sem adultos). "Eu e mais 2" sao 3.
      else if (base === null) base = n + (/\beu\s+e\s+mais[ \t]*$/i.test(antes) ? 1 : 0);
      else soma += n;
      continue;
    }
    base = n;
    soma = 0;
    depois = 0;
  }
  return { adultos: base === null ? null : base + soma, chegamDepois: depois };
}

/**
 * Idade de bebe em MESES vira anos completos.
 *
 * Caso real (23/10/2026): "3 adultos e um bebe de 6 meses". Toda leitura de
 * idade procura "anos", entao o bebe ficou "sem idade", a Bella ja tinha
 * pedido dados duas vezes e passou para a equipe - sem link, com datas e
 * pessoas certas em maos. 6 meses e 0 ano: cortesia (0 a 6).
 *
 * So na linha que fala de crianca: "daqui a 2 meses vamos viajar" nao e idade.
 * "1 ano e 6 meses" e 1 ano - os meses que sobram nao viram outra crianca.
 */
export function mesesViramAnos(texto: string): string {
  return (texto || '')
    .split(/\r?\n/)
    .map((linha) => {
      if (!PALAVRA_DE_CRIANCA.test(linha)) return linha;
      return linha
        .replace(/(\d{1,2})\s*(anos?|años?)\s*(?:e|y)\s*\d{1,2}\s*(?:meses|m[êe]s)(?![a-zà-ÿ])/gi, '$1 $2')
        .replace(/(\d{1,2})\s*(?:meses|m[êe]s|months?)(?![a-zà-ÿ])/gi, (_t, n) => `${Math.floor(Number(n) / 12)} anos`);
    })
    .join('\n');
}

/**
 * Adultos e idades lidos DIRETO do que o hospede escreveu.
 *
 * A regra "10 anos ou mais conta como adulto" nao pode depender do extrator:
 * ele e a peca que mais falha (cota, 429, classificacao errada) e, quando
 * falha, some com a crianca inteira do orcamento. Quando a frase e explicita -
 * "2 adultos e 2 criancas (5 e 10 anos)" - nao ha nada a interpretar, e isso
 * vira conta no codigo.
 *
 * So aceita quando o hospede disse AS DUAS coisas: quantos adultos e as idades.
 * Com uma delas faltando, a frase admite leituras diferentes ("as criancas
 * estao entre os 4 que citei?") e a decisao volta para o extrator - errar
 * calado numa ocupacao e pior do que nao saber.
 *
 * Idades so contam perto de palavra de crianca, senao "moro aqui ha 10 anos"
 * viraria um hospede.
 */
export function ocupacaoNaFala(falasDoHospede: string): { adultos: number; idades: number[] } | null {
  const t = mesesViramAnos(semPrefixos(falasDoHospede));

  // A ULTIMA declaracao vence, como em extrairDeterminista: ao longo da
  // conversa o hospede corrige ("2 adultos" e depois "somos 3 adultos").
  // Aqui ficava a primeira, e esta leitura tem prioridade sobre a outra.
  // "Mais 1 adulto em 2 dias" e acrescimo, nao a quantidade - ver adultosNaFala.
  const lidosAdultos = adultosNaFala(t).adultos;
  // Quantidade escrita vence; sem ela, "casal" (pessoas, nao cama) vale 2.
  const adultosDeclarados = lidosAdultos ?? adultosDeCasal(t) ?? adultosDeFrase(t);
  if (!adultosDeclarados) return null;

  const idades: number[] = [];
  const palavraDeCrianca = PALAVRA_DE_CRIANCA;
  // Linha que e SO idade ("14 /16/7 anos") conta quando a conversa fala de
  // crianca em outro balao: o hospede responde a pergunta das idades numa
  // mensagem separada. Mesmo padrao de "dia 21 a 23" + "Novembro".
  const falaDeCrianca = palavraDeCrianca.test(t);
  const soIdades = /^[\s\d,;\/e-]*\s*(?:anos?|años?|years?)\s*[.!]?$/i;
  for (const linha of t.split(/\r?\n/)) {
    if (!palavraDeCrianca.test(linha) && !(falaDeCrianca && soIdades.test(linha))) continue;
    // Reinicia a cada linha: uma linha com "anos" nao pode calar a seguinte.
    let achouNaLinha = false;
    const antesDaLinha = idades.length;
    // "5 e 10 anos", "5, 7 e 10 anos", "20 15 14 10 años" - a hospede paraguaia
    // separou so por espaco, e nos tres idiomas o "anos" muda de grafia.
    const lista = /((?:\d{1,2}[\s,\/]*(?:e|y|and)?[\s,\/]*)*\d{1,2})\s*(?:anos?|años?|years?)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = lista.exec(linha)) !== null) {
      for (const n of m[1].split(/[\s,\/]+|\s*(?:e|y|and)\s*/i)) {
        if (!/^\d{1,2}$/.test(n)) continue; // "y", "e" e vazios viravam idade 0
        const idade = Number(n);
        // Ate 30: "mis 4 hijos de 20 15 14 10 años" - o filho de 20 e filho, e
        // pela regra da casa conta como adulto. O limite de 17 o descartava.
        if (idade >= 0 && idade <= 30) { idades.push(idade); achouNaLinha = true; }
      }
    }
    // Nenhuma idade com a palavra "anos" nesta linha? Tenta a forma curta,
    // "2 crianças (3/9)", que e como muita gente escreve no WhatsApp.
    if (!achouNaLinha) {
      const curtas = idadesSemAPalavraAnos(linha);
      if (curtas) idades.push(...curtas);
    }
    // "2 criancas 12 anos": UMA idade para VARIAS criancas e cada uma com
    // essa idade. Caso real (23/10/2026): "3 adultos / 2 criancas 12 anos"
    // virou 3 adultos e uma crianca de 12 - link para 4, quando eram 5 (com
    // 12 anos as duas contam como adultas).
    const quantasNaLinha = linha.match(
      /(?<![\d\/])(\d)[ \t]*(?:crian[çc]as|filh[oa]s|menin[oa]s|garot[oa]s|net[oa]s|sobrinh[oa]s|hij[oa]s|ni[ñn][oa]s|kids|children)(?![a-zà-ÿ])/i,
    );
    if (quantasNaLinha && idades.length - antesDaLinha === 1) {
      for (let k = 1; k < Number(quantasNaLinha[1]); k++) idades.push(idades[idades.length - 1]);
    }
  }
  // Idades que vieram em mensagens separadas ("2 crianças" / "1 de 10").
  if (falaDeCrianca) idades.push(...idadesEmLinhaSeparada(t));

  if (!idades.length) return null;

  return { adultos: adultosDeclarados, idades };
}

/**
 * Idade vira categoria - no codigo, nao no julgamento do modelo.
 *
 * Regra da casa: a partir de 10 anos a pessoa conta como ADULTO no sistema de
 * reservas; 7 a 9 e 0 a 6 sao as duas faixas de crianca.
 *
 * A regra ja existia, mas so rodava quando o hospede pedia VARIOS apartamentos.
 * No caso comum - um apartamento - ninguem classificava, e o extrator tinha
 * apenas os campos "criancas 0-6" e "criancas 7-9" para preencher: uma crianca
 * de 10 anos nao cabia em nenhum deles e sumia do link. Caso real (09/09/2026):
 * "2 adultos e 2 criancas (5 e 10 anos)" saiu como 2 adultos, sem as criancas,
 * quando o correto sao 3 adultos e 1 crianca de 5 anos.
 *
 * Idempotente: sem idades citadas, devolve a ocupacao como estava.
 */
export function normalizarOcupacao(stay: any): any {
  const idades: number[] = Array.isArray(stay?.idades)
    ? stay.idades.map(Number).filter((n: number) => !isNaN(n) && n >= 0 && n < 120)
    : [];
  if (!idades.length) return stay;

  stay.adults = (Number(stay.adults) || 0) + idades.filter((i) => i >= 10).length;
  stay.children0_6 = (Number(stay.children0_6) || 0) + idades.filter((i) => i <= 6).length;
  stay.children7_9 = (Number(stay.children7_9) || 0) + idades.filter((i) => i >= 7 && i <= 9).length;
  // Consumidas: uma segunda passagem nao pode somar de novo.
  stay.idades = null;
  return stay;
}


/**
 * Reveillon: estica a estadia para o pacote de 5 diarias.
 *
 * O pacote e de 5 diarias no minimo. Se o hospede pedir menos e o periodo
 * incluir a noite de 31/12, o site NAO mostra disponibilidade - ele conclui que
 * estamos lotados e desiste. Esticamos a saida para completar 5 diarias, para
 * que ele veja os valores, e a Bella explica a regra com naturalidade.
 *
 * Isolada do bookingContext para poder ser testada: a regra estava embutida no
 * meio da montagem do link e nunca tinha sido exercitada com uma data real.
 *
 * Devolve o periodo pedido e o ajustado; `null` quando nao ha o que ajustar.
 */
export function ajustarPacoteReveillon(
  checkin?: string | null,
  checkout?: string | null,
): { noitesPedidas: number; original: string; novaSaida: string } | null {
  if (!checkin || !checkout) return null;
  const entrada = new Date(checkin + 'T12:00:00');
  const saida = new Date(checkout + 'T12:00:00');
  const noites = Math.round((saida.getTime() - entrada.getTime()) / 86400000);

  // A virada esta dentro da estadia? (a noite de 31/12 e a que conta)
  const virada = new Date(`${entrada.getFullYear() + (entrada.getMonth() === 0 ? -1 : 0)}-12-31T12:00:00`);
  const pegaVirada = entrada <= virada && virada < saida;
  if (!pegaVirada || noites <= 0 || noites >= 5) return null;

  const novaSaida = new Date(entrada.getTime() + 5 * 86400000).toISOString().slice(0, 10);
  return { noitesPedidas: noites, original: `${checkin} a ${checkout}`, novaSaida };
}

/**
 * So o que NOS escrevemos na conversa (o avesso de apenasFalasDoHospede).
 */
export function apenasNossasFalas(conversation: string): string {
  const saida: string[] = [];
  let nossa = false;
  for (const linha of (conversation || '').split(/\r?\n/)) {
    if (/^\s*N[óo]s\s*(\(hoje\))?\s*:/i.test(linha)) nossa = true;
    else if (/^\s*H[óo]spede\s*(\(hoje\))?\s*:/i.test(linha)) nossa = false;
    if (nossa) saida.push(linha);
  }
  return saida.join('\n');
}

/** As falas do hospede DEPOIS da nossa ultima mensagem - o pedido de agora. */
export function falasDoHospedeDepoisDaNossa(conversation: string): string {
  const linhas = (conversation || '').split(/\r?\n/);
  let ultimaNossa = -1;
  linhas.forEach((l, i) => { if (/^\s*N[óo]s\s*(\(hoje\))?\s*:/i.test(l)) ultimaNossa = i; });
  return apenasFalasDoHospede(linhas.slice(ultimaNossa + 1).join('\n'));
}

/** As falas do hospede ANTES da nossa ultima mensagem - o que ja foi respondido. */
export function falasDoHospedeAntesDaNossa(conversation: string): string {
  const linhas = (conversation || '').split(/\r?\n/);
  let ultimaNossa = -1;
  linhas.forEach((l, i) => { if (/^\s*N[óo]s\s*(\(hoje\))?\s*:/i.test(l)) ultimaNossa = i; });
  return ultimaNossa < 0 ? '' : apenasFalasDoHospede(linhas.slice(0, ultimaNossa).join('\n'));
}

/**
 * Este orcamento JA foi enviado nesta conversa - e o hospede nao pediu de novo?
 *
 * Caso real (18/09/2026): o link de 12/10 a 18/10 ja tinha ido, o hospede
 * perguntou "Sobre a limpeza se e feita tb nos quartos?", e a sugestao mandou o
 * link DE NOVO e perguntou "qual seria a sua duvida?" - sem responder a duvida.
 * A ordem "envie este link" vinha pronta no contexto e venceu a pergunta real.
 *
 * Reenviar so quando ele pede ("pode me reenviar", "manda o link de novo") -
 * caso de 16/09, em que a hospede voltou no dia seguinte pedindo os valores.
 */
export function orcamentoJaEnviado(conversation: string, checkin: string, checkout: string): boolean {
  const nossas = apenasNossasFalas(conversation);
  const mesmoPeriodo = nossas.includes(`checkin=${checkin}`) && nossas.includes(`checkout=${checkout}`);
  if (!mesmoPeriodo) return false;
  const ultima = ultimaFalaDoHospede(conversation);
  const pedeDeNovo =
    /\b(reenvi|reenv[íi]|manda(r)?\s+(de novo|novamente|o link|os valores)|envia(r)?\s+(de novo|novamente|o link)|de novo|novamente|link|valores?|cota[çc][ãa]o|or[çc]amento|pre[çc]o)\b/i;
  return !pedeDeNovo.test(ultima);
}

/**
 * O hospede citou crianca mas nao disse a idade?
 *
 * A idade decide a categoria no site (0-6 cortesia, 7-9 meia, 10+ adulto).
 * Sem ela, o link sai com as criancas de fora - ou como adultos, se a IA chutar.
 * Caso real (18/09/2026): "3 adultos e 3 criancas" e a sugestao terminou em
 * "Ficamos a disposicao!", sem link e sem perguntar nada: beco sem saida.
 */
export function criancaSemIdade(falasDoHospede: string): boolean {
  const t = mesesViramAnos(semPrefixos(falasDoHospede));
  if (!PALAVRA_DE_CRIANCA.test(t)) return false;
  if (/\b(sem|nenhuma?|n[ãa]o\s+(tem|temos|vai|vao|vão)|sin|no\s+hay)\s+(crian|filh|beb|ni[ñn]|hij|menor|child|kid)/i.test(t)) return false;
  if (/\d{1,2}\s*(?:anos?|años?|years?)\b/i.test(t)) return false;
  // "2 crianças (3/9)": a idade ESTA dita, so nao com a palavra "anos". Sem
  // isto a Bella pedia de volta a idade que a hospede acabara de escrever.
  // "2 crianças" numa mensagem e "1 de 10" na seguinte: a idade ESTA dita, so
  // que em outra linha. Sem isto a ocupacao sai certa e a Bella pede a idade
  // assim mesmo - o link fica preso por um dado que ela ja tem.
  if (idadesEmLinhaSeparada(t).length) return false;
  return !t.split(/\r?\n/).some((linha) => idadesSemAPalavraAnos(linha));
}

/**
 * Quantas vezes JA pedimos esclarecimento nesta conversa.
 *
 * Regra do dono (14/10/2026): quando o hospede nao e claro, a Bella tenta
 * entender; se depois da explicacao dele ela ainda nao entender, passa para
 * atendimento humano. Sem contar as tentativas, ela ficaria repetindo a mesma
 * pergunta em volta - que e justamente o que faz o hospede desistir.
 *
 * Conta so as NOSSAS falas. A primeira mensagem automatica do hotel ja pede os
 * dados, e conta como a primeira tentativa: do ponto de vista do hospede,
 * perguntaram uma vez.
 */
export function tentativasDeEsclarecimento(conversation: string): number {
  const nossas = apenasNossasFalas(conversation || '');
  const pedido =
    /me informe|por gentileza|n[ãa]o entendi|pode (me )?explicar|poderia (me )?esclarecer|me confirme|qual seria|quantas pessoas|per[íi]odo da estadia/i;
  return nossas.split(/\r?\n/).filter((l) => pedido.test(l)).length;
}

/**
 * Ja insistimos o bastante - hora de chamar gente.
 *
 * Duas tentativas: a Bella pergunta, o hospede responde, e se ainda nao deu
 * para entender, insistir uma terceira vez nao melhora nada. Quem resolve
 * ambiguidade de verdade e uma pessoa.
 */
export function devePassarParaHumano(conversation: string): boolean {
  return tentativasDeEsclarecimento(conversation) >= 2;
}


/** O texto que manda a Bella entregar a conversa, respeitando o horario. */
export function contextoDeEntregaAoHumano(dentroDoHorario: boolean): string {
  return (
    `\n\nJÁ PEDIMOS ESCLARECIMENTO DUAS VEZES E AINDA NÃO ENTENDEMOS O PEDIDO. ` +
    `NÃO pergunte de novo: repetir a mesma pergunta pela terceira vez faz o hóspede desistir.\n` +
    `Reconheça, com simpatia e sem culpar ninguém, que é melhor alguém da equipe olhar o caso dele, ` +
    `e diga que está encaminhando para o nosso setor de reservas. NÃO envie link e NÃO tente adivinhar ` +
    `o que ele quis dizer.` +
    blocoDeContato(dentroDoHorario)
  );
}

/**
 * Em que idioma o HOSPEDE escreveu.
 *
 * Caso real (08/09/2026): "Buenas noches! Queria saber que tienen disponible en
 * fechas??" e a Bella respondeu em portugues. A regra de idioma existia, mas
 * quem decidia era o modelo - olhando a conversa INTEIRA, que e dominada pelas
 * NOSSAS mensagens automaticas em portugues. Uma linha em espanhol perdia para
 * dez em portugues escritas por nos.
 *
 * Aqui a decisao sai do modelo e vira codigo, olhando so as falas do hospede.
 */
export function idiomaDoHospede(falasDoHospede: string): 'es' | 'en' | 'pt' {
  const tCru = (falasDoHospede || '').toLowerCase();

  // "Holaaa" nao casava com hola e a hospede recebeu resposta em portugues
  // portugues (25/09/2026). Saudacao esticada e comum no WhatsApp: tres letras
  // iguais ou mais viram uma so antes de procurar os sinais.
  const t = tCru.replace(/(.)\1{2,}/g, '$1');
  if (!t.trim()) return 'pt';

  // Sinais de cada lingua. Vale a pena repetir por que cada palavra esta aqui:
  //
  // - "queria" NAO e sinal de espanhol. Foi o erro que fez a Bella responder em
  //   espanhol a "Queria saber o valor" - portugues comum. So a forma acentuada
  //   "quería" e espanhola, e e ela que entra.
  // - "por favor" e igual nas duas linguas; saiu da lista.
  // - "adultos", "hotel", "reserva", "valor" tambem existem nos dois idiomas.
  //
  // Portugues tambem pontua, e nao so serve de padrao. Sem isso um estrangeirismo
  // solto numa frase inteiramente portuguesa decidia a resposta sozinho.
  const es = [
    /[¿¡ñ]/,
    /\b(hola|buenas|buenos d[ií]as|quer[íi]a|quisiera|habitaci[oó]n|habitaciones)\b/,
    /\b(disponible|disponibilidad|precio|cu[áa]nto|cu[áa]ntas|personas|noches)\b/,
    /\b(gracias|ustedes|tienen|somos|ni[ñn]os|desde el|hasta el)\b/,
    /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/,
  ];
  const en = [
    /\b(hello|hi|good morning|good evening)\b/,
    /\b(available|availability|room|rooms|nights|price|how much|would like|thanks|thank you)\b/,
    /\b(january|february|march|april|june|july|august|september|october|november|december)\b/,
  ];
  const pt = [
    /\b(n[ãa]o|voc[êe]s?|obrigad[oa]|at[ée]|ent[ãa]o|tamb[ée]m)\b/,
    /\b(bom dia|boa tarde|boa noite|por gentileza|tudo bem)\b/,
    /\b(quarto|quartos|di[áa]ria|di[áa]rias|hospedagem|caf[ée] da manh[ãa]|crian[çc]as?)\b/,
    /\b(dispon[íi]vel|disponibilidade|quantas pessoas|pre[çc]o|noites|estacionamento)\b/,
    /\b(janeiro|fevereiro|mar[çc]o|maio|junho|julho|setembro|outubro|novembro|dezembro)\b/,
    /\b(pra|t[áa]|vou|queria|gostaria|seria)\b/,
  ];

  const pontos = (lista: RegExp[]) => lista.filter((r) => r.test(t)).length;
  const pEs = pontos(es);
  const pEn = pontos(en);
  const pPt = pontos(pt);

  // Portugues e a lingua da casa: para responder em outra, ela precisa GANHAR,
  // nao empatar. Um sinal ambiguo isolado nao vira mudanca de idioma.
  if (pEs > pPt && pEs >= pEn) return 'es';
  if (pEn > pPt && pEn > pEs) return 'en';
  return 'pt';
}

/**
 * Como a resposta e escrita - decidido no codigo, com o texto pronto junto.
 *
 * Nao basta dizer "responda em espanhol": o prompt trazia os TRES blocos de
 * abertura e pedia que o modelo escolhesse, e ele pegava o portugues. Caso real
 * (16/09/2026): conversa inteira em espanhol, a Bella ja tinha respondido em
 * espanhol, e a sugestao seguinte comecou com "Olá! Sou a Bella..." - o bloco
 * portugues, copiado literalmente, arrastando a mensagem toda com ele.
 *
 * E a mesma licao que este projeto ja aprendeu tres vezes: texto pronto vence
 * regra escrita longe. Entao entregamos UM bloco so, o do idioma decidido.
 */
export function contextoDeIdioma(falasDoHospede: string): string {
  const idioma = idiomaDoHospede(falasDoHospede);
  if (idioma === 'pt') {
    return (
      `\n\nIDIOMA (JÁ DECIDIDO): o hóspede escreveu em PORTUGUÊS. Responda em português.` +
      `\nSe for se apresentar, use exatamente este bloco:\n---\n${DEFAULT_GREETING}\n---`
    );
  }
  const nome = idioma === 'es' ? 'ESPANHOL' : 'INGLÊS';
  const bloco = idioma === 'es' ? DEFAULT_GREETING_ES : DEFAULT_GREETING_EN;
  return (
    `\n\nIDIOMA (JÁ DECIDIDO): o hóspede escreveu em ${nome}. Responda INTEIRAMENTE em ${nome.toLowerCase()}, ` +
    `da primeira à última palavra — saudação, explicações, despedida. NENHUMA palavra em português.` +
    `\nIgnore o idioma das mensagens automáticas do hotel que aparecem na conversa: elas são nossas, não dele.` +
    `\nSe for se apresentar, use exatamente este bloco e NUNCA a versão em português:\n---\n${bloco}\n---`
  );
}

/**
 * Marcas de cada idioma dentro de um texto.
 *
 * Usada para duas perguntas diferentes: a resposta saiu no idioma certo, e ela
 * MISTUROU idiomas. Uma lista so, para as duas nao divergirem.
 */
export function marcasDeIdioma(texto: string): { pt: number; es: number; en: number } {
  const t = (texto || '').toLowerCase();
  const listas = {
    // Portugues precisa de marcas fortes o bastante para uma resposta limpa nao
    // parecer "fora do idioma" e disparar refacao a toa: nem toda frase tem ç
    // ou ã. "equipe", "atendimento", "feira" e "nosso" nao existem em espanhol
    // (equipo, atención, feria, nuestro).
    pt: [
      /\bol[áa]\b/, /\bvoc[êe]s?\b/, /[çãõ]/, /\b(n[ãa]o|s[ãa]o|est[ãa]o)\b/,
      /\bdisponibilidade\b/, /\bhosp[ée]d/, /\bobrigad/, /\bdi[áa]ria/,
      /\b(equipe|atendimento|feira|nossos?|nossas?|hor[á]rio|apartamentos?)\b/, /(^|[\s,.])[àé]([\s,.]|$)/,
    ],
    // "estadia" e PORTUGUES e a Bella usa em quase toda resposta de orcamento
    // ("para a sua estadia de 14 a 17"). Em espanhol a palavra leva acento:
    // estadía. Aceitar as duas formas fazia toda resposta de orcamento marcar
    // es=1 contra pt=2 e disparar uma REFACAO - uma segunda chamada de IA, de
    // ~1,5s, em boa parte dos atendimentos, para "consertar" um texto que
    // estava certo. Era a causa dos "[pt:2 es:1 en:0]" do diagnostico.
    es: [/[¿¡ñ]/, /ci[óo]n\b/, /\b(hola|buenas|usted|ustedes|gracias|quedamos|enlace|ni[ñn]os?)\b/, /\bdisponibilidad\b/, /\bhabitaci/, /\bestadía\b/, /\ba su disposici/, /\bvalores y\b/],
    en: [/\bhello\b/, /\b(you|your)\b/, /\bavailability\b/, /\broom\b/, /\bplease\b/, /\brates\b/],
  };
  const conta = (lista: RegExp[]) => lista.filter((r) => r.test(t)).length;
  return { pt: conta(listas.pt), es: conta(listas.es), en: conta(listas.en) };
}

/**
 * A resposta saiu no idioma que foi decidido?
 *
 * Conferencia na saida, porque instrucao no prompt ja falhou: o modelo comecava
 * com o bloco portugues numa conversa em espanhol.
 */
export function pareceEscritoEm(texto: string, idioma: 'pt' | 'es' | 'en'): boolean {
  const t = (texto || '').trim();
  if (!t) return true;
  const m = marcasDeIdioma(t);
  const outros = (['pt', 'es', 'en'] as const).filter((i) => i !== idioma).map((i) => m[i]);
  return m[idioma] >= Math.max(...outros);
}

/**
 * A conversa tem algum audio do hospede?
 *
 * So conta marcador em linha DELE: a transcricao de um audio nosso nao
 * autoriza a Bella a dizer que recebeu voz.
 */
export function temAudioDoHospede(conversation: string): boolean {
  return /\[(mensagem de voz|áudio transcrito)/i.test(apenasFalasDoHospede(conversation || ''));
}

/** A frase fala de audio recebido? */
export function fraseFalaDeAudio(frase: string): boolean {
  return /(á|a)udios?\b|mensagens? de voz|nota de voz|mensajes? de voz|voice (message|note)/i.test(frase || '');
}

/**
 * Tira da resposta as frases que afirmam ter recebido audio quando nao houve
 * audio nenhum.
 *
 * Caso real (25/09/2026): a hospede escreveu apenas "Holaaa" e a sugestao
 * comecou com "Olá! Recebi seus áudios." Era a terceira vez que a Bella
 * inventava audio; das outras duas, a causa estava na leitura da tela, e ja
 * foi corrigida. Esta trava e a ultima: mesmo que algo volte a sujar a
 * conversa, a frase nao chega ao hospede.
 *
 * Recorte por FRASE, e nao refacao pelo modelo: gasta cota, demora, e o
 * resultado nao e garantido. "Olá! Recebi seus áudios. Para eu poder..." sem a
 * frase do meio continua uma mensagem inteira.
 */
export function semFraseDeAudioInventada(texto: string, conversation: string): string {
  if (!texto || temAudioDoHospede(conversation)) return texto;
  if (!fraseFalaDeAudio(texto)) return texto;
  const linhas = texto.split(/\r?\n/).map((linha) => {
    const frases = linha.split(/(?<=[.!?])\s+/);
    const ficam = frases.filter((f) => !fraseFalaDeAudio(f));
    // Se a linha inteira falava de audio, ela some; se nao sobrou nada em
    // NENHUMA linha, devolvemos o texto original la embaixo.
    return ficam.join(' ').trim();
  });
  const limpo = linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return limpo || texto;
}

/**
 * A resposta misturou idiomas?
 *
 * Caso real (18/09/2026): hospede brasileiro, resposta inteira em portugues e a
 * despedida em espanhol - "Quedamos a su disposición". A conferencia acima
 * aprovava (portugues dominava) e, pior, nem rodava: eu so checava o idioma
 * quando o hospede NAO era brasileiro. Uma frase estrangeira no fim da mensagem
 * passa despercebida por quem escreve e nao por quem recebe.
 */
export function respostaMisturada(texto: string, idioma: 'pt' | 'es' | 'en'): boolean {
  const t = (texto || '').trim();
  if (!t) return false;
  const m = marcasDeIdioma(t);
  return (['pt', 'es', 'en'] as const).some((i) => i !== idioma && m[i] > 0);
}
/**
 * A frase informa um PRECO?
 *
 * A Bella nunca cota valor - manda o link, e o link mostra o preco real do
 * motor de reservas. Numero em dinheiro na resposta so pode ter vindo de
 * invencao do modelo.
 */

/**
 * Tira da resposta qualquer frase que informe preco.
 *
 * Caso real (13/10/2026): a Bella sugeriu "o valor da diária é de R$ 430,00.
 * Temos disponibilidade para essas datas." Inventou o preco E a
 * disponibilidade - e o valor estava errado. Bastava o atendente clicar em
 * inserir para o hospede receber um orcamento falso do hotel.
 *
 * Por que recorte em codigo e nao instrucao no prompt: a regra de nao cotar
 * preco esta no prompt desde o inicio, e mesmo assim ele cotou. Prompt e
 * pedido; funcao e garantia.
 *
 * Se depois do corte nao sobrar mensagem de pe, devolvemos uma frase segura
 * que aponta para o link - nunca o texto com preco.
 */

/**
 * O que ha de errado com a resposta que o atendente recusou.
 *
 * Clicar em "Sugerir" de novo, sem a conversa ter mudado, e o atendente
 * dizendo que a anterior nao serviu. Pedido do dono em 08/10/2026.
 *
 * O caminho facil seria mandar ao modelo "a anterior estava ruim, tente de
 * novo" - e ele devolveria quase a mesma coisa com outras palavras. Entao
 * primeiro conferimos AQUI o que da para conferir sozinho, e entregamos a
 * falha com nome: faltou o link, inventou audio, saiu em outro idioma. Com a
 * falha concreta na mao, a refacao tem o que consertar.
 *
 * Quando nada e detectado, a lista volta vazia - e o pedido fica sendo "o
 * atendente recusou", que ja e informacao de verdade.
 */
export function criticasDaResposta(
  anterior: string,
  conversation: string,
  linkEsperado?: string | null,
): string[] {
  const criticas: string[] = [];
  const texto = anterior || '';
  if (!texto.trim()) return criticas;

  if (linkEsperado && !/https?:\/\//i.test(texto)) {
    criticas.push(
      'NÃO trazia o link da reserva, mesmo já havendo período e número de pessoas na conversa. ' +
        'Desta vez o link é obrigatório.',
    );
  }

  if (fraseFalaDeAudio(texto) && !temAudioDoHospede(conversation)) {
    criticas.push('Afirmava ter recebido áudio, e o hóspede não mandou áudio nenhum.');
  }

  const idioma = idiomaDoHospede(apenasFalasDoHospede(conversation));
  const nome = idioma === 'es' ? 'espanhol' : idioma === 'en' ? 'inglês' : 'português';
  if (!pareceEscritoEm(texto, idioma)) {
    criticas.push(`Estava no idioma errado: o hóspede escreve em ${nome}.`);
  } else if (respostaMisturada(texto, idioma)) {
    criticas.push(`Misturava idiomas: deveria estar inteira em ${nome}.`);
  }

  // Pergunta de novo o que o hospede ja respondeu. So o caso seguro: a resposta
  // termina perguntando quantas pessoas sao, e a ocupacao ja esta extraida.
  if (/quantas pessoas|quantos h[óo]spedes|quantas seriam/i.test(texto) && /\badultos?=\d/.test(conversation)) {
    criticas.push('Perguntava de novo quantas pessoas são — isso o hóspede já respondeu.');
  }

  return criticas;
}

/**
 * O pedido de refacao que vai junto do prompt.
 *
 * Entregamos o texto recusado INTEIRO. Sem ele o modelo nao tem como evitar
 * repetir o que escreveu - e repetir e o fracasso mais provavel aqui.
 */
export function contextoDeRefacao(anterior: string, criticas: string[]): string {
  if (!anterior || !anterior.trim()) return '';
  const lista = criticas.length
    ? `\nProblemas JÁ identificados nela:\n` + criticas.map((c) => `- ${c}`).join('\n')
    : `\nO atendente não disse o motivo. Procure o que ficou faltando: uma pergunta do hóspede sem resposta, ` +
      `uma informação pela metade, ou uma frase genérica no lugar do que ele pediu.`;
  return (
    `\n\nREFAÇÃO (o atendente RECUSOU a resposta anterior e pediu outra).\n` +
    `Esta foi a resposta recusada, entre as marcas:\n---\n${anterior.trim()}\n---` +
    lista +
    `\n\nEscreva uma resposta DIFERENTE e MELHOR. Não repita a anterior com outras palavras: ` +
    `releia a última pergunta do hóspede e responda o que ela pede, com a informação que falta. ` +
    `Se a anterior estava correta mas incompleta, mantenha o que estava certo e ACRESCENTE o que faltou.`
  );
}

/**
 * "de 21/11 a 23/11, para 1 adulto" - lido do proprio link, nao inventado.
 *
 * O dono pediu que acima do link fosse dito para quem ele e (quantas pessoas,
 * que periodo): o hospede confere antes de clicar. Tirando isso dos parametros
 * da URL que o servidor montou, o resumo nunca diverge do que o link faz.
 */
export function resumoDoLink(url: string, idioma: 'pt' | 'es' | 'en' = 'pt'): string {
  let q: URL;
  try {
    q = new URL(url);
  } catch {
    return '';
  }
  const ci = q.searchParams.get('checkin') || '';
  const co = q.searchParams.get('checkout') || '';
  const ad = Number(q.searchParams.get('adultos-000001') || 0);
  const cr = Number(q.searchParams.get('criancas-000003') || 0) + Number(q.searchParams.get('criancas-000004') || 0);
  if (!ci || !co || !ad) return '';
  const br = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

  const p = {
    pt: { de: 'de', a: 'a', para: 'para', ad: ad === 1 ? 'adulto' : 'adultos', cr: cr === 1 ? 'criança' : 'crianças', e: 'e' },
    es: { de: 'del', a: 'al', para: 'para', ad: ad === 1 ? 'adulto' : 'adultos', cr: cr === 1 ? 'niño' : 'niños', e: 'y' },
    en: { de: 'from', a: 'to', para: 'for', ad: ad === 1 ? 'adult' : 'adults', cr: cr === 1 ? 'child' : 'children', e: 'and' },
  }[idioma];
  const gente = `${ad} ${p.ad}` + (cr ? ` ${p.e} ${cr} ${p.cr}` : '');
  return `${p.de} ${br(ci)} ${p.a} ${br(co)}, ${p.para} ${gente}`;
}

/**
 * O hospede deu ALGUM sinal de data, mesmo que a gente nao consiga montar?
 *
 * Existe para proteger a resposta sem IA de um erro especifico: pedir de novo
 * o que ele ja disse. Em 11/09/2026 o hospede escreveu "do dia 21 a 23" e
 * depois "Novembro"; o leitor nao juntou as duas coisas, concluiu que nao havia
 * periodo, e a Bella respondeu pedindo a data. Perguntar o que ja foi
 * respondido e o que mais irrita quem esta do outro lado.
 *
 * Aqui a pergunta e mais frouxa de proposito: nao "da para montar?", mas "tem
 * cara de data?". Se tiver, e nao conseguimos montar, a resposta pronta nao
 * sai - melhor o atendente escrever.
 */
export function temIndicioDeData(falasDoHospede: string): boolean {
  const t = falasDoHospede || '';
  return (
    /\bdias?\s*\d{1,2}\b/i.test(t) ||
    /\b\d{1,2}\s*\/\s*\d{1,2}\b/.test(t) ||
    /\b\d{1,2}\s*(?:de\s*)?(?:jan|fev|mar[cç]o|abr|maio|junh|julh|agos|set|outu|nove|dez)/i.test(t) ||
    /\b(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i.test(t) ||
    /\b(hoje|amanh[ãa]|fim de semana|final de semana|feriado|natal|ano novo|r[ée]veillon|carnaval|p[áa]scoa)\b/i.test(t)
  );
}

/**
 * A resposta que a casa daria, escrita sem IA nenhuma.
 *
 * Existe para o caso em que o modelo esta fora do ar - hoje, quase sempre por
 * cota - e a pergunta e a mais comum do atendimento: "gostaria de reservar um
 * quarto pra 2 pessoas?", sem dizer quando. A resposta certa ai nao tem nada de
 * criativo: e pedir periodo, quantidade e idades, exatamente como a propria
 * mensagem automatica do hotel ja pede.
 *
 * Caso real (10/09/2026): a IA caiu, a sugestao veio vazia e o hospede ficou
 * sem resposta - quando bastava pedir a data.
 *
 * NAO tenta cobrir o resto. Duvida sobre cafe, pet ou estacionamento continua
 * exigindo o modelo: inventar texto pronto para tudo seria trocar "sem
 * resposta" por "resposta errada", que e pior.
 */
export function respostaSemIA(reserva: string, conversation: string): string {
  // VARIOS links prontos (um por apartamento ou um por periodo), cada um ja
  // rotulado pelo servidor ("Apartamento 1 — 3 adultos:" / "08/11 a 14/11:").
  //
  // Caso real (22/10/2026): 7 pessoas, "3 em um apto / 4 em outro", os dois
  // links montados no codigo - e a IA congestionada (503). A recepcao recebeu
  // so "A IA nao respondeu". A mensagem de orcamento continua sendo sempre a
  // mesma; o que muda e a lista. Com "todos juntos" ainda em aberto a escolha
  // precisa do modelo, e ai nao sai.
  const porApto = (reserva || '').includes('UM LINK PARA CADA');
  const porPeriodo = (reserva || '').includes('PERÍODOS DIFERENTES. Monte um orçamento para CADA');
  if ((porApto || porPeriodo) && !(reserva || '').includes('NÃO DEIXOU CLARO')) {
    const itens = [...(reserva || '').matchAll(/^([^\n:]{3,80}):\r?\n(https?:\/\/\S+)/gm)].map((m) => ({
      rotulo: m[1].trim(),
      url: m[2].replace(/[),.]+$/, ''),
    }));
    if (itens.length >= 2) {
      const idiomaV = idiomaDoHospede(apenasFalasDoHospede(conversation));
      const tv = {
        pt: {
          oi: 'Olá! Sou a Bella, assistente online do Hotel do Bosque.',
          link: porApto
            ? 'Segue o link de cada apartamento, já com os valores e a disponibilidade. Por eles você consegue concluir a reserva:'
            : 'Segue o link de cada período, já com os valores e a disponibilidade, considerando as mesmas pessoas em todos. Por eles você consegue concluir a reserva:',
          fim: 'Qualquer dúvida, estou à disposição!',
        },
        es: {
          oi: '¡Hola! Soy Bella, asistente online del Hotel do Bosque.',
          link: porApto
            ? 'Aquí tiene el enlace de cada apartamento, con los valores y la disponibilidad. Por ellos puede concluir su reserva:'
            : 'Aquí tiene el enlace de cada período, con los valores y la disponibilidad, considerando las mismas personas en todos. Por ellos puede concluir su reserva:',
          fim: '¡Cualquier duda, estoy a su disposición!',
        },
        en: {
          oi: "Hello! I'm Bella, the Hotel do Bosque online assistant.",
          link: porApto
            ? 'Here is the link for each apartment, with rates and availability. You can complete your booking right there:'
            : 'Here is the link for each period, with rates and availability, for the same guests in all of them. You can complete your booking right there:',
          fim: "If you have any questions, I'm here to help!",
        },
      }[idiomaV];
      const jaApresentouV = /JÁ se apresentou/.test(contextoDeApresentacao(conversation));
      const blocos = itens.map((it) => `${it.rotulo}:\n${it.url}`);
      return [...(jaApresentouV ? [] : [tv.oi, '']), tv.link, '', blocos.join('\n\n'), '', tv.fim].join('\n');
    }
  }

  // Link JA montado pelo servidor, mas o modelo nao escreveu a mensagem.
  //
  // Com a leitura de datas sem IA, o caso mais comum chega aqui com o link
  // certo em maos - e ficava sem resposta so porque a REDACAO precisava do
  // modelo. A mensagem de orcamento, porem, e sempre a mesma: o que o link
  // cobre e onde clicar. So para UM link: com varios apartamentos a
  // explicacao de cada um exige o modelo.
  const marcaLink = 'RESERVA: envie ESTE link';
  const j = (reserva || '').indexOf(marcaLink);
  if (j >= 0) {
    const links = (reserva.slice(j).match(/https?:\/\/\S+/g) || []).map((u) => u.replace(/[),.]+$/, ''));
    if (links.length !== 1) return '';
    const idiomaL = idiomaDoHospede(apenasFalasDoHospede(conversation));
    const resumo = resumoDoLink(links[0], idiomaL);
    const t = {
      pt: {
        oi: 'Olá! Sou a Bella, assistente online do Hotel do Bosque.',
        link: `Segue o link com os valores e a disponibilidade ${resumo ? resumo + '. ' : 'para o seu período. '}Por ele você já consegue concluir a sua reserva:`,
        fim: 'Qualquer dúvida, estou à disposição!',
      },
      es: {
        oi: '¡Hola! Soy Bella, asistente online del Hotel do Bosque.',
        link: `Aquí tiene el enlace con los valores y la disponibilidad ${resumo ? resumo + '. ' : 'para su período. '}Por él ya puede concluir su reserva:`,
        fim: '¡Cualquier duda, estoy a su disposición!',
      },
      en: {
        oi: "Hello! I'm Bella, the Hotel do Bosque online assistant.",
        link: `Here is the link with rates and availability ${resumo ? resumo + '. ' : 'for your stay. '}You can complete your booking right there:`,
        fim: "If you have any questions, I'm here to help!",
      },
    }[idiomaL];
    const jaApresentou = /JÁ se apresentou/.test(contextoDeApresentacao(conversation));
    return [...(jaApresentou ? [] : [t.oi, '']), t.link, '', links[0], '', t.fim].join('\n');
  }

  const marca = 'RESERVA: faltam dados para gerar o link. Peça ao hóspede APENAS: ';
  const i = (reserva || '').indexOf(marca);
  if (i < 0) return '';

  const pedidos = (reserva || '').slice(i + marca.length).split('.')[0];
  const falta = (campo: string) => pedidos.includes(campo);
  // Pedir data que ele ja deu, so porque nao conseguimos monta-la, e o erro
  // que esta resposta pronta mais pode cometer. Com cara de data na fala, nao sai.
  if ((falta('data de entrada') || falta('data de saída')) && temIndicioDeData(apenasFalasDoHospede(conversation))) {
    return '';
  }
  const idioma = idiomaDoHospede(apenasFalasDoHospede(conversation));

  const textos = {
    pt: {
      saudacao: 'Olá! Sou a Bella, assistente online do Hotel do Bosque.',
      pedido: 'Para eu preparar o seu orçamento, me informe por gentileza:',
      data: '📅 Período da estadia (data de entrada e saída)',
      pessoas: '👥 Quantidade total de pessoas',
      criancas: '🧒 Caso tenha crianças, as idades',
      fim: 'Assim que me passar esses dados, envio o link com os valores e a disponibilidade.',
    },
    es: {
      saudacao: '¡Hola! Soy Bella, asistente online del Hotel do Bosque.',
      pedido: 'Para preparar su presupuesto, por favor infórmeme:',
      data: '📅 Período de la estadía (fecha de entrada y salida)',
      pessoas: '👥 Cantidad total de personas',
      criancas: '🧒 Si viajan niños, las edades',
      fim: 'Con esos datos le envío el enlace con los valores y la disponibilidad.',
    },
    en: {
      saudacao: "Hello! I'm Bella, the Hotel do Bosque online assistant.",
      pedido: 'To prepare your quote, could you please tell me:',
      data: '📅 Dates of your stay (check-in and check-out)',
      pessoas: '👥 Total number of guests',
      criancas: '🧒 If children are coming, their ages',
      fim: 'With that, I can send you the link with rates and availability.',
    },
  };

  const x = textos[idioma];
  // Nao se apresenta duas vezes no mesmo dia: a mesma regra do caminho normal.
  const jaSeApresentou = /JÁ se apresentou/.test(contextoDeApresentacao(conversation));
  const linhas = jaSeApresentou ? [x.pedido, ''] : [x.saudacao, '', x.pedido, ''];
  if (falta('data de entrada') || falta('data de saída')) linhas.push(x.data);
  if (falta('quantidade de adultos')) linhas.push(x.pessoas);
  linhas.push(x.criancas, '', x.fim);
  return linhas.join('\n');
}

/**
 * A Bella deve se apresentar nesta mensagem?
 *
 * O modelo vê a conversa mas não sabe se já se apresentou, então repetia
 * "Olá, sou a Bella, assistente online..." em TODA resposta — o que soa
 * robótico numa conversa em andamento. Aqui a decisão é tomada no código e
 * entregue pronta ao prompt.
 */
export function contextoDeApresentacao(conversation: string): string {
  const texto = conversation || '';
  const APRESENTACAO = /sou a bella|assistente (online|virtual)/i;

  // A apresentação se repete A CADA DIA, por regra do hotel. O scraper marca as
  // mensagens do dia corrente com "(hoje)" — ex.: "Nós (hoje): ...".
  //
  // A pergunta certa é UMA só: já nos apresentamos HOJE? Se sim, não repete. Em
  // qualquer outro caso — inclusive quando não há NENHUMA mensagem de hoje, que
  // é justamente o primeiro contato do dia — ela se apresenta.
  //
  // A versão anterior tinha um caminho alternativo que, ao não encontrar marcas
  // de "(hoje)", concluía "conversa em andamento, não se apresente". Numa
  // conversa cuja última mensagem era de ontem isso zerava a apresentação do
  // dia — exatamente o contrário da regra.
  const jaSeApresentouHoje = texto
    .split('\n')
    .filter((l) => /^\s*N[óo]s\s*\(hoje\)\s*:/i.test(l))
    .some((l) => APRESENTACAO.test(l));

  if (jaSeApresentouHoje) {
    return (
      `\n\nAPRESENTAÇÃO: você JÁ se apresentou a este contato hoje. ` +
      `NÃO se apresente de novo, NÃO comece com "Olá, sou a Bella..." nem repita seu cargo. ` +
      `Responda direto ao que foi perguntado, como quem continua um papo.`
    );
  }

  return (
    `\n\nAPRESENTAÇÃO: esta é a PRIMEIRA resposta a este contato HOJE — mesmo que a conversa venha ` +
    `de ontem ou de dias anteriores, e mesmo que a equipe já tenha respondido antes. ` +
    `Comece OBRIGATORIAMENTE com "Olá! Sou a Bella, assistente online do Hotel do Bosque." numa linha, ` +
    `pule uma linha e então responda o que foi perguntado. Não pule essa linha por achar que a conversa já está em andamento.`
  );
}

/**
 * Co-piloto do atendente (extensão do WhatsApp Web): sugere uma resposta a
 * partir do texto da conversa, SEM enviar nada e SEM criar registros. O humano
 * revisa e envia. Não há automação de envio — risco de ban praticamente nulo.
 */
@Controller('assist')
export class AssistController implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: ModelRouterService,
    private readonly knowledge: KnowledgeService,
    private readonly policies: PoliciesService,
    private readonly reservations: ReservationEngineService,
    private readonly disponibilidade: SilbeckAvailabilityService,
    private readonly orquestrador: BellaOrchestratorService,
  ) {}

  /**
   * Empresta a leitura do pedido ao caminho automatico (Instagram, Facebook,
   * WhatsApp oficial): os dois caminhos usam o MESMO bookingContext, entao
   * toda correcao feita aqui vale tambem para quem responde sem revisao.
   * Pedido do dono em 21/10/2026. Ver definirLeitorDoPedido no orquestrador.
   */
  onModuleInit() {
    this.orquestrador.definirLeitorDoPedido((conversa) => this.bookingContext(conversa));
  }

  /**
   * Anexos que combinam com o que o hóspede perguntou (regras de pets, catálogo
   * de ingressos). Casamento por palavra-chave, não por IA: é previsível, não
   * gasta chamada e o dono controla exatamente o que dispara cada arquivo.
   */
  private async anexosRelevantes(texto: string, hotelId: string) {
    const alvo = normalizar(texto);
    const todos = await this.prisma.attachment.findMany({
      where: { hotelId, active: true },
      select: { id: true, title: true, mimeType: true, keywords: true },
    });
    return todos
      .filter((a) =>
        a.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
          .some((k) => alvo.includes(k)),
      )
      .map((a) => ({ id: a.id, title: a.title, mimeType: a.mimeType }));
  }

  /**
   * O papel da Bella é ENVIAR O LINK do site para o hóspede reservar sozinho —
   * ela não fecha reserva nem cota preço. Extrai datas/ocupação da conversa e,
   * quando estiverem completas, monta o link do motor oficial. Se faltar algo,
   * instrui a pedir APENAS o que falta (sem prometer verificar valores).
   */
  /**
   * Extracao guardada por 2 minutos.
   *
   * A resposta pode precisar de duas passagens: a primeira descobre as datas, a
   * extensao consulta a disponibilidade no Silbeck (o servidor e barrado pelo
   * Cloudflare) e chama de novo. Sem este cache, a mesma conversa pagaria duas
   * chamadas de IA so para extrair os mesmos dados.
   */
  /**
   * As licoes aprovadas, em memoria.
   *
   * Entram em TODA sugestao, entao buscar no banco a cada pedido custaria uma
   * ida a mais no caminho critico - e a Bella ja demorava. O cache e invalidado
   * quando alguem aprova ou recusa algo, e expira sozinho em 10 minutos para o
   * caso de a edicao vir de outra instancia.
   */
  private licoesCache: { texto: string; ts: number } | null = null;

  private async contextoDasLicoes(hotelId: string): Promise<string> {
    if (this.licoesCache && Date.now() - this.licoesCache.ts < 600000) {
      return this.licoesCache.texto;
    }
    const aprovadas = await this.prisma.licao.findMany({
      where: { hotelId, status: 'aprovada' },
      orderBy: { exemplos: 'desc' },
      take: 40,
    });
    const cabecalho =
      '\n\nAPRENDIDO NO ATENDIMENTO (corrigido por gente da casa, vale mais que suposição):\n';
    const texto = aprovadas.length
      ? cabecalho + aprovadas.map((l) => '- ' + l.texto).join('\n')
      : '';
    this.licoesCache = { texto, ts: Date.now() };
    return texto;
  }

  /**
   * Por que a ultima resposta saiu (ou nao saiu) com link.
   *
   * Tres vezes seguidas a Bella prometeu valores e nao mandou link, e as tres
   * vezes eu tive que adivinhar qual ramo tinha barrado. Adivinhar custa um dia
   * de atendimento. Aqui cada saida de bookingContext deixa registrado o motivo
   * e o que foi extraido - sem nada do hospede, so o que a decisao usou.
   *
   * Memoria de processo, como o diagnostico da IA: some no restart, e o que
   * interessa e o que esta acontecendo agora.
   */
  private readonly decisoesLink: {
    quando: string;
    motivo: string;
    checkin?: string | null;
    checkout?: string | null;
    adultos?: number | null;
    criancas?: unknown;
    intent?: string | null;
    semIA?: boolean;
  }[] = [];

  /**
   * Grava a medicao no banco, sem segurar a resposta ao hospede.
   *
   * Sem await de proposito: se o banco estiver lento ou fora, o hospede nao
   * pode esperar por causa de um registro de diagnostico. O catch vazio e
   * deliberado - perder uma medicao e aceitavel, atrasar um atendimento nao.
   *
   * Os numeros do motivo viram N para que "3 pessoas" e "8 pessoas" contem
   * como o MESMO motivo na hora de somar; senao cada caso vira uma categoria
   * e o agrupamento nao diz nada.
   */
  private gravarDiagnostico(tipo: string, motivo: string, extras: { canal?: string; ms?: number; detalhe?: string } = {}) {
    const generico = String(motivo || '').replace(/\d+/g, 'N').slice(0, 120);
    this.prisma.diagnostico
      .create({
        data: {
          tipo,
          motivo: generico,
          canal: extras.canal ?? null,
          ms: extras.ms ?? null,
          detalhe: extras.detalhe ? String(extras.detalhe).slice(0, 180) : null,
        },
      })
      .catch(() => {});
  }

  private registrarDecisao(motivo: string, stay: any = {}) {
    this.gravarDiagnostico('decisao', motivo);
    this.decisoesLink.push({
      quando: new Date().toISOString(),
      motivo,
      checkin: stay.checkin ?? null,
      checkout: stay.checkout ?? null,
      adultos: stay.adults ?? null,
      criancas: stay.children ?? null,
      intent: stay.intent ?? null,
      // leu sem gastar chamada de IA? serve para medir a economia
      semIA: Boolean(stay.semIA),
    });
    // 20 decisoes cobriam menos de uma hora de movimento - nao dava para ver
    // padrao nenhum. 300 cabem numa semana e continuam sendo so motivo e
    // numeros, sem texto de conversa.
    if (this.decisoesLink.length > 300) this.decisoesLink.shift();
  }

  /**
   * De onde veio cada sugestao: versao da extensao e o que ela achou que era
   * audio.
   *
   * Duas vezes a Bella respondeu "Recebi seus audios" sem audio nenhum, e na
   * segunda nao havia como saber o que tinha sido confundido - nem se aquela
   * maquina estava com a extensao atualizada. Aqui fica a prova: nenhum texto
   * do hospede, so a versao e o nome do atributo que disparou a deteccao.
   */
  /** Tempo das etapas das ultimas sugestoes (ms). So numeros, nenhum texto. */
  private readonly tempos: Record<string, number | string>[] = [];

  private readonly clientes: {
    quando: string;
    versao: string | null;
    sinaisAudio: string[];
    marcadorDeAudioNaConversa: boolean;
    fontesDirecao?: Record<string, number>;
    historico?: { fonte: string; naTela: number; guardadas: number };
    formato?: Record<string, number | boolean>;
  }[] = [];

  private readonly extracaoCache = new Map<string, { stay: any; ts: number }>();

  /**
   * Marca de que a extracao NAO rodou - diferente de "o hospede nao informou".
   *
   * Quando a cota estoura, completeMock devolve {intent:'other'} sem dado
   * nenhum: identico a uma conversa em que o hospede nao disse nada. O codigo
   * nao distinguia "nao sei" de "nao informou", seguia como se o hospede fosse
   * omisso e a redacao - que um instante depois ja pegava outra janela de
   * minuto - escrevia uma mensagem confiante SEM link. Foi essa confusao que
   * gerou as tres promessas vazias de 08 e 09/09/2026, todas em conversas em
   * que o hospede tinha informado data e ocupacao.
   */
  private static readonly EXTRACAO_INDISPONIVEL = '__extracao_indisponivel__';
  /** Vai no contexto so quando o sistema CONFIRMOU vaga para o periodo. */
  private static readonly MARCA_VAGA_CONSULTADA =
    'VAGA CONFIRMADA: o sistema de reservas foi consultado agora e há apartamentos para este período.';

  private async extrair(conversation: string): Promise<any> {
    const chave = createHash('sha256').update(conversation).digest('hex').slice(0, 16);
    const guardado = this.extracaoCache.get(chave);
    if (guardado && Date.now() - guardado.ts < 600000) return guardado.stay;
    const today = new Date().toISOString().slice(0, 10);
    const extraction = await this.ai.complete({
      task: 'booking_extraction',
      system:
        `Extraia os dados de hospedagem mencionados pelo hóspede. Hoje é ${today}. ` +
        `Converta datas relativas (ex.: "próximo fim de semana") para YYYY-MM-DD no ano correto.`,
      messages: [{ role: 'user', content: conversation }],
      temperature: 0,
      tools: [STAY_EXTRACTION_TOOL],
    });

    // Nao guardamos em cache o que nao foi extraido: seria congelar por dez
    // minutos a ignorancia de um segundo.
    if (extraction.model === 'mock') {
      return { [AssistController.EXTRACAO_INDISPONIVEL]: true };
    }

    const extraido: any = extraction.toolInput ?? {};
    // Poda antes de guardar: o cache tinha uma entrada por conversa distinta e
    // NUNCA saia nada dele. Numa instancia gratuita de 512 MB que fica semanas
    // sem reiniciar, isso cresce sozinho. Entradas vencidas nao servem para
    // nada mesmo - o proprio get ja as ignora.
    if (this.extracaoCache.size > 200) {
      const limite = Date.now() - 600000;
      for (const [k, v] of this.extracaoCache) {
        if (v.ts < limite) this.extracaoCache.delete(k);
      }
      // Ainda grande depois de tirar as vencidas: descarta as mais antigas.
      if (this.extracaoCache.size > 200) {
        const porIdade = [...this.extracaoCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
        for (const [k] of porIdade.slice(0, this.extracaoCache.size - 200)) {
          this.extracaoCache.delete(k);
        }
      }
    }
    this.extracaoCache.set(chave, { stay: extraido, ts: Date.now() });
    return extraido;
  }

  private async bookingContext(conversation: string, htmlDisponibilidade?: string): Promise<string> {
    // Sem nenhum sinal de estadia na fala do hospede, nao ha o que extrair:
    // poupa uma chamada de IA por sugestao (ver pareceOrcamento).
    //
    // Quando a conversa vem SEM autoria (caminho cru do leitor), as falas do
    // hospede saem vazias e a triagem concluiria que ninguem falou de estadia -
    // calando a resposta justamente quando ela mais importa. Nesse caso a
    // triagem olha a conversa inteira: errar para o lado de gastar a chamada e
    // barato; errar para o outro e o hospede sem orcamento.
    //
    // As travas de data e ocupacao NAO seguem por aqui: aquelas continuam
    // exigindo fala do hospede, porque validar uma data usando texto que NOS
    // escrevemos foi o erro que gerou datas inventadas.
    const falasParaTriagem = temAutoria(conversation)
      ? apenasFalasDoHospede(conversation)
      : conversation;

    // TRAVOU NO SITE: entrega a uma pessoa, antes de qualquer outra coisa.
    //
    // Decisao do dono em 20/10/2026. "Nao aparece disponibilidade" ou "o link
    // nao abre" e o contato mais quente que existe: ele JA decidiu reservar e
    // esbarrou num obstaculo. Insistir no link ali e a pior resposta, e o
    // hospede desiste em silencio.
    //
    // E a Bella nao tem como conferir sozinha: do servidor o Cloudflare
    // bloqueia a consulta ao Silbeck (403, confirmado em producao hoje), e no
    // Reveillon o site realmente nao mostra nada com menos de 5 diarias. Entao
    // ela nao discute e nao adivinha - passa para quem abre o sistema e olha.
    //
    // Vem antes de tudo de proposito: nao adianta montar link para quem acabou
    // de dizer que o link nao funcionou.
    if (hospedeTravouNoSite(ultimaFalaDoHospede(conversation))) {
      this.registrarDecisao('hospede travou no site: entregar a uma pessoa', {});
      return (
        `\n\nO HÓSPEDE DISSE QUE NÃO CONSEGUIU: ou não apareceu disponibilidade, ou o link não abriu.\n` +
        `NÃO mande o link de novo e NÃO insista que ele tente outra vez — ele já tentou. ` +
        `NÃO afirme que há ou que não há vaga: você não consultou o sistema e não tem como saber.\n` +
        `Reconheça o que aconteceu em uma frase, pergunte se ele tem interesse em OUTRAS DATAS ` +
        `(muitas vezes é um único dia lotado no meio do período, e mudar a entrada ou a saída resolve) ` +
        `e diga que vai passar para a nossa equipe de reservas verificar no sistema.` +
        contextoDeEntregaAoHumano(isWithinBusinessHours())
      );
    }

    // PEDIU UMA PESSOA, no que disse por ultimo: entrega antes de tudo.
    //
    // A mesma regra existia mais abaixo, mas depois do "faltam dados": quem
    // pedia atendente sem ter dito datas recebia de volta o pedido de periodo
    // e pessoas (pergunta do dono, 26/10/2026). Aqui olha so o que ele disse
    // depois da nossa ultima mensagem - um pedido antigo, ja atendido, nao
    // pode prender a conversa para sempre.
    if (hospedePediuAtendente(falasDoHospedeDepoisDaNossa(conversation) || ultimaFalaDoHospede(conversation))) {
      this.registrarDecisao('hospede pediu atendente: entregar contato', {});
      return (
        `\n\nO HÓSPEDE PEDIU PARA FALAR COM UMA PESSOA. NÃO insista, NÃO tente responder a dúvida ` +
        `você mesma, NÃO peça dados e NÃO envie link. Reconheça o pedido com simpatia e encaminhe.` +
        blocoDeContato(isWithinBusinessHours())
      );
    }

    // RESERVA JA FEITA que o hospede quer mudar: quem ajusta e a equipe.
    // Ver alteracaoDeReservaExistente. Nao e orcamento novo: nada de link nem
    // de pedir datas de novo.
    if (
      alteracaoDeReservaExistente(
        falasParaTriagem,
        falasDoHospedeDepoisDaNossa(conversation) || ultimaFalaDoHospede(conversation),
      )
    ) {
      this.registrarDecisao('alteracao de reserva ja feita: entregar a equipe', {});
      return (
        `\n\nO HÓSPEDE JÁ TEM UMA RESERVA e quer ALTERAR (incluir pessoa, mudar datas ou outro ajuste).\n` +
        `NÃO envie link, NÃO peça datas nem quantidade de pessoas como se fosse um orçamento novo.\n` +
        `Se ele quer INCLUIR alguém: diga que é possível, desde que o apartamento não passe de 6 pessoas no total. ` +
        `Em seguida diga que, para fazer o ajuste, vai passar para a nossa equipe de reservas, que atualiza a reserva ` +
        `no sistema e informa o ajuste de valores, se houver. NÃO informe valores e NÃO diga que já alterou nada.\n` +
        `Para outra alteração, confirme em uma frase o que ele pediu e passe para a equipe do mesmo jeito.` +
        contextoDeEntregaAoHumano(isWithinBusinessHours())
      );
    }

    // RESERVA EM ANDAMENTO: a conversa ja esta em pagamento/confirmacao.
    //
    // Analise de 26/10/2026: depois de "Solicitacao de reserva realizada!",
    // comprovante, voucher ou "PAGAMENTO CONFIRMADO", a Bella seguia pedindo
    // periodo e pessoas, ou mandava link de orcamento novo - a recepcao jogava
    // fora. Nessa fase so cabe responder a duvida; o resto e com a equipe.
    // Periodo NOVO pedido depois da nossa ultima mensagem continua sendo
    // orcamento novo.
    if (
      reservaEmAndamento(apenasNossasFalas(conversation)) &&
      !intervalosNaFala(falasDoHospedeDepoisDaNossa(conversation)).length
    ) {
      this.registrarDecisao('reserva em andamento: nao pedir dados nem mandar link', {});
      return (
        `\n\nRESERVA EM ANDAMENTO: esta conversa já está na fase de pagamento/confirmação da reserva com a nossa equipe ` +
        `(solicitação feita, comprovante, voucher ou pagamento).\n` +
        `NÃO peça período nem quantidade de pessoas e NÃO envie link de orçamento.\n` +
        `Se ele fez uma pergunta sobre o hotel, responda com a base de conhecimento, em poucas linhas. ` +
        `Se for sobre pagamento, comprovante, voucher, valor ou alteração, diga numa frase que quem cuida disso é a ` +
        `nossa equipe de reservas, que responde por aqui. NÃO diga que ela "já está verificando" nem que algo foi ` +
        `conferido: você não sabe disso.` +
        contextoDeEntregaAoHumano(isWithinBusinessHours())
      );
    }

    // Antes de gastar chamada: a frase se le sozinha?
    //
    // "10/10 a 12/10 / 2 adultos" nao precisa de modelo. Isso corta a maior
    // consumidora do teto de 20 requisicoes por minuto - e, de quebra, torna o
    // caso mais comum imune a 429.
    const semIA = extrairDeterminista(apenasFalasDoHospede(conversation));
    const stay: any = semIA
      ? semIA
      : pareceOrcamento(falasParaTriagem)
        ? await this.extrair(conversation)
        : {};

    // A data que ele escreveu nao fecha? Entao peca para CONFIRMAR, e nao
    // pergunte como se ele nao tivesse dito nada.
    //
    // Caso real (19/10/2026): "dia 31 a dia 1 dezembro" - novembro nao tem 31,
    // a leitura virou um periodo de 335 diarias e foi descartada. Sem este
    // aviso a Bella pediria "o periodo da estadia" do zero, como se ele
    // estivesse em silencio - e ele acabou de dar duas datas.
    const diagPeriodo = { descartadosPorDuracao: 0 };
    intervalosNaFala(apenasFalasDoHospede(conversation), new Date(), diagPeriodo);
    if (diagPeriodo.descartadosPorDuracao > 0 && !stay.checkin) stay.dataImpossivel = true;
    // Tem dados de estadia? Entao e orcamento, qualquer que seja o rotulo.
    //
    // Caso real: "preciso saber o valor total das diarias para check in sexta
    // (28/08) e check out segunda. Para casal". O extrator classificou como
    // 'question' (ele pediu um VALOR), o link nunca foi montado e a Bella
    // improvisou mandando o endereco generico do site - sem datas, sem pessoas.
    // Perguntar o preco de um periodo E pedir orcamento.
    // A extracao nao rodou (cota, rede). Nao da para tratar como "o hospede nao
    // informou": ele pode ter informado tudo. Sem esse dado, qualquer resposta
    // sobre valores sai errada - entao a sugestao inteira falha, honestamente,
    // e quem atende tenta de novo em segundos.
    if (stay[AssistController.EXTRACAO_INDISPONIVEL]) {
      this.registrarDecisao('extracao indisponivel (IA sem resposta)', {});
      throw new Error(AssistController.EXTRACAO_INDISPONIVEL);
    }

    const temDadosDeEstadia = Boolean(stay.checkin && stay.checkout && stay.adults);
    // Sem dados suficientes para o link.
    //
    // Antes esta saida era MUDA: devolvia string vazia e o modelo, sem nenhuma
    // instrucao sobre reserva, improvisava - "voce pode verificar os valores e
    // fazer sua reserva pelo nosso site:" e nada embaixo. Tres vezes seguidas
    // (08 e 09/09/2026) o hospede ficou olhando para uma promessa vazia.
    //
    // Se o hospede claramente falou de estadia mas a extracao nao fechou os
    // tres dados, o silencio e o pior conselho possivel: agora dizemos o que
    // NAO fazer e o que pedir.
    if (stay.intent !== 'booking' && !temDadosDeEstadia) {
      if (!pareceOrcamento(falasParaTriagem)) {
        this.registrarDecisao(temAutoria(conversation) ? 'sem assunto de estadia' : 'sem assunto de estadia (conversa sem autoria)', stay);
        return '';
      }
      // Ja tentamos entender duas vezes: quem resolve ambiguidade e gente.
      if (devePassarParaHumano(conversation)) {
        this.registrarDecisao('passou para humano: 2 pedidos de esclarecimento sem entender', stay);
        return contextoDeEntregaAoHumano(isWithinBusinessHours());
      }
      // Pergunta sobre REGRA, sem data nem ocupacao: responda da base, nao peca
      // os dados.
      //
      // Caso real (15/10/2026): "Vamos chegar por volta das 23:30. Seria uma
      // estadia ate no outro dia as 23:30?" A palavra "estadia" fazia isso
      // parecer pedido de orcamento e a Bella pediria periodo e quantidade de
      // pessoas - quando o hospede queria entender como funciona a diaria.
      // Quem explicou foi o atendente, na mao.
      if (duvidaSobreRegra(falasParaTriagem, false)) {
        this.registrarDecisao('duvida sobre regra: responder da base, sem pedir dados', stay);
        return (
          `\n\nO HÓSPEDE FEZ UMA PERGUNTA sobre como as coisas funcionam, e NÃO pediu orçamento. ` +
          `Responda a pergunta usando a base de conhecimento. NÃO peça período, quantidade de pessoas ` +
          `nem idades, e NÃO mande link de reserva — ele não pediu valores. ` +
          `Se depois ele quiser orçamento, aí sim você pede o que falta.\n` +
          `TAMANHO: no MÁXIMO 3 linhas. A recepção reescreve 8 de cada 10 respostas suas, e a correção ` +
          `quase sempre é ENCURTAR — ou seja, você está escrevendo mais do que o hóspede quer ler. ` +
          `Responda o que foi perguntado e pare. Nada de introdução ("que ótima pergunta"), nada de ` +
          `repetir a pergunta antes de responder, nada de resumo no fim.\n` +
          `VENDA, sem excesso: depois da resposta, UMA frase curta que puxe para a reserva — e só uma. ` +
          `Se ele já tem o link, lembre que por ele conclui a reserva; se ainda não falou de datas, ` +
          `ofereça montar o orçamento. Nunca duas frases de venda, nunca insistir, nunca repetir o ` +
          `convite que você já fez na mensagem anterior.`
        );
      }

      this.registrarDecisao('dados incompletos apesar de falar de estadia', stay);
      return (
        `\n\nSEM LINK NESTA MENSAGEM: não consegui montar o link porque falta dado do período ou da ocupação. ` +
        `NÃO prometa link, NÃO diga "segue abaixo", NÃO mande o hóspede "ao nosso site" e NÃO escreva endereço nenhum — ` +
        `qualquer promessa aqui sai sem nada embaixo, e o hóspede fica procurando o que não veio. ` +
        `Peça, em uma frase curta e cordial, o que ainda falta: data de entrada, data de saída e quantas pessoas.`
      );
    }

    // As travas abaixo olham SOMENTE o que o HÓSPEDE escreveu.
    //
    // Caso real: hóspede perguntou só "qual valor da diária" e recebeu um link
    // com 03 a 04/09 para 1 adulto e 1 criança - nada disso foi dito. A trava de
    // data existia, mas eu a aplicava sobre a conversa INTEIRA, e a nossa própria
    // mensagem automática contém "Segunda a sexta-feira". Um nome de dia da
    // semana no NOSSO texto validava uma data que o hóspede nunca deu.
    // Mensagem de varias linhas: so a PRIMEIRA leva o prefixo "Hospede:".
    //
    // Caso real: "31 de dezembro / 03 de janeiro / 4 adultos - 2 quartos" chega
    // como um balao de tres linhas. Filtrando apenas linhas que COMECAM com
    // "Hospede:", eu jogava fora "4 adultos" - e a trava concluia que ele nao
    // informou a quantidade, fazendo a Bella perguntar algo que estava escrito.
    // Agora seguimos o autor: uma linha sem prefixo pertence a quem falou antes.
    const falasDoHospede = apenasFalasDoHospede(conversation);

    // A fala do hospede manda na ocupacao.
    //
    // Quando ele escreveu quantos adultos E as idades, a conta e dele, nao do
    // extrator: sobrescrevemos o que veio da IA. Foi assim que "2 adultos e 2
    // criancas (5 e 10 anos)" saiu como 2 adultos e nenhuma crianca.
    const daFala = ocupacaoNaFala(falasDoHospede);
    if (daFala) {
      stay.adults = daFala.adultos;
      stay.children0_6 = 0;
      stay.children7_9 = 0;
      stay.idades = daFala.idades;
    }

    // Idades citadas viram adultos/criancas pela regra da casa (>=10 e adulto),
    // antes de qualquer trava ou montagem de link. Ver normalizarOcupacao.
    normalizarOcupacao(stay);

    // "4 apartamentos duplos": o tipo diz a ocupacao - ver apartamentosPorTipo.
    // Sem isto faltava "quantidade de adultos" e a Bella pedia de volta.
    const porTipo = apartamentosPorTipo(falasDoHospede);
    if (porTipo && !Number(stay.adults)) {
      stay.adults = porTipo.reduce((s, a) => s + a.adultos, 0);
      stay.apartamentos = porTipo.length;
      this.registrarDecisao(`ocupacao pelo tipo de apartamento: ${porTipo.length}x${porTipo[0].adultos}`, stay);
    }

    // Trava contra data inventada.
    //
    // Caso real: a hospede escreveu apenas "valor para 5 adultos, seria 1
    // diaria" e a sugestao saiu com "entrada de 5 a 6 de setembro" - data que
    // nunca existiu na conversa. Um contexto contaminado (ou uma inferencia do
    // modelo) virava link com o periodo errado. Antes de aceitar a data
    // extraida, exigimos que a conversa realmente mencione alguma data.
    const temNumeroDeData = /\b\d{1,2}\s*(?:\/|-|\s+de\s+)\s*(?:\d{1,2}|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i;
    const temDataRelativa = /\b(hoje|amanh[ãa]|fim de semana|final de semana|feriado|natal|ano novo|r[ée]veillon|carnaval|p[áa]scoa)\b/i;
    const temDiaDaSemana = /\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)\b/i;
    const mencionaData =
      temNumeroDeData.test(falasDoHospede) ||
      temDataRelativa.test(falasDoHospede) ||
      temDiaDaSemana.test(falasDoHospede);

    // Datas que o hospede nao corroborou nao valem, mesmo que ele tenha citado
    // ALGUMA data em algum momento: ver datasCorroboradas.
    if ((stay.checkin || stay.checkout) && !datasCorroboradas(falasDoHospede, stay.checkin, stay.checkout)) {
      stay.checkin = null;
      stay.checkout = null;
      stay.periodoVago = true;
    }
    if (!mencionaData && (stay.checkin || stay.checkout)) {
      stay.checkin = null;
      stay.checkout = null;
    }

    // Saida no mesmo dia da entrada (ou antes) e zero diarias. Caso real
    // (20/10/2026): saiu link de 21/10 a 21/10. Nao e periodo: e leitura
    // torta - pedir para confirmar, como nas datas que nao fecham.
    if (stay.checkin && stay.checkout && String(stay.checkout) <= String(stay.checkin)) {
      stay.checkout = null;
      stay.dataImpossivel = true;
    }


    // String.raw: a expressao precisa chegar com as barras invertidas intactas.
    // Escrita como texto comum, '\b' virava caractere de controle e a trava nao
    // casava NADA - foi assim que ela deixou passar "4 hijos" na primeira versao.
    const temNumeroDePessoas = new RegExp(
      String.raw`\b\d+\s*(?:` + PALAVRA_DE_PESSOA.source + '|' + PALAVRA_DE_CRIANCA.source + ')',
      'i',
    );
    const temPessoasPorExtenso =
      /\b(um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six)\s+(pessoa|persona|adulto|adult|h[óo]spede|hu[ée]sped|guest|crian|ni[ñn]|hij|child|kid)/i;
    const temTipoDeQuarto = /\b(casal|duplo|dupla|triplo|tripla|qu[áa]druplo|individual|single|solteiro|matrimonial|doble|triple|double)\b/i;
    const temComposicao =
      /\b(somos|seremos|s[ãa]o|seria|ser[íi]a|vamos)\s+\d+|\bsozinh[oa]\b|\b(eu|yo)\s+(e|y|com|con)\s|\beu e (a |o |minha |meu )/i;
    const falaDePessoas = (t: string) =>
      temNumeroDePessoas.test(t) || temPessoasPorExtenso.test(t) || temTipoDeQuarto.test(t) || temComposicao.test(t);
    const mencionaPessoas = falaDePessoas(falasDoHospede);

    if (!mencionaPessoas && stay.adults) {
      stay.adults = null;
    }

    // Data de HOJE com gente de OUTRO DIA: confirmar, nao supor.
    //
    // Caso real (20/10/2026): contato nao salvo, cinco mensagens na tela ("tem
    // disponibilidade de hoje pra amanha? qual o valor da diaria?"), nenhuma
    // palavra sobre quantas pessoas. A extensao mandou 29 falas - o historico
    // guardado daquele contato - e o "1 adulto" veio de la. Saiu link para 1
    // pessoa e "restam poucas unidades", consultado para essa ocupacao que a
    // hospede nunca deu.
    //
    // As linhas de hoje chegam marcadas com "(hoje)". Se o pedido de agora tem
    // data e nao fala de gente, a ocupacao antiga e de OUTRO pedido: pode ter
    // mudado. Pedir para confirmar custa uma mensagem; o link errado custa a
    // venda.
    const falasDeHoje = apenasFalasDoHospedeDeHoje(conversation);
    if (
      stay.adults &&
      falasDeHoje.trim() &&
      !falaDePessoas(falasDeHoje) &&
      (temNumeroDeData.test(falasDeHoje) || temDataRelativa.test(falasDeHoje) || temDiaDaSemana.test(falasDeHoje))
    ) {
      stay.adults = null;
      stay.ocupacaoDeOutroDia = true;
    }

    // Oferta de atendimento humano — SÓ dentro do horário do setor de reservas.
    // A Bella não fecha reserva, mas a equipe fecha, com pagamento via pix. Quem
    // trava na hora de pagar sozinho converte quando aparece essa porta. Fora do
    // expediente a oferta some: prometer especialista às 22h de domingo cria
    // expectativa que ninguém atende.
    // Reveillon: o pacote e de 5 diarias no minimo. Se o hospede pedir menos e o
    // periodo incluir o 31/12, o site NAO mostra disponibilidade - ele conclui
    // que estamos lotados e desiste. Esticamos a busca para 5 diarias para que
    // ele veja os valores, e a Bella explica a regra com naturalidade.
    let contextoReveillon = '';
    const pacote = ajustarPacoteReveillon(stay.checkin, stay.checkout);
    if (pacote) {
      stay.checkout = pacote.novaSaida;
      contextoReveillon =
        `\n\nPACOTE DE RÉVEILLON: o hóspede pediu ${pacote.noitesPedidas} diária(s) (${pacote.original}), mas a virada de ano é ` +
        `pacote fechado de 5 diárias — com menos que isso o site nem mostra disponibilidade. ` +
        `O link abaixo JÁ FOI AJUSTADO para as 5 diárias (até ${pacote.novaSaida}), para ele conseguir ver os valores.\n` +
        `Explique isso de forma leve e acolhedora, como uma característica da temporada e não como uma negativa: ` +
        `no Réveillon a estadia é um pacote de 5 diárias, e por isso o link mostra o período completo. ` +
        `Diga que o valor total é o mesmo de 1 a 5 diárias, então ele pode aproveitar os dias extras sem custo ` +
        `adicional — é um ganho, e vale apresentar assim. Nada de "não é possível" ou "infelizmente".`;
    }

    // UMA vez por conversa, e só isso.
    //
    // A oferta é injetada em seis ramos diferentes, e o texto já pedia "sem
    // repetir em toda mensagem" — mas pedido no prompt não é garantia, e na
    // prática ela reaparecia a cada resposta. Pedido do dono em 20/10/2026: a
    // Bella deve tentar a venda pelo LINK. Oferecer um atendente a toda hora
    // mina isso, porque dá ao hóspede uma saída mais cômoda do que clicar e
    // reservar sozinho — e ainda joga trabalho para a recepção que o site
    // resolveria.
    //
    // Se ele pedir atendente, o caminho continua: motivoParaHumano e
    // hospedePediuAtendente tratam disso em outro lugar, independente daqui.
    const jaOfereceuAtendente =
      /\bpix\b|especialista em reservas|setor de reservas|encaminh/i.test(
        apenasNossasFalas(conversation),
      );
    const ofertaAtendimento = isWithinBusinessHours() && !jaOfereceuAtendente
      ? `\n\nOFERTA DE ATENDIMENTO HUMANO (o setor de reservas está atendendo AGORA): ` +
        `logo DEPOIS do link, acrescente UMA frase curta oferecendo que, se ele preferir fazer a reserva ` +
        `por aqui mesmo pelo WhatsApp com pagamento via pix, basta pedir que você encaminha para o nosso ` +
        `especialista em reservas. Diga de forma natural, sem insistir e sem repetir em toda mensagem. ` +
        `NÃO prometa valor, desconto, prazo nem condição: só ofereça o encaminhamento. ` +
        `Se ele aceitar, encaminhe para a equipe.`
      : '';
    // Dois periodos diferentes no mesmo pedido.
    //
    // A extracao devolve UM orcamento so, e o que sai e a combinacao errada -
    // as datas de um pedido com a quantidade do outro. Um link assim parece
    // atendimento pronto e esta errado, o que e pior do que nao mandar link.
    let periodos = periodosPedidos(falasDoHospede);
    let intervalosDoPedido = intervalosNaFala(falasDoHospede);

    // Periodo NOVO depois da nossa resposta substitui o antigo.
    //
    // Caso real (21/10/2026): a hospede pediu 03 a 09/12, a recepcao respondeu
    // que o dia 05 estava lotado, e ela mandou "do dia 07 ao dia 13 quanto
    // ficaria". O codigo viu dois periodos e tratou como dois pedidos
    // simultaneos: sem link, e a resposta voltou a falar do 03 a 09 - "como
    // voce ja sabe". O antigo ja foi respondido; o pedido de agora e o que ela
    // escreveu DEPOIS da nossa ultima mensagem.
    //
    // O periodo novo e o que aparece na conversa inteira e NAO aparecia antes
    // da nossa resposta. Comparar assim, e nao ler so as falas recentes, porque
    // "do dia 07 ao dia 13" sozinho nao tem mes - o "dezembro" ficou na fala
    // anterior.
    if (periodos.length > 1 && apenasNossasFalas(conversation).trim() && falasDoHospedeDepoisDaNossa(conversation).trim()) {
      const chave = (p: { checkin: string; checkout: string }) => p.checkin + '>' + p.checkout;
      const antes = new Set(intervalosNaFala(falasDoHospedeAntesDaNossa(conversation)).map(chave));
      const novos = intervalosNaFala(falasDoHospede).filter((p) => !antes.has(chave(p)));
      if (antes.size >= 1 && novos.length >= 1) {
        const br = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
        stay.checkin = novos[0].checkin;
        stay.checkout = novos[0].checkout;
        intervalosDoPedido = novos;
        periodos = novos.map((p) => br(p.checkin) + ' a ' + br(p.checkout));
        this.registrarDecisao(`periodo novo substitui o ja respondido (${novos.length})`, stay);
      }
    }

    if (periodos.length > 1) {
      // Mesma ocupacao para todos os periodos? Entao da para orcar os tres.
      //
      // Caso real (20/10/2026): a hospede pediu tres periodos e repetiu "1
      // casal e 1 pet pequeno" em cada um. Mandar so o reconhecimento e pedir
      // de novo o que ela ja disse tres vezes e trabalho a toa - e ela tem que
      // esperar outra mensagem para ver qualquer valor.
      //
      // A suposicao (as mesmas pessoas em todos) vai DITA na resposta, para ela
      // corrigir se mudar de um periodo para o outro. Sem ocupacao clara, ou
      // com crianca sem idade, cai no caminho antigo de so reconhecer.
      const intervalos = intervalosDoPedido;
      const adultos = Number(stay.adults) || 0;
      if (adultos > 0 && !criancaSemIdade(falasDoHospede) && intervalos.length === periodos.length) {
        const linhas = intervalos.map((p, i) => {
          const url = this.reservations.buildBookingLink({
            checkin: p.checkin,
            checkout: p.checkout,
            adults: adultos,
            children0_6: Number(stay.children0_6) || 0,
            children7_9: Number(stay.children7_9) || 0,
          } as any);
          return `${periodos[i]}:\n${url}`;
        });
        this.registrarDecisao(`${periodos.length} periodos: um link para cada`, stay);
        return (
          `\n\nO HÓSPEDE PEDIU ${periodos.length} PERÍODOS DIFERENTES. Monte um orçamento para CADA um.\n` +
          `Envie os links ABAIXO, na mesma ordem, cada um identificado pelas datas e SOZINHO em sua linha, ` +
          `com uma linha em branco antes e depois.\n` +
          `Diga, em UMA frase curta, que montou todos considerando a mesma ocupação que ele informou ` +
          `(${adultos} ${adultos === 1 ? 'pessoa' : 'pessoas'}), e que é só avisar se mudar em algum período.\n` +
          `NÃO informe preços — quem mostra o valor é cada link.\n\n` +
          linhas.join('\n\n') +
          ofertaAtendimento
        );
      }
      this.registrarDecisao(`${periodos.length} periodos pedidos`, stay);
      return (
        `\n\nO HÓSPEDE PEDIU ${periodos.length} PERÍODOS DIFERENTES (${periodos.join(' e ')}) — ` +
        `e cada um pode ter quantidade de pessoas própria.\n` +
        `NÃO mande link nesta mensagem: um link só misturaria as datas de um pedido com as pessoas do outro. ` +
        `Responda reconhecendo os ${periodos.length} períodos (liste-os, um por linha) e pergunte quantas pessoas são - e se são as mesmas em todos. ` +
        `Assim que ele confirmar, você monta um orçamento para cada período.` +
        ofertaAtendimento
      );
    }

    const faltam = ['checkin', 'checkout', 'adults'].filter((c) => !stay[c]);
    // Crianca citada sem idade: o link nao pode sair, porque a categoria depende
    // da idade. Pedir, em vez de terminar a conversa num beco sem saida.
    if (criancaSemIdade(falasDoHospede)) faltam.push('idades');

    // Mais de 6 pessoas e so falta a idade das criancas: a resposta tem de
    // trazer TUDO de uma vez - quantos apartamentos, como dividir e as idades.
    //
    // Caso real (21/10/2026): "12 a 17 de janeiro para 4 adultos e tres
    // criancas". A regra de "falta idade" vinha antes da de "mais de 6" e
    // respondia sozinha: a Bella pedia so as idades, e a divisao ficava para
    // uma segunda rodada. Regra do dono: no maximo 6 por apartamento; informar
    // o minimo de apartamentos, perguntar a divisao e as idades, e mandar o
    // link (um por apartamento) com base nas respostas.
    const criancasDitas = Math.max(
      quantasCriancasNaFala(falasDoHospede),
      (Number(stay.children0_6) || 0) + (Number(stay.children7_9) || 0),
    );
    const totalDito = (Number(stay.adults) || 0) + criancasDitas;
    if (totalDito > 6 && totalDito <= 15 && faltam.length && faltam.every((f) => f === 'idades')) {
      const minimo = Math.ceil(totalDito / 6);
      this.registrarDecisao(`${totalDito} pessoas sem idades: informar ${minimo} apartamentos, pedir divisao e idades`, stay);
      return (
        `\n\nOCUPAÇÃO ACIMA DO LIMITE (${totalDito} pessoas: ${Number(stay.adults) || 0} adultos e ${criancasDitas} ` +
        `${criancasDitas === 1 ? 'criança' : 'crianças'}): cada apartamento acomoda no MÁXIMO 6 pessoas. NÃO envie link agora.\n` +
        `Numa mensagem só, curta e acolhedora:\n` +
        `1) diga que para ${totalDito} pessoas são necessários no mínimo ${minimo} apartamentos;\n` +
        `2) pergunte como ele prefere dividir as pessoas em cada apartamento;\n` +
        `3) peça a idade de cada criança (é o que define a categoria no site).\n` +
        `Explique em meia frase que, com essas respostas, você envia o link de cada apartamento já com os valores.`
      );
    }

    if (faltam.length) {
      const rotulos: Record<string, string> = {
        checkin: 'data de entrada',
        checkout: 'data de saída',
        adults: 'quantidade de adultos',
        idades: 'idade de cada criança (define a categoria no site)',
      };
      // Ja tentamos entender duas vezes: quem resolve ambiguidade e gente.
      if (devePassarParaHumano(conversation)) {
        this.registrarDecisao('passou para humano: 2 pedidos de dados sem sucesso', stay);
        return contextoDeEntregaAoHumano(isWithinBusinessHours());
      }
      // O FORMATO em que ele escreveu (sem os numeros) entra no motivo: e o
      // que me permite escrever a leitura certa sem pedir print a cada caso.
      this.registrarDecisao(
        'faltam dados (' + faltam.join('/') + ') formatos: ' + formatosDeNumero(falasDoHospede).join(' '),
        stay,
      );
      const avisoVago = stay.periodoVago
        ? ` O hóspede deu um período VAGO (ex.: "final de novembro"): NÃO afirme um mês, ` +
          `uma semana ou datas específicas que ele não disse — foi assim que "final de novembro" ` +
          `virou "dezembro" numa resposta. Peça as datas exatas e explique, em meia frase, ` +
          `que os valores mudam conforme o período.`
        : '';
      const avisoOcupacaoAntiga = stay.ocupacaoDeOutroDia
        ? ` Em conversas de OUTROS DIAS ele chegou a falar de quantidade de pessoas, mas no pedido de hoje não ` +
          `disse. NÃO suponha que é a mesma: pergunte quantas pessoas serão desta vez (e a idade das crianças, se houver).`
        : '';
      const avisoDataImpossivel = stay.dataImpossivel
        ? ` ATENÇÃO: ele JÁ DEU datas, mas elas não fecham (ex.: "31 a 1 de dezembro" — ` +
          `novembro não tem dia 31). NÃO pergunte as datas como se ele não tivesse dito nada e ` +
          `NÃO escolha uma interpretação por conta própria. Reconheça o que ele escreveu e peça ` +
          `para CONFIRMAR a data de entrada e a de saída, com dia e mês.`
        : '';
      return (
        `\n\nRESERVA: faltam dados para gerar o link. Peça ao hóspede APENAS: ` +
        `${faltam.map((c) => rotulos[c]).join(', ')}. Não pergunte o que ele já informou. ` +
        // "APENAS" vale para os DADOS pedidos, nao para calar a pergunta dele.
        // Analise de 26/10/2026: hospede perguntou das camas, a recepcao
        // respondeu "todos os apartamentos tem 1 cama de casal e 2 de
        // solteiro", e a Bella so pediu "quantas pessoas seriam?".
        `Se na conversa ele fez uma PERGUNTA que ainda não foi respondida (camas, café, estacionamento, pet, horário...), ` +
        `RESPONDA a pergunta primeiro, em uma frase, com a base de conhecimento — e só depois peça o que falta. ` +
        `NÃO prometa verificar valores ou disponibilidade — quem consulta é o próprio hóspede no link.` +
        avisoVago +
        avisoOcupacaoAntiga +
        avisoDataImpossivel
      );
    }

    // Mais de um apartamento: UM LINK PARA CADA.
    //
    // Caso real: o hospede pediu "1 apartamento para 1 casal + 1 pet" e
    // "1 apartamento para 3 adultos", pedindo valores SEPARADOS. Enviar um link
    // so - ou o link sem ocupacao - faz parecer que metade do pedido foi
    // ignorada. Como a busca aceita a ocupacao de um apartamento, geramos um
    // link por composicao, cada um ja com a gente certa dentro.
    /**
     * Classifica as pessoas de UM apartamento a partir das idades cruas.
     *
     * A conta NAO fica com o modelo. Caso real: "1 adulto e 1 menor de 11 anos"
     * virou 1 adulto no link, e "menores de 6 e 17 anos" virou duas criancas -
     * quando 11 e 17 ja contam como ADULTO pela politica do hotel. Aqui a regra
     * e aplicada sempre igual: 10 anos ou mais e adulto, 7 a 9 e meia, 0 a 6 e
     * cortesia. O rotulo mostrado ao hospede sai DESTES mesmos numeros, entao
     * texto e link nunca divergem.
     */
    const classificarApartamento = (a: any) => {
      const idades: number[] = Array.isArray(a?.idades) ? a.idades.map(Number).filter((n: number) => !isNaN(n)) : [];
      const adultos = (Number(a?.adultos) || 0) + idades.filter((i) => i >= 10).length;
      const criancas0_6 = (Number(a?.criancas0_6) || 0) + idades.filter((i) => i >= 0 && i <= 6).length;
      const criancas7_9 = (Number(a?.criancas7_9) || 0) + idades.filter((i) => i >= 7 && i <= 9).length;

      const partes: string[] = [];
      if (adultos) partes.push(`${adultos} ${adultos === 1 ? 'adulto' : 'adultos'}`);
      const criancas = criancas0_6 + criancas7_9;
      if (criancas) {
        const menores = idades.filter((i) => i < 10).sort((x, y) => x - y);
        partes.push(
          menores.length
            ? `${criancas} ${criancas === 1 ? 'criança' : 'crianças'} (${menores.join(' e ')} anos)`
            : `${criancas} ${criancas === 1 ? 'criança' : 'crianças'}`,
        );
      }
      return { adultos: Math.max(1, adultos), criancas0_6, criancas7_9, descricao: partes.join(' e ') };
    };

    let detalhe: any[] = Array.isArray(stay.apartamentos_detalhe) ? stay.apartamentos_detalhe : [];

    // A divisao que o hospede ESCREVEU vence a do extrator - ver
    // divisaoPorApartamento. Le primeiro o que ele disse depois da nossa
    // ultima mensagem (a resposta a "como prefere dividir?").
    const recentesParaDivisao = falasDoHospedeDepoisDaNossa(conversation);
    const fonteDaDivisao = recentesParaDivisao.trim() ? recentesParaDivisao : falasDoHospede;
    const criancasNoPedido = (Number(stay.children0_6) || 0) + (Number(stay.children7_9) || 0);
    // "4 pessoas em cada apartamento" - ver pessoasEmCadaApartamento.
    const emCada =
      criancasNoPedido > 0
        ? null
        : pessoasEmCadaApartamento(fonteDaDivisao, Number(stay.adults) || 0) ||
          pessoasEmCadaApartamento(falasDoHospede, Number(stay.adults) || 0);
    const divisaoEscrita =
      divisaoPorApartamento(fonteDaDivisao) ||
      emCada ||
      (criancasNoPedido > 0 ? null : apartamentosPorTipo(fonteDaDivisao) || apartamentosPorTipo(falasDoHospede));
    if (divisaoEscrita) {
      detalhe = divisaoEscrita;
      this.registrarDecisao(`divisao escrita pelo hospede: ${divisaoEscrita.length} apartamentos`, stay);
    } else if (detalhe.length > 1) {
      // Extrator sem crianca quando a fala tem idade: perdeu gente no caminho.
      //
      // "Menores de 10 anos" e a NOSSA regra, nao a idade de alguem. Caso real
      // (21/10/2026): o hospede respondeu citando a saudacao da Bella ("caso
      // tenha criancas menores de 10 anos..."), a citacao veio junto na fala
      // dele, e a divisao certa do extrator foi descartada por isso.
      const semRegraDeIdade = falasDoHospede.replace(
        /\b(?:menor(?:es)?|maior(?:es)?|menos|mais|acima|abaixo|at[ée]|a\s+partir)\s+(?:de\s+)?\d{1,2}\s*(?:anos?|años?|years?)/gi,
        '',
      );
      const falaTemIdade = /\d{1,2}\s*(?:anos?|años?|years?)\b/i.test(semRegraDeIdade);
      const detalheTemCrianca = detalhe.some(
        (a: any) => (Array.isArray(a?.idades) && a.idades.length) || Number(a?.criancas0_6) || Number(a?.criancas7_9),
      );
      if (falaTemIdade && !detalheTemCrianca) {
        this.registrarDecisao('divisao do extrator sem as criancas - descartada', stay);
        detalhe = [];
      }
    }

    // "4 casais" ja E a divisao: 4 apartamentos de 2 pessoas.
    //
    // Sem isto o pedido caia na regra generica de "mais de 6 pessoas, pergunte
    // como dividir" - perguntando o que o hospede acabou de dizer. So entra
    // quando o extrator NAO trouxe a composicao, e so quando as contas batem:
    // se o total nao for exatamente o dobro do numero de casais, ha mais gente
    // na conversa e quem decide continua sendo o extrator.
    if (detalhe.length <= 1) {
      const porCasais = apartamentosDeCasais(falasDoHospede);
      const totalDito =
        (Number(stay.adults) || 0) + (Number(stay.children0_6) || 0) + (Number(stay.children7_9) || 0);
      if (porCasais && totalDito === porCasais.length * 2) {
        detalhe = porCasais;
        this.registrarDecisao(`${porCasais.length} casais: um apartamento duplo para cada`, stay);
      }
    }
    // "3 em um apto, 4 em outro": a divisao ja foi dita - ver apartamentosDeclarados.
    if (detalhe.length <= 1) {
      const declarados = apartamentosDeclarados(falasDoHospede);
      const totalDito =
        (Number(stay.adults) || 0) + (Number(stay.children0_6) || 0) + (Number(stay.children7_9) || 0);
      const soma = declarados ? declarados.reduce((s, a) => s + a.adultos, 0) : 0;
      if (declarados && (totalDito === 0 || soma === totalDito)) {
        detalhe = declarados;
        this.registrarDecisao(`divisao dita pelo hospede: ${declarados.length} apartamentos`, stay);
      }
    }
    // O hospede PEDIU uma pessoa - isso vem antes de qualquer outra coisa.
    //
    // Pedido do dono (15/10/2026). O caminho automatico ja escalava nesse caso;
    // o da extensao nao enxergava, e a Bella seguia tentando resolver sozinha
    // alguem que acabou de dizer que nao queria falar com ela.
    if (hospedePediuAtendente(falasDoHospede)) {
      this.registrarDecisao('hospede pediu atendente: entregar contato', stay);
      return (
        `\n\nO HÓSPEDE PEDIU PARA FALAR COM UMA PESSOA. NÃO insista, NÃO tente responder a dúvida ` +
        `você mesma e NÃO envie link. Reconheça o pedido com simpatia e encaminhe.` +
        blocoDeContato(isWithinBusinessHours())
      );
    }

    // Grupo e ocupacao impossivel — antes de montar qualquer link.
    //
    // Caso real: pedido para 30 pessoas gerou um link com "adultos=30" num
    // unico apartamento. O limite e 6 por apartamento, entao esse link nao
    // significa nada: o site nao teria como atender.
    //
    // Regra do hotel: acima de 15 pessoas e GRUPO e quem atende e a equipe.
    const totalNoPedido =
      (Number(stay.adults) || 0) + (Number(stay.children0_6) || 0) + (Number(stay.children7_9) || 0);

    if (totalNoPedido > 15) {
      this.registrarDecisao('grupo: passa para a equipe', stay);
      return (
        `\n\nGRUPO (${totalNoPedido} pessoas): acima de 15 pessoas o atendimento é feito pela nossa equipe. ` +
        `NÃO envie link e NÃO tente montar orçamento. Confirme com cordialidade o que entendeu ` +
        `(período e número de pessoas), diga que para grupos desse tamanho quem monta a proposta é a ` +
        `equipe de reservas — que consegue condições e organização que o site não oferece — e encaminhe.` +
        (isWithinBusinessHours()
          ? ` O setor está atendendo agora: diga que já está encaminhando ao especialista.`
          : ` O setor NÃO está atendendo agora: informe o horário de atendimento e ofereça a recepção 24h pelo telefone, sem prometer retorno imediato.`)
      );
    }

    // Mais de 6 pessoas: nao cabe num apartamento so.
    //
    // O dono ensinou pela conversa de 22/09/2026 ("6 adulto e um crianca de 7
    // anos"): a Bella deve DIZER de quantos apartamentos precisa e perguntar
    // como o hospede quer dividir. Antes ela so perguntava a divisao, sem o
    // numero - e o atendente teve que escrever "sao necessarios 2 apartamentos"
    // na mao. O limite e 6 por apartamento, entao o minimo e o total dividido
    // por 6, arredondado para cima.
    // A divisao veio escrita, mas a leitura rapida (sem IA) nao a enxerga.
    //
    // Caso real (21/10/2026): 7 pessoas; a Bella pediu a divisao, o hospede
    // respondeu "2 adultos e 2 criancas de 5 e 8 anos em um apto, 2 adultos e
    // 1 crianca de 12 no outro" - e ela pediu a divisao DE NOVO. A frase tinha
    // datas e numeros simples, entao a leitura sem IA atendeu sozinha e nao
    // traz apartamento por apartamento. Quando passa de 6 e ha cara de divisao
    // na fala, quem le e o extrator, que devolve a lista de apartamentos.
    if (
      totalNoPedido > 6 &&
      detalhe.length <= 1 &&
      semIA &&
      /\b(aptos?|apartamentos?|quartos?|su[íi]tes?|outr[oa])\b/i.test(falasDoHospede)
    ) {
      try {
        const lido: any = await this.extrair(conversation);
        const lista = Array.isArray(lido?.apartamentos_detalhe) ? lido.apartamentos_detalhe : [];
        const cabe = (a: any) =>
          (Number(a?.adultos) || 0) + (Number(a?.criancas0_6) || 0) + (Number(a?.criancas7_9) || 0) +
            (Array.isArray(a?.idades) ? a.idades.length : 0) <= 6;
        if (lista.length > 1 && lista.every(cabe)) {
          detalhe = lista;
          this.registrarDecisao(`divisao lida pelo extrator: ${lista.length} apartamentos`, stay);
        }
      } catch (_) {
        /* extrator fora do ar: segue pedindo a divisao */
      }
    }

    if (totalNoPedido > 6 && !(detalhe.length > 1)) {
      const minimo = Math.ceil(totalNoPedido / 6);
      this.registrarDecisao(`${totalNoPedido} pessoas: pedir a divisao em ${minimo} apartamentos`, stay);
      return (
        `\n\nOCUPAÇÃO ACIMA DO LIMITE (${totalNoPedido} pessoas): cada apartamento acomoda no MÁXIMO 6 pessoas, ` +
        `então isso não cabe num apartamento só e um link único não serve. NÃO envie link agora.\n` +
        `DIGA AO HÓSPEDE, com naturalidade, que para ${totalNoPedido} pessoas são necessários no mínimo ` +
        `${minimo} apartamentos — esse número é a informação que ele precisa para se organizar, não omita. ` +
        `Em seguida pergunte como ele prefere dividir os hóspedes em cada apartamento (quantas pessoas em cada, ` +
        `e a idade das crianças de cada um, se houver), porque é isso que permite montar um orçamento por apartamento.\n` +
        `Se ele preferir, ofereça que a equipe de reservas monte a divisão.` +
        ofertaAtendimento
      );
    }


    if (detalhe.length > 1) {
      const linhas = detalhe.map((a: any, i: number) => {
        const c = classificarApartamento(a);
        const url = this.reservations.buildBookingLink({
          checkin: stay.checkin,
          checkout: stay.checkout,
          adults: c.adultos,
          children0_6: c.criancas0_6,
          children7_9: c.criancas7_9,
        } as any);
        return `Apartamento ${i + 1} — ${c.descricao}:
${url}`;
      });

      // A conta sai da MESMA classificacao dos links. Somar so os campos
      // deixava de fora quem veio por idade: em 21/10/2026, 4 adultos e 3
      // criancas (5, 8 e 12 anos) viraram "4 pessoas, cabem juntas" - e a
      // Bella ofereceria um apartamento so para 7.
      const classificados = detalhe.map((a: any) => classificarApartamento(a));
      const totalPessoas = classificados.reduce(
        (s: number, c: any) => s + c.adultos + c.criancas0_6 + c.criancas7_9,
        0,
      );

      // Cabe tudo num apartamento so? Entao NAO decida por ele.
      //
      // Caso real: "4 pessoas, 2 casais". Isso tanto pode ser dois apartamentos
      // quanto um unico com as quatro pessoas - o limite e 6 por apartamento. A
      // Bella escolheu "dois duplos" sozinha, e a opcao mais barata nem foi
      // apresentada. Quando couber junto, oferecemos as DUAS possibilidades e
      // quem escolhe e o hospede.
      let opcaoJuntos = '';
      // Se ele mesmo escreveu "um com... e o outro com...", a escolha ja foi
      // feita: oferecer "todos juntos" e desfazer o que ele decidiu.
      if (totalPessoas > 1 && totalPessoas <= 6 && !divisaoEscrita) {
        const juntos = this.reservations.buildBookingLink({
          checkin: stay.checkin,
          checkout: stay.checkout,
          adults: classificados.reduce((s: number, c: any) => s + c.adultos, 0),
          children0_6: classificados.reduce((s: number, c: any) => s + c.criancas0_6, 0),
          children7_9: classificados.reduce((s: number, c: any) => s + c.criancas7_9, 0),
        } as any);
        opcaoJuntos =
          `\n\nATENÇÃO — O HÓSPEDE NÃO DEIXOU CLARO se quer apartamentos SEPARADOS ou TODOS JUNTOS. ` +
          `As ${totalPessoas} pessoas cabem em um único apartamento (o limite é 6). NÃO escolha por ele: ` +
          `apresente as DUAS opções, de forma curta, e deixe ele decidir.\n` +
          `Opção "todos no mesmo apartamento" — link:\n${juntos}\n` +
          `Diga algo no espírito de: "posso montar de duas formas — em apartamentos separados ou todos juntos ` +
          `num só; veja as duas e me diga qual prefere". Ofereça primeiro a que ele parece querer, mas mostre ambas.`;
      }

      const muitos = detalhe.length >= 4;
      this.registrarDecisao('varios apartamentos: um link para cada', stay);
      return (
        `\n\nRESERVA DE ${detalhe.length} APARTAMENTOS — UM LINK PARA CADA.\n` +
        `Primeiro confirme, em uma linha, a composição que você entendeu de cada apartamento. ` +
        `Depois envie os links ABAIXO, na mesma ordem, cada um identificado e SOZINHO em sua linha, ` +
        `com uma linha em branco antes e depois. Cada link já vem com a ocupação daquele apartamento, ` +
        `então o hóspede vê o valor separado de cada um — que foi o que ele pediu.\n` +
        `NÃO junte tudo num link só e NÃO envie um link sem ocupação.\n\n` +
        linhas.join('\n\n') +
        `\n\nNÃO informe preços, NÃO trate isso como grupo/excursão e NÃO some todos os hóspedes num apartamento só.` + opcaoJuntos +
        (muitos
          ? `\nComo são vários apartamentos, ofereça também que a nossa equipe monte o orçamento completo, ` +
            (isWithinBusinessHours()
              ? `encaminhando agora ao especialista em reservas.`
              : `informando o horário do setor — sem prometer atendimento imediato.`)
          : '')
      );
    }

    // Sabemos que são vários, mas não conseguimos separar as composições.
    //
    // Só vale quando o grupo realmente não cabe num apartamento. Caso real
    // (20/10/2026): 4 adultos, e saiu o link só com as datas, sem ocupação -
    // que não mostra valor nenhum. Até 6 pessoas seguimos pelo caminho normal,
    // com o link completo; dividir em dois é escolha do hóspede, não nossa.
    const totalPessoasPedido =
      Number(stay.adults || 0) + Number(stay.children0_6 || 0) + Number(stay.children7_9 || 0);
    if (Number(stay.apartamentos) > 1 && totalPessoasPedido > 6) {
      const linkBase = this.reservations.buildSearchLink(
        stay.checkin,
        stay.checkout,
        Math.ceil(totalPessoasPedido / Number(stay.apartamentos)),
      );
      this.registrarDecisao('varios apartamentos sem composicao clara', stay);
      return (
        `\n\nRESERVA DE ${stay.apartamentos} APARTAMENTOS (composição de cada um não ficou clara): ` +
        `confirme com o hóspede quantas pessoas ficam em CADA apartamento — com isso você consegue ` +
        `enviar um orçamento separado para cada um. Se ele já tiver dito e você não separou, releia a conversa.\n` +
        `Se preferir adiantar, este link abre a busca pelas datas, e na página ele ajusta os hóspedes ` +
        `e o campo "Nº apartamentos":\n${linkBase}\n` +
        `NÃO apresente esse link como orçamento fechado do pedido todo.` +
        ofertaAtendimento
      );
    }

    // Disponibilidade REAL, consultada no motor de reservas. Só faz sentido para
    // UM apartamento: com vários, a ocupação somada não representa nenhuma busca
    // válida (e passaria de 6 pessoas, o que o site recusaria).
    let contextoDisponibilidade = '';
    try {
      // O html vem da extensao (navegador do atendente). Se nao veio, tentamos
      // do servidor - hoje bloqueado pelo Cloudflare, entao normalmente volta
      // null e a resposta sai sem falar de disponibilidade.
      const disp = htmlDisponibilidade
        ? this.disponibilidade.interpretar(htmlDisponibilidade)
        : await this.disponibilidade.consultar(
            stay.checkin,
            stay.checkout,
            Number(stay.adults) || 1,
            Number(stay.children0_6) || 0,
            Number(stay.children7_9) || 0,
          );

      if (disp && disp.semDisponibilidade) {
        // Basta UM dia lotado no meio do período para o site não devolver nada.
        // Mandar o link aqui seria pior que não responder: o hóspede clica, bate
        // no aviso de indisponível e volta perguntando o que houve.
        const dias = disp.diasIndisponiveis.length
          ? ` O(s) dia(s) sem disponibilidade nesse intervalo: ${disp.diasIndisponiveis.join(', ')}.`
          : '';
        this.registrarDecisao('sem disponibilidade no sistema', stay);
        return (
          `\n\nSEM DISPONIBILIDADE (consultado agora no sistema, para ${stay.checkin} a ${stay.checkout}): ` +
          `NÃO envie o link e NÃO diga que seguem os valores — para este período o site não oferece nenhum apartamento.` +
          dias +
          `\nInforme com clareza e cordialidade que para essas datas não temos disponibilidade. ` +
          `Se houver dia(s) citado(s) acima, diga QUAL dia está lotado: muitas vezes o hóspede consegue ajustar ` +
          `a entrada ou a saída em um dia e resolver. Convide-o a informar outras datas que você verifica de novo. ` +
          `NÃO invente datas alternativas nem diga que "temos vaga" em outro período sem ter consultado.` +
          ofertaAtendimento
        );
      }

      // Marca que a vaga foi CONFIRMADA no sistema. E o que permite, la no
      // suggest(), deixar passar "temos disponibilidade" - sem a marca, a
      // guarda corta a frase (ver semGarantiaDeVaga).
      if (disp && disp.categorias.length) {
        contextoDisponibilidade = `\n\n${AssistController.MARCA_VAGA_CONSULTADA}`;
      }

      if (disp) {
        const poucos = disp.categorias.filter((c) => c.restantes !== null);
        const linhas: string[] = [];
        if (poucos.length) {
          linhas.push(
            'Restam poucos apartamentos: ' + poucos.map((c) => `${c.categoria} (${c.restantes})`).join(', ') + '.',
          );
        }
        if (disp.esgotadas.length) {
          linhas.push('Já SEM disponibilidade neste período: ' + disp.esgotadas.join(', ') + '.');
        }
        if (linhas.length) {
          contextoDisponibilidade +=
            `\n\nDISPONIBILIDADE REAL (consultada agora no sistema, para ${stay.checkin} a ${stay.checkout}):\n` +
            linhas.join('\n') +
            `\nVocê PODE usar esta informação para criar urgência HONESTA — é dado real, não suposição. ` +
            `Mencione de forma natural e sem alarde ("para essas datas restam poucas unidades dessa categoria"), ` +
            `uma vez só, junto do convite para concluir pelo link. ` +
            `NÃO invente número diferente do que está aqui, NÃO diga que o hotel está lotado, ` +
            `e NÃO cite categoria esgotada como se fosse opção. Se nada acima indicar escassez, não fale de procura.`;
        }
      }
    } catch (_) {
      /* indisponível: segue sem falar de procura */
    }

    // Ja mandamos este mesmo orcamento e ele esta perguntando outra coisa: nao
    // reenviar - ver orcamentoJaEnviado.
    if (orcamentoJaEnviado(conversation, stay.checkin, stay.checkout)) {
      this.registrarDecisao('orcamento ja enviado antes: nao reenviar', stay);
      return (
        `\n\nORÇAMENTO JÁ ENVIADO: o link com os valores de ${stay.checkin} a ${stay.checkout} já foi mandado ` +
        `nesta conversa. NÃO reenvie o link e NÃO repita o orçamento. ` +
        `Responda APENAS à pergunta atual do hóspede, usando a base de conhecimento. ` +
        `Se ele fez uma pergunta, não pergunte "qual é a sua dúvida": ela já está escrita.`
      );
    }

    const link = this.reservations.buildBookingLink(stay);
    this.registrarDecisao('link montado', stay);
    // Alguem chega depois e fica so parte da estadia (regra do dono,
    // 26/10/2026): o link e da ocupacao de entrada, e a resposta avisa que
    // nos dias com hospede a mais ha valor adicional na diaria.
    const chegamDepois = adultosNaFala(semPrefixos(falasDoHospede)).chegamDepois;
    const contextoChegamDepois = chegamDepois
      ? `\nO HÓSPEDE AVISOU QUE MAIS ${chegamDepois} ${chegamDepois === 1 ? 'ADULTO CHEGA' : 'ADULTOS CHEGAM'} DEPOIS e ` +
        `${chegamDepois === 1 ? 'fica' : 'ficam'} só parte da estadia. O link acima é da ocupação de ENTRADA - diga isso numa frase. ` +
        `Em seguida informe que, nos dias em que houver hóspede a mais, é cobrado um valor adicional nas diárias, ` +
        `e que a nossa equipe ajusta isso na reserva. NÃO diga para ele escolher outra ocupação no site e NÃO informe o valor.`
      : '';
    return (
      `\n\nRESERVA: envie ESTE link ao hóspede, exatamente como está, para ele ver ` +
      `disponibilidade e valores e reservar pelo site:\n${link}\n` +
      `ANTES do link escreva UMA FRASE dizendo o que ele é e que a reserva se faz ali — ` +
      `por exemplo: "Segue o link com os valores e a disponibilidade para o seu período. ` +
      `Por ele você já consegue concluir a sua reserva:". Nunca cole o link solto, sem essa frase: ` +
      `o hóspede não sabe se aquilo é um orçamento, uma foto ou onde deve clicar.\n` +
      `O link deve ficar SOZINHO em uma linha, com uma linha em branco antes e outra depois — ` +
      `nunca grudado no texto nem logo após dois-pontos, senão o WhatsApp quebra o endereço.\n` +
      `NÃO informe preços nem prometa verificar disponibilidade — o link já mostra tudo isso.` + contextoChegamDepois + contextoDisponibilidade + contextoReveillon + ofertaAtendimento
    );
  }



  /**
   * Transcreve um audio recebido no WhatsApp.
   *
   * A extensao le apenas .copyable-text, que so existe em mensagem de TEXTO -
   * entao audio chegava invisivel para a Bella e ela parecia ignorar o hospede.
   * O servidor ja sabia transcrever (era usado no canal oficial da Meta); aqui
   * so abrimos esse caminho para a extensao, que captura o audio no navegador.
   */
  @Post('transcrever')
  async transcrever(@Body() body: { base64?: string; mimeType?: string }) {
    if (!body.base64) return { ok: false, erro: 'audio vazio' };
    try {
      const texto = await this.ai.transcribeAudio(body.base64, body.mimeType || 'audio/ogg');
      return { ok: Boolean(texto), texto: texto || '' };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  }
  /**
   * Registra o que a Bella sugeriu x o que o atendente realmente enviou.
   *
   * É o retorno mais honesto que temos: quando o humano reescreve antes de
   * mandar, a diferença mostra onde ela erra — sem depender de alguém notar e
   * avisar. Guardamos só os dois textos; a conversa entra como HASH, então dá
   * para agrupar por contato sem armazenar telefone nem nome.
   */
  @Post('feedback')
  async feedback(
    @Body()
    body: {
      hotelId?: string;
      conversa?: string;
      acao?: string;
      sugestao?: string;
      enviado?: string;
      modelo?: string;
    },
  ) {
    const sugestao = (body.sugestao || '').trim();
    const enviado = (body.enviado || '').trim();
    if (!sugestao || !enviado) return { ok: false, motivo: 'textos vazios' };

    const acoesValidas = ['igual', 'editada', 'descartada'];
    const acao = acoesValidas.includes(body.acao || '') ? body.acao! : 'editada';

    // Hash curto e estável da conversa: agrupa sem identificar o hóspede.
    const conversa = body.conversa
      ? createHash('sha256').update(body.conversa).digest('hex').slice(0, 12)
      : null;

    await this.prisma.suggestionFeedback.create({
      data: {
        hotelId: body.hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque',
        conversa,
        acao,
        sugestao: sugestao.slice(0, 4000),
        enviado: enviado.slice(0, 4000),
        modelo: body.modelo || null,
      },
    });
    return { ok: true };
  }

  /**
   * O que aprender com o uso: casos em que o atendente NÃO enviou o que a Bella
   * escreveu. É a lista que vira correção de regra.
   */
  @Get('feedback')
  async listarFeedback(@Query('hotelId') hotelId?: string, @Query('dias') dias?: string) {
    const id = hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    const desde = new Date(Date.now() - (Number(dias) || 7) * 86400000);
    const todos = await this.prisma.suggestionFeedback.findMany({
      where: { hotelId: id, createdAt: { gte: desde } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const porAcao = todos.reduce((acc: Record<string, number>, f) => {
      acc[f.acao] = (acc[f.acao] || 0) + 1;
      return acc;
    }, {});
    return {
      periodoDias: Number(dias) || 7,
      total: todos.length,
      porAcao,
      /** só o que divergiu: é onde está o aprendizado */
      divergencias: todos
        .filter((f) => f.acao !== 'igual')
        .map((f) => ({
          quando: f.createdAt,
          acao: f.acao,
          conversa: f.conversa,
          sugerido: f.sugestao,
          enviado: f.enviado,
        })),
    };
  }

  /**
   * O que a Bella mais responde.
   *
   * Ela nao escolhe respostas de uma lista - escreve cada uma na hora. Entao o
   * que da para contar e o ASSUNTO, reconhecido pelo vocabulario da propria
   * sugestao. Junto vai o aproveitamento: em quantos casos o atendente enviou
   * o texto como veio. Assunto muito frequente com aproveitamento baixo e
   * exatamente onde vale mexer na base de conhecimento.
   */
  @Get('temas')
  async temas(@Query('hotelId') hotelId?: string, @Query('dias') dias?: string) {
    const id = hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    const periodo = Number(dias) || 30;
    const desde = new Date(Date.now() - periodo * 86400000);
    const todos = await this.prisma.suggestionFeedback.findMany({
      where: { hotelId: id, createdAt: { gte: desde } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });

    const contagem = new Map<string, { total: number; igual: number }>();
    let semTema = 0;
    for (const f of todos) {
      const temas = temasDaSugestao(f.sugestao);
      if (!temas.length) semTema++;
      for (const t of temas) {
        const atual = contagem.get(t) || { total: 0, igual: 0 };
        atual.total++;
        if (f.acao === 'igual') atual.igual++;
        contagem.set(t, atual);
      }
    }

    const assuntos = [...contagem.entries()]
      .map(([tema, v]) => ({
        tema,
        vezes: v.total,
        enviadaSemEditar: v.igual,
        aproveitamento: v.total ? Math.round((v.igual / v.total) * 100) : 0,
      }))
      .sort((a, b) => b.vezes - a.vezes);

    return {
      periodoDias: periodo,
      sugestoes: todos.length,
      semAssuntoReconhecido: semTema,
      assuntos,
    };
  }

  /**
   * Atalhos que valem a pena existir, tirados do que a recepcao realmente manda.
   *
   * A ideia e nao inventar atalho de escritorio: se um texto foi enviado varias
   * vezes, quase igual, para hospedes diferentes, ele JA e um atalho - so nao
   * tem botao. Aqui a gente descobre quais sao e propoe; quem transforma em
   * atalho de verdade e uma pessoa, no painel.
   *
   * Conta tudo o que foi enviado, inclusive quando a sugestao da Bella foi
   * descartada: o que interessa e a resposta que a casa repete, tenha vindo
   * dela ou do atendente.
   */
  @Get('atalhos-sugeridos')
  async atalhosSugeridos(@Query('hotelId') hotelId?: string, @Query('dias') dias?: string) {
    const id = hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    const periodo = Number(dias) || 60;
    const desde = new Date(Date.now() - periodo * 86400000);
    const todos = await this.prisma.suggestionFeedback.findMany({
      where: { hotelId: id, createdAt: { gte: desde } },
      orderBy: { createdAt: 'desc' },
      take: 3000,
    });

    const candidatos = todos.map((f) => f.enviado).filter((t) => serveDeAtalho(t));
    const jaExistem = await this.prisma.quickReply.findMany({ where: { hotelId: id } });

    const sugestoes = agrupar(candidatos)
      .filter((g) => g.vezes >= 2)
      // se ja existe atalho com esse texto, nao propoe de novo
      .filter((g) => !jaExistem.some((q) => parecenca(q.content, g.texto) >= SEMELHANTE))
      .slice(0, 15)
      .map((g) => {
        const temas = temasDaSugestao(g.texto);
        return {
          tema: temas[0] || 'Outros',
          atalhoSugerido: sugerirApelido(temas[0], jaExistem.map((q) => q.shortcut)),
          vezes: g.vezes,
          texto: g.texto,
        };
      });

    return { periodoDias: periodo, analisadas: candidatos.length, sugestoes };
  }

  /**
   * O aprendizado do dia.
   *
   * A correcao do atendente e o unico retorno honesto que temos: quando ele
   * reescreve antes de mandar, a diferenca diz onde a Bella errou - sem
   * depender de alguem parar para reclamar. Aqui essas diferencas viram regras
   * em uma frase.
   *
   * Nada entra no prompt sozinho. Toda licao nasce PENDENTE e so passa a valer
   * depois que uma pessoa aprova no painel. Aprendizado automatico sem revisao
   * aprende tambem o que foi engano, e depois repete o engano com confianca.
   *
   * Roda uma vez por dia, chamada pela extensao. E idempotente: cada divergencia
   * e marcada como analisada e nao volta.
   */
  @Post('aprender')
  async aprender(@Body() body: { hotelId?: string; dias?: number }) {
    const id = body?.hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    const desde = new Date(Date.now() - (body?.dias || 30) * 86400000);

    const divergencias = await this.prisma.suggestionFeedback.findMany({
      where: { hotelId: id, analisado: false, acao: { not: 'igual' }, createdAt: { gte: desde } },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    if (!divergencias.length) return { ok: true, analisadas: 0, novas: 0, motivo: 'nada novo' };

    const casos = divergencias
      .map((d, i) => `CASO ${i + 1}\nBella sugeriu: ${d.sugestao.slice(0, 700)}\nAtendente enviou: ${d.enviado.slice(0, 700)}`)
      .join('\n\n');

    const resposta = await this.ai.complete({
      // analise offline, sem hospede esperando: vale o modelo mais cuidadoso
      task: 'policy_answer',
      system:
        `Você analisa o atendimento de um hotel. Em cada caso, a assistente sugeriu uma resposta e ` +
        `o atendente humano enviou outra. Descubra o que o humano sabia e a assistente não.\n\n` +
        `Escreva LIÇÕES: regras curtas, em português, que evitariam o erro no futuro. Uma frase cada.\n\n` +
        `Regras da análise:\n` +
        `- Ignore diferenças de estilo, saudação ou ordem das frases. Só interessa diferença de CONTEÚDO.\n` +
        `- Se o atendente só reescreveu com outras palavras, NÃO gere lição.\n` +
        `- Nunca escreva valores, preços ou percentuais.\n` +
        `- Nada de lição sobre fechar reservas: a assistente nunca reserva, só envia o link do site.\n` +
        `- No máximo 6 lições. Se não houver nada real a aprender, devolva lista vazia.\n\n` +
        `Responda SOMENTE com JSON: {"licoes":[{"texto":"...","tema":"..."}]}`,
      messages: [{ role: 'user', content: casos }],
      temperature: 0,
    });

    let propostas: { texto: string; tema?: string }[] = [];
    try {
      const bruto = (resposta.text || '').replace(/```json|```/g, '').trim();
      const inicio = bruto.indexOf('{');
      propostas = JSON.parse(bruto.slice(inicio, bruto.lastIndexOf('}') + 1))?.licoes ?? [];
    } catch {
      propostas = [];
    }

    const existentes = await this.prisma.licao.findMany({ where: { hotelId: id } });
    const recusadas: string[] = [];
    let novas = 0;

    for (const p of propostas) {
      const texto = (p?.texto || '').trim();
      const veredito = licaoAceitavel(texto);
      if (!veredito.ok) {
        recusadas.push(`${texto.slice(0, 60)} (${veredito.motivo})`);
        continue;
      }
      // Mesma licao dita de outro jeito: soma exemplo em vez de duplicar.
      const igual = existentes.find((l) => parecenca(l.texto, texto) >= SEMELHANTE);
      if (igual) {
        await this.prisma.licao.update({
          where: { id: igual.id },
          data: { exemplos: { increment: 1 } },
        });
        continue;
      }
      const criada = await this.prisma.licao.create({
        data: { hotelId: id, texto, tema: p?.tema || null },
      });
      existentes.push(criada);
      novas++;
    }

    await this.prisma.suggestionFeedback.updateMany({
      where: { id: { in: divergencias.map((d) => d.id) } },
      data: { analisado: true },
    });

    return { ok: true, analisadas: divergencias.length, novas, recusadas };
  }

  /** As lições, para revisar no painel. */
  @Get('licoes')
  async licoes(@Query('hotelId') hotelId?: string, @Query('status') status?: string) {
    const id = hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    return this.prisma.licao.findMany({
      where: { hotelId: id, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { exemplos: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  /** Aprovar liga a regra no prompt; recusar a mantém guardada, mas inerte. */
  @Post('licoes/:id')
  async decidirLicao(@Param('id') licaoId: string, @Body() body: { status?: string }) {
    const status = ['pendente', 'aprovada', 'recusada'].includes(body?.status || '')
      ? body!.status!
      : 'pendente';
    await this.prisma.licao.update({ where: { id: licaoId }, data: { status } });
    this.licoesCache = null;
    return { ok: true, status };
  }

  /**
   * Por que saiu (ou nao saiu) link nas ultimas sugestoes.
   *
   * Publico como o diagnostico da IA, e pela mesma razao: quando o hospede
   * recebe uma promessa sem link, precisamos saber qual ramo decidiu isso sem
   * depender de login nem do log do Render, que hiberna. Nao devolve nada do
   * que o hospede escreveu - so o que a decisao usou.
   */
  @Public()
  @Get('diagnostico-link')
  diagnosticoLink() {
    return { decisoes: this.decisoesLink.slice(-40), clientes: this.clientes.slice(-10), tempos: this.tempos.slice(-10) };
  }

  /**
   * O PLACAR da meta principal: a Bella entregou o link?
   *
   * O dono disse em 13/10/2026 que ela estava falhando no que mais importa, e
   * ate aqui eu so tinha caso isolado - um print por vez. Aqui sai o numero.
   *
   * A fonte e real: a tabela de feedback guarda, lado a lado, o que ela
   * SUGERIU e o que a recepcao de fato ENVIOU. A pergunta que interessa e uma
   * so - quantas vezes o atendente teve que por o link na mao porque ela nao
   * pos. Essa e a falha que o hospede sente.
   *
   * Devolve apenas CONTAGENS. Nenhum texto de conversa sai daqui.
   */

  /**
   * O historico das medicoes, que sobrevive aos deploys.
   *
   * Os diagnosticos anteriores vivem na memoria do servidor e sao apagados a
   * cada publicacao - e eu publico varias vezes por dia. Era uma regua que
   * zerava sozinha: nao dava para dizer se uma correcao melhorou alguma
   * coisa. Este le do banco.
   *
   * So contagem e tempo. Nenhum texto de conversa.
   */
  @Public()
  @Get('diagnostico-historico')
  async diagnosticoHistorico(@Query('dias') dias?: string) {
    const janela = Math.min(Math.max(Number(dias) || 7, 1), 90);
    const desde = new Date(Date.now() - janela * 24 * 60 * 60 * 1000);

    const linhas = await this.prisma.diagnostico.findMany({
      where: { createdAt: { gte: desde } },
      select: { tipo: true, motivo: true, canal: true, ms: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const porMotivo: Record<string, number> = {};
    const porDia: Record<string, { total: number; link: number }> = {};
    const temposPorCanal: Record<string, number[]> = {};

    for (const l of linhas) {
      porMotivo[l.motivo] = (porMotivo[l.motivo] || 0) + 1;
      const dia = l.createdAt.toISOString().slice(0, 10);
      porDia[dia] = porDia[dia] || { total: 0, link: 0 };
      if (l.tipo === 'decisao') {
        porDia[dia].total++;
        if (l.motivo.startsWith('link montado') || l.motivo.includes('um link para cada')) porDia[dia].link++;
      }
      if (l.ms && l.canal) (temposPorCanal[l.canal] = temposPorCanal[l.canal] || []).push(l.ms);
    }

    const mediana = (v: number[]) => {
      if (!v.length) return null;
      const s = [...v].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };

    return {
      janelaEmDias: janela,
      registros: linhas.length,
      // Quantas decisoes do dia terminaram em link - a meta principal, por dia.
      porDia: Object.fromEntries(
        Object.entries(porDia)
          .sort()
          .map(([d, v]) => [d, { decisoes: v.total, comLink: v.link, acerto: v.total ? Math.round((v.link / v.total) * 100) + '%' : '-' }]),
      ),
      motivosMaisComuns: Object.fromEntries(Object.entries(porMotivo).sort((a, b) => b[1] - a[1]).slice(0, 15)),
      tempoPorCanal: Object.fromEntries(
        Object.entries(temposPorCanal).map(([c, v]) => [c, { amostras: v.length, medianaMs: mediana(v), maximoMs: Math.max(...v) }]),
      ),
    };
  }

  /**
   * O QUE a recepcao corrige quando reescreve a resposta da Bella.
   *
   * Em 15/10/2026 o diagnostico mostrou 5 refacoes pedidas pelo atendente com
   * "sem motivo detectado": ele recusou a resposta e as minhas conferencias
   * automaticas nao acharam nada de errado. Ou seja, ha um erro que a recepcao
   * ve todo dia e eu nao vejo.
   *
   * A tabela de feedback guarda, lado a lado, o que ela SUGERIU e o que foi
   * ENVIADO. Comparar os dois diz o que foi corrigido sem ninguem precisar
   * relatar nada.
   *
   * So contagem - nenhum texto de conversa sai daqui.
   */
  @Public()
  @Get('diagnostico-correcoes')
  async diagnosticoCorrecoes(@Query('dias') dias?: string) {
    const janela = Math.min(Math.max(Number(dias) || 30, 1), 180);
    const desde = new Date(Date.now() - janela * 24 * 60 * 60 * 1000);

    const linhas = await this.prisma.suggestionFeedback.findMany({
      where: { createdAt: { gte: desde }, acao: { in: ['editada', 'descartada'] } },
      select: { acao: true, sugestao: true, enviado: true },
      orderBy: { createdAt: 'desc' },
      take: 1500,
    });

    const temLink = (t: string) => /sbreserva\.silbeck\.com\.br/i.test(t || '');
    const temTelefone = (t: string) => /3367-?0211|9\s?9690-?4414/i.test(t || '');
    const temPreco = (t: string) => /R\$\s*\d/i.test(t || '');
    const palavras = (t: string) => (t || '').trim().split(/\s+/).filter(Boolean).length;

    const conta = {
      total: linhas.length,
      acrescentouLink: 0,
      tirouLink: 0,
      acrescentouTelefone: 0,
      acrescentouPreco: 0,
      encurtouMuito: 0,
      alongouMuito: 0,
      reescreveuDoZero: 0,
      soAjusteFino: 0,
    };

    const repetidos = modelosRepetidos(linhas.map((l: any) => l.enviado || ''));
    for (const l of linhas) {
      // Mensagem automatica e texto-modelo repetido nao sao correcao do atendente.
      if (ehMensagemAutomatica(l.enviado) || repetidos.has(chaveDeModelo(l.enviado))) continue;
      const s = l.sugestao || '';
      const e = l.enviado || '';
      if (temLink(e) && !temLink(s)) conta.acrescentouLink++;
      if (temLink(s) && !temLink(e)) conta.tirouLink++;
      if (temTelefone(e) && !temTelefone(s)) conta.acrescentouTelefone++;
      if (temPreco(e) && !temPreco(s)) conta.acrescentouPreco++;

      const ps = palavras(s);
      const pe = palavras(e);
      if (ps && pe < ps * 0.5) conta.encurtouMuito++;
      else if (ps && pe > ps * 1.8) conta.alongouMuito++;

      if (l.acao === 'descartada') conta.reescreveuDoZero++;
      else conta.soAjusteFino++;
    }

    return {
      janelaEmDias: janela,
      ...conta,
      leitura:
        'acrescentouPreco é o mais importante: significa que a recepção precisou informar um valor que a Bella, por regra, não dá. ' +
        'encurtouMuito costuma ser resposta prolixa; alongouMuito, resposta incompleta.',
    };
  }
  @Public()
  @Get('diagnostico-orcamento')
  async diagnosticoOrcamento(@Query('dias') dias?: string) {
    const janela = Math.min(Math.max(Number(dias) || 30, 1), 180);
    const desde = new Date(Date.now() - janela * 24 * 60 * 60 * 1000);

    const linhas = await this.prisma.suggestionFeedback.findMany({
      where: { createdAt: { gte: desde } },
      select: { acao: true, sugestao: true, enviado: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });

    const temLink = (t: string) => /sbreserva\.silbeck\.com\.br/i.test(t || '');
    const placar = {
      janelaEmDias: janela,
      total: linhas.length,
      sugestaoComLink: 0,
      enviadoComLink: 0,
      /** A falha que importa: foi enviado link, e a sugestao nao tinha. */
      atendentePosOLinkNaMao: 0,
      /** O contrario: ela mandou link e o atendente tirou. */
      atendenteTirouOLink: 0,
      porAcao: {} as Record<string, number>,
    };

    const repetidos = modelosRepetidos(linhas.map((l: any) => l.enviado || ''));
    for (const l of linhas) {
      // Mensagem automatica e texto-modelo repetido nao sao correcao do atendente.
      if (ehMensagemAutomatica(l.enviado) || repetidos.has(chaveDeModelo(l.enviado))) continue;
      const s = temLink(l.sugestao);
      const e = temLink(l.enviado);
      if (s) placar.sugestaoComLink++;
      if (e) placar.enviadoComLink++;
      if (e && !s) placar.atendentePosOLinkNaMao++;
      if (s && !e) placar.atendenteTirouOLink++;
      placar.porAcao[l.acao] = (placar.porAcao[l.acao] || 0) + 1;
    }

    // A conta que responde "ela esta falhando?": entre as conversas que
    // TERMINARAM com link indo ao hospede, em quantas ela entregou sozinha.
    // O que ela disse no lugar do link, em mais detalhe.
    //
    // A primeira medicao dividiu em "pediu dados" / "prometeu" / "outra
    // coisa", e "outra coisa" ficou com 43 de 76 - ou seja, a maior parte da
    // falha estava num balde sem nome. Consertar sem saber o que ha ali seria
    // chute. Estas categorias nasceram dessa duvida.
    //
    // Continua sendo so o texto DELA, e so contagem.
    const pediuDados = /me informe|por gentileza|quantidade total de pessoas|per[íi]odo da estadia|informar as idades|quantas pessoas/i;
    const prometeu = /vou verificar|retorno|aguarde|em breve|consultar/i;
    const respondeuDuvida = /caf[ée]|wi-?fi|estacionamento|pet|animal|check-?in|check-?out|piscina|praia|ar-condicionado|estrutura|quarto/i;
    const soSaudacao = /^[^.!?\n]{0,120}(bem-?vindo|boa tarde|bom dia|boa noite|ol[áa])[^.!?\n]{0,120}$/i;
    const passouParaHumano = /equipe de reservas|especialista|encaminh|atendente/i;
    const noLugarDoLink = {
      pediuDadosQueTalvezJaTivesse: 0,
      prometeuRetorno: 0,
      respondeuOutraDuvida: 0,
      soCumprimentou: 0,
      encaminhouParaEquipe: 0,
      aindaSemExplicacao: 0,
    };
    for (const l of linhas) {
      // Mensagem automatica e texto-modelo repetido nao sao correcao do atendente.
      if (ehMensagemAutomatica(l.enviado) || repetidos.has(chaveDeModelo(l.enviado))) continue;
      if (!(temLink(l.enviado) && !temLink(l.sugestao))) continue;
      const s = l.sugestao || '';
      if (pediuDados.test(s)) noLugarDoLink.pediuDadosQueTalvezJaTivesse++;
      else if (passouParaHumano.test(s)) noLugarDoLink.encaminhouParaEquipe++;
      else if (prometeu.test(s)) noLugarDoLink.prometeuRetorno++;
      else if (respondeuDuvida.test(s)) noLugarDoLink.respondeuOutraDuvida++;
      else if (soSaudacao.test(s.trim())) noLugarDoLink.soCumprimentou++;
      else noLugarDoLink.aindaSemExplicacao++;
    }
    const comLinkNoFim = placar.enviadoComLink;
    const acerto = comLinkNoFim ? Math.round(((comLinkNoFim - placar.atendentePosOLinkNaMao) / comLinkNoFim) * 100) : null;

    return {
      ...placar,
      acertoDaBellaEmPorcento: acerto,
      leitura:
        acerto === null
          ? 'Sem envios com link na janela — nada a medir ainda.'
          : `De cada 100 mensagens com link que o hospede recebeu, a Bella entregou ${acerto} sozinha.`,
      noLugarDoLink,
      motivosRecentes: this.contarMotivos(),
    };
  }

  /** Quantas vezes cada motivo de decisao apareceu, desde que a API subiu. */
  private contarMotivos(): Record<string, number> {
    const conta: Record<string, number> = {};
    for (const d of this.decisoesLink) {
      // Sem os numeros variaveis, senao cada data vira um motivo diferente.
      const chave = (d.motivo || '').replace(/\d+/g, 'N').slice(0, 60);
      conta[chave] = (conta[chave] || 0) + 1;
    }
    return conta;
  }

  /**
   * A IA esta respondendo?
   *
   * Publico e de proposito, como o diagnostico do Silbeck: quando a Bella
   * devolve o texto de emergencia, precisamos saber o motivo sem depender de
   * login nem de ler o log do Render, que hiberna. Nao chama modelo nenhum -
   * so relata o que ja aconteceu - entao nao gasta cota e nao expoe a chave,
   * apenas se existe.
   */
  @Public()
  @Get('diagnostico-ia')
  diagnosticoIa() {
    return this.ai.diagnostico();
  }

  /**
   * Diagnóstico: a produção consegue mesmo consultar o Silbeck?
   *
   * A consulta de disponibilidade vive dentro de um try/catch que, ao falhar,
   * segue sem falar de procura — o que é seguro, mas SILENCIOSO. Se o Render não
   * alcançar o site (bloqueio de IP, timeout), a trava de "sem disponibilidade"
   * simplesmente não roda e o link sai como se houvesse vaga. Este endpoint
   * responde se a consulta funciona AQUI, no servidor, e não só na máquina do dev.
   *
   * Só devolve disponibilidade, que é informação pública do site do hotel.
   */
  @Public()
  @Get('diagnostico-disponibilidade')
  async diagnosticoDisponibilidade(
    @Query('checkin') checkin: string,
    @Query('checkout') checkout: string,
    @Query('adultos') adultos?: string,
  ) {
    if (!checkin || !checkout) {
      return { ok: false, erro: 'informe checkin e checkout (AAAA-MM-DD)' };
    }
    const inicio = Date.now();
    try {
      const r = await this.disponibilidade.consultar(checkin, checkout, Number(adultos) || 2);
      const detalhe = r ? null : await this.disponibilidade.diagnosticar(checkin, checkout, Number(adultos) || 2);
      return {
        ok: true,
        alcancouOSilbeck: r !== null,
        ms: Date.now() - inicio,
        resultado: r,
        detalhe,
      };
    } catch (e) {
      return {
        ok: false,
        ms: Date.now() - inicio,
        erro: e instanceof Error ? e.message : String(e),
      };
    }
  }
  /**
   * A Bella deve agir agora? A extensão do WhatsApp Web consulta isto ao abrir
   * cada conversa para decidir se sugere sozinha ou fica só no botão manual.
   *
   * O envio NUNCA é automático em nenhum modo — quem manda é sempre o atendente.
   * "auto" liga a sugestão automática apenas fora do horário do setor de reservas,
   * que é quando não há ninguém para escrever a resposta.
   */
  @Get('status')
  async status(@Query('hotelId') hotelId?: string) {
    const id = hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    const settings = await this.prisma.aiSettings.findUnique({ where: { hotelId: id } });
    const mode = settings?.mode ?? 'auto';
    const dentroDoHorario = isWithinBusinessHours();
    const bellaRespondendo = mode === 'on' || (mode === 'auto' && !dentroDoHorario);
    // WhatsApp ligado pela API (coexistencia): nesse horario quem responde e a
    // propria Bella, pelo servidor. A extensao sugerir junto seria convite a
    // resposta dobrada - a recepcao enviaria a sugestao por cima.
    const whatsappAutomatico =
      bellaRespondendo && Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
    const autoSuggest = bellaRespondendo && !whatsappAutomatico;
    return {
      mode,
      dentroDoHorario,
      horarioTexto: HORARIO_RESERVAS_TEXTO,
      /** sugerir sozinha ao abrir a conversa */
      autoSuggest,
      /** a Bella esta respondendo o WhatsApp sozinha agora, pela API */
      whatsappAutomatico,
      /** botão manual disponível (some só com a Bella desligada) */
      manualDisponivel: mode !== 'off',
    };
  }

  @Post('suggest')
  async suggest(@Body() body: { hotelId?: string; conversation: string; lastMessage?: string; disponibilidadeHtml?: string; pularDisponibilidade?: boolean; versao?: string; sinaisAudio?: string[]; fontesDirecao?: Record<string, number>; historico?: { fonte?: string; naTela?: number; guardadas?: number }; anterior?: string; automatica?: boolean }) {
    const hotelId = body.hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    // Cronometro das etapas. "Esta demorando muito" precisa virar numero: sem
    // isso a gente otimiza no escuro. Nenhum texto entra aqui, so tempos.
    const t0 = Date.now();
    const marcos: Record<string, number> = {};
    const conversation = (body.conversation || '').slice(-6000); // últimas mensagens
    // Formato da conversa que chegou - so contagens, nenhum texto do hospede.
    //
    // Em 18/09/2026 cinco sugestoes seguidas deram "sem assunto de estadia"
    // com a extensao atualizada e a IA funcionando. Isso tem duas explicacoes
    // opostas: o hospede so cumprimentou, ou as falas dele foram marcadas como
    // nossas. estadiaNaConversa=true com estadiaNaFalaDoHospede=false aponta
    // para a segunda sem precisar ver a conversa.
    const falasDoHospedeAgora = apenasFalasDoHospede(conversation);
    const formato = {
      linhasHospede: (conversation.match(/^\s*H[óo]spede\s*(\(hoje\))?\s*:/gim) || []).length,
      linhasNossas: (conversation.match(/^\s*N[óo]s\s*(\(hoje\))?\s*:/gim) || []).length,
      estadiaNaConversa: pareceOrcamento(conversation),
      estadiaNaFalaDoHospede: pareceOrcamento(falasDoHospedeAgora),
      ultimaLinhaEhDoHospede: /^\s*H[óo]spede/i.test(conversation.trim().split(/\r?\n/).filter((l) => /^\s*(H[óo]spede|N[óo]s)/i.test(l)).pop() || ''),
    };
    this.clientes.push({
      quando: new Date().toISOString(),
      versao: typeof body.versao === 'string' ? body.versao.slice(0, 20) : null,
      sinaisAudio: Array.isArray(body.sinaisAudio) ? body.sinaisAudio.map((s) => String(s).slice(0, 80)).slice(0, 5) : [],
      marcadorDeAudioNaConversa: /\[(mensagem de voz|áudio transcrito)/i.test(conversation),
      fontesDirecao: body.fontesDirecao && typeof body.fontesDirecao === 'object' ? body.fontesDirecao : undefined,
      // Como a extensao identificou o historico (1.10.3+): "por-chat" e o
      // esperado; "sem-identificador" quer dizer que o WhatsApp mudou a
      // marcacao e a Bella esta trabalhando so com a tela. So contagens.
      historico:
        body.historico && typeof body.historico === 'object'
          ? {
              fonte: String(body.historico.fonte || '').slice(0, 30),
              naTela: Number(body.historico.naTela) || 0,
              guardadas: Number(body.historico.guardadas) || 0,
            }
          : undefined,
      formato,
    });
    if (this.clientes.length > 20) this.clientes.shift();

    // Conversa inteira sem UMA linha do hospede e leitura quebrada, nao hospede
    // calado. Em 08/10/2026 chegaram 40 linhas, todas marcadas como nossas, de
    // um contato nao salvo - e a Bella confirmou a estadia sem mandar o link,
    // porque para o codigo ninguem tinha pedido nada. Fica registrado com nome
    // proprio: o motivo "sem assunto de estadia" escondia isso.
    if (formato.linhasNossas >= 3 && formato.linhasHospede === 0) {
      this.registrarDecisao(
        `LEITURA SUSPEITA: ${formato.linhasNossas} linhas nossas e nenhuma do hospede`,
        {},
      );
    }

    // Leitura quebrada: nao sugerir NADA.
    //
    // Conversa com varias linhas e nenhuma do hospede significa que a extensao
    // nao conseguiu distinguir quem falou o que. Ate 13/10/2026 isso so virava
    // registro no diagnostico, e a sugestao seguia: o modelo lia o texto cru,
    // nao sabia de quem era cada frase, e improvisava. Foi assim que saiu "o
    // valor da diária é de R$ 430,00. Temos disponibilidade para essas datas" -
    // preco inventado, errado, e disponibilidade que ninguem consultou.
    //
    // Sem saber quem falou, qualquer resposta e chute. Melhor devolver a
    // verdade ao atendente do que um texto convincente.
    if (formato.linhasNossas >= 3 && formato.linhasHospede === 0) {
      return {
        suggestion: '',
        model: 'mock',
        erro: 'Não consegui identificar as mensagens do hóspede nesta conversa — não vou arriscar uma resposta. Atualize a página (F5) e tente de novo; se continuar, me avise.',
        attachments: [],
      };
    }
    const focus = body.lastMessage || conversation;

    // Sugestao AUTOMATICA em conversa sem nada de hotel: nao sugere - ver
    // conversaSemAssuntoDeHotel. No clique a Bella responde normalmente.
    if (body.automatica && conversaSemAssuntoDeHotel(conversation, falasDoHospedeAgora)) {
      this.registrarDecisao('automatica: conversa sem assunto de hotel', {});
      return { suggestion: '', model: 'sem-assunto', attachments: [] };
    }

    // Curriculo e venda: resposta pronta e atendimento humano, sem IA.
    // Mesma regra do automatico - ver assuntoForaDoAtendimento.
    // Nunca em conversa que ja e de hospede (orcamento/link enviado, reserva em
    // andamento). Falso positivo real de 26/10/2026: hospede reclamando que
    // "o desconto nao esta refletindo" recebeu "vou encaminhar ao setor
    // responsavel", como se fosse vendedor.
    const conversaDeHospede = /silbeck/i.test(conversation) || reservaEmAndamento(apenasNossasFalas(conversation));
    const naoEHospede = conversaDeHospede ? null : assuntoForaDoAtendimento(falasDoHospedeAgora);
    if (naoEHospede) {
      this.registrarDecisao(naoEHospede === 'curriculo' ? 'curriculo: direto para humano' : 'venda: direto para humano', {});
      return {
        suggestion: mensagemForaDoAtendimento(naoEHospede),
        model: 'sem-ia',
        attachments: [],
        precisaDeHumano: naoEHospede === 'curriculo' ? 'currículo: não é hóspede' : 'oferta de venda: não é hóspede',
      };
    }

    // Pede a disponibilidade ANTES de escrever qualquer coisa.
    //
    // Antes eu gerava a resposta, descobria que precisava consultar, e gerava
    // TUDO DE NOVO com o dado em maos - duas chamadas de IA por sugestao, e o
    // atendente esperando o dobro. Agora a primeira passagem so extrai as datas
    // (que ficam em cache) e devolve o pedido; o texto e escrito uma vez so, ja
    // com a disponibilidade real.
    if (!body.disponibilidadeHtml && !body.pularDisponibilidade) {
      const s: any = await this.extrair(conversation);
      // So com a ocupacao lida. Caso real (22/10/2026): "4 funcionarios" nao
      // foi entendido, a consulta saiu para 1 adulto (o padrao), voltou com
      // vaga - e a Bella escreveu "temos disponibilidade para 4 pessoas".
      // Vaga para 1 nao e vaga para 4.
      if (s && s.checkin && s.checkout && Number(s.adults) > 0) {
        return {
          suggestion: '',
          model: 'aguardando-disponibilidade',
          attachments: [],
          precisaDisponibilidade: {
            checkin: s.checkin,
            checkout: s.checkout,
            adultos: Number(s.adults) || 1,
            criancas0a6: Number(s.children0_6) || 0,
            criancas7a9: Number(s.children7_9) || 0,
          },
        };
      }
    }

    // Desligada é desligada: não basta a extensão esconder o botão — o servidor
    // também recusa, senão uma aba antiga em cache continuaria sugerindo.
    const modo = (await this.prisma.aiSettings.findUnique({ where: { hotelId } }))?.mode ?? 'auto';
    if (modo === 'off') {
      return { suggestion: '', model: 'desligada', mode: modo };
    }

    // A extracao pode falhar por indisponibilidade da IA. Nesse caso a sugestao
    // nao sai - e melhor o atendente escrever do que receber um orcamento
    // montado sobre dados que ninguem conseguiu ler.
    let dadosDaConversa: [any, any, any, any, string, any[]];
    try {
      dadosDaConversa = await Promise.all([
        this.prisma.aiSettings.findUnique({ where: { hotelId } }),
        this.prisma.hotel.findUnique({ where: { id: hotelId } }),
        this.policies.findRelevant(hotelId, focus),
        this.knowledge.getKnowledgeContext(hotelId),
        this.bookingContext(conversation, body.disponibilidadeHtml),
        this.anexosRelevantes(focus, hotelId),
      ]);
    } catch (err) {
      if (err instanceof Error && err.message === AssistController.EXTRACAO_INDISPONIVEL) {
        // A extracao caiu, mas nem tudo depende dela: se o hospede NAO escreveu
        // periodo nenhum - e isso a gente verifica no codigo, sem IA - a
        // resposta certa e pedir a data. Foi o caso de 10/09/2026: "gostaria de
        // reservar um quarto pra 2 pessoas?" ficou sem resposta porque a IA
        // estava fora, quando bastava perguntar quando.
        const falas = apenasFalasDoHospede(conversation);
        // Sem periodo MONTAVEL e sem nem cara de data: so ai pedir a data.
        const semPeriodo = intervalosNaFala(falas).length === 0 && !temIndicioDeData(falas);
        const dizQuantos = Boolean(ocupacaoNaFala(falas)) || /\b\d{1,2}\s*(?:adultos?|pessoas?|hóspedes?)\b/i.test(falas);
        if (semPeriodo && pareceOrcamento(falas)) {
          const pedir = ['data de entrada', 'data de saída'];
          if (!dizQuantos) pedir.push('quantidade de adultos');
          const marca = 'RESERVA: faltam dados para gerar o link. Peça ao hóspede APENAS: ' + pedir.join(', ') + '.';
          const pronta = respostaSemIA(marca, conversation);
          if (pronta) {
            this.registrarDecisao('resposta sem IA (pediu as datas)', {});
            return { suggestion: formatarParaWhatsApp(pronta), model: 'sem-ia', attachments: [] };
          }
        }
        return {
          suggestion: '',
          model: 'mock',
          erro: 'A IA nao respondeu agora. Tente de novo em instantes.',
          attachments: [],
        };
      }
      throw err;
    }
    const [settings, hotel, relevantPolicies, knowledgeText, reserva, anexos] = dadosDaConversa;
    marcos.contexto = Date.now() - t0;

    const system =
      (settings?.masterPrompt ?? MASTER_PROMPT)
        .replaceAll('{{assistantName}}', settings?.assistantName ?? 'Bella')
        .replaceAll('{{hotelName}}', hotel?.name ?? 'Hotel do Bosque')
        .replaceAll('{{personality}}', settings?.personality ?? 'acolhedora, educada e natural')
        // A regra de apresentação deste caminho vem de contextoDeApresentacao()
        // (abaixo), que enxerga a conversa raspada do WhatsApp.
        .replaceAll('{{identityRule}}', 'siga a instrução de APRESENTAÇÃO indicada mais abaixo.')
        .replaceAll('{{guestContext}}', 'Atendimento em andamento pelo WhatsApp.')
        .replaceAll('{{policiesContext}}', relevantPolicies.map((p: any) => `[${p.category}] ${p.content}`).join('\n') || 'Nenhuma.')
        .replaceAll('{{knowledgeContext}}', knowledgeText || 'Nenhum.') +
      contextoDeApresentacao(conversation) +
      (await this.contextoDasLicoes(hotelId)) +
      contextoDeIdioma(apenasFalasDoHospede(conversation)) +
      contextoDaPergunta(conversation) +
      contextoDeHorario() +
      reserva +
      (() => {
        // Refacao: so quando o atendente clicou em Sugerir de novo.
        const anterior = typeof body.anterior === 'string' ? body.anterior.slice(0, 4000) : '';
        if (!anterior.trim()) return '';
        const linkEsperado = (reserva.match(/https?:\/\/\S+/) || [null])[0];
        const criticas = criticasDaResposta(anterior, conversation, linkEsperado);
        this.registrarDecisao(
          'refacao pedida pelo atendente' + (criticas.length ? ` (${criticas.length} problema(s) achado(s))` : ' (sem motivo detectado)'),
          {},
        );
        return contextoDeRefacao(anterior, criticas);
      })() +
      (anexos.length
        ? `\n\nANEXO: o atendente vai enviar junto o arquivo "${anexos.map((a) => a.title).join('", "')}". ` +
          `Mencione que está enviando esse material em anexo, de forma natural, e NÃO repita todo o conteúdo dele na mensagem.`
        : '') +
      '\n\nVocê está SUGERINDO uma resposta para um atendente humano usar. Escreva apenas a mensagem sugerida ao hóspede, pronta para enviar, sem rótulos nem aspas.';

    const draft = await this.ai.complete({
      task: 'sales',
      system,
      messages: [{ role: 'user', content: `Conversa até aqui:\n${conversation}\n\nSugira a próxima resposta ao hóspede.` }],
      temperature: settings?.temperature ?? 0.7,
    });
    marcos.geracao = Date.now() - t0 - marcos.contexto;
    // Tamanho da resposta: e o numero que diz se a instrucao de ser sucinta
    // pegou. Sem medir, "ficou mais curta" vira impressao.
    marcos.caracteres = (draft.text || '').length;

    // Refacao que saiu igual a anterior nao serve de nada.
    //
    // E o fracasso mais provavel deste recurso: o modelo reescreve a mesma
    // mensagem com outras palavras e o atendente clica de novo, sem fim. Uma
    // tentativa a mais, dizendo com todas as letras que repetir nao e opcao.
    const pedidoAnterior = typeof body.anterior === 'string' ? body.anterior : '';
    if (pedidoAnterior.trim() && draft.text && parecenca(draft.text, pedidoAnterior) >= 0.85) {
      this.registrarDecisao('refacao saiu igual a anterior - tentando outra vez', {});
      const outra = await this.ai.complete({
        task: 'sales',
        system:
          `${system}\n\nATENÇÃO: você acabou de reescrever praticamente a MESMA mensagem que já tinha sido ` +
          `recusada. Isso não resolve nada. Releia a última pergunta do hóspede e responda OUTRA COISA: ` +
          `a informação que falta, a pergunta que ficou sem resposta, o dado concreto que ele pediu.`,
        messages: [{ role: 'user', content: `Conversa até aqui:\n${conversation}\n\nSugira a próxima resposta ao hóspede.` }],
        temperature: Math.min(1, (settings?.temperature ?? 0.7) + 0.2),
      });
      if (outra.text && outra.model !== 'mock' && parecenca(outra.text, pedidoAnterior) < 0.85) {
        draft.text = outra.text;
      }
    }

    // Se ha datas mas ninguem consultou a disponibilidade, pedimos que a
    // extensao consulte e chame de novo. O servidor nao consegue: o Cloudflare
    // do Silbeck bloqueia o IP do Render (403 "Just a moment").
    // Troca qualquer endereco inventado pelo link oficial que montamos.
    const oficiais = (reserva.match(/https?:\/\/\S+/g) || []).map((u) => u.replace(/[),.]+$/, ''));

    // Saiu no idioma certo, e SEM mistura?
    //
    // A conferencia vale para os tres idiomas, inclusive portugues. Antes eu a
    // pulava quando o hospede era brasileiro, e foi assim que passou uma
    // resposta em portugues terminando com "Quedamos a su disposición"
    // (18/09/2026). Uma frase estrangeira no fim escapa de quem escreve, nao de
    // quem recebe.
    const idiomaEsperado = idiomaDoHospede(apenasFalasDoHospede(conversation));
    const foraDoIdioma = draft.text && !pareceEscritoEm(draft.text, idiomaEsperado);
    const misturou = draft.text && respostaMisturada(draft.text, idiomaEsperado);
    if (foraDoIdioma || misturou) {
      const tRefacao = Date.now();
      const nome = idiomaEsperado === 'es' ? 'ESPANHOL' : idiomaEsperado === 'en' ? 'INGLÊS' : 'PORTUGUÊS';
      // As marcas encontradas entram no motivo: sem isso nao da para saber se
      // o modelo misturou de verdade ou se o alarme e meu.
      const m = marcasDeIdioma(draft.text);
      const detalhe = `pt:${m.pt} es:${m.es} en:${m.en}`;
      this.registrarDecisao(
        (foraDoIdioma ? `resposta fora do idioma (${idiomaEsperado})` : `resposta misturou idiomas (${idiomaEsperado})`) + ` [${detalhe}]`,
        {},
      );
      const queixa = foraDoIdioma
        ? `a resposta anterior saiu no idioma ERRADO.`
        : `a resposta anterior MISTUROU idiomas — tinha trechos fora do ${nome.toLowerCase()}, como uma despedida em outra língua.`;
      const segunda = await this.ai.complete({
        task: 'sales',
        system:
          `${system}\n\nATENÇÃO: ${queixa} ` +
          `Escreva a mensagem INTEIRA em ${nome}, do cumprimento à despedida, sem uma única palavra em outro idioma.`,
        messages: [{ role: 'user', content: `Conversa até aqui:\n${conversation}\n\nSugira a próxima resposta ao hóspede.` }],
        temperature: settings?.temperature ?? 0.7,
      });
      if (segunda.text && segunda.model !== 'mock') draft.text = segunda.text;
      marcos.refacaoIdioma = Date.now() - tRefacao;
    }

    // Audio que nunca existiu: corta a frase, sem gastar refacao.
    if (draft.text) {
      const semAudio = semFraseDeAudioInventada(draft.text, conversation);
      if (semAudio !== draft.text) {
        this.registrarDecisao('resposta falava de audio sem audio na conversa', {});
        draft.text = semAudio;
      }

    // Preco inventado NUNCA chega ao campo de digitacao.
    //
    // A regra de nao cotar valor esta no prompt desde o inicio e mesmo assim
    // ele cotou (13/10/2026, R$ 430,00 inventados e errados). Prompt e
    // pedido; funcao e garantia.
    if (draft.text) {
      const oficial = (reserva.match(/https?:\/\/\S+/) || [null])[0];
      const semPreco = semPrecoInventado(draft.text, oficial);
      if (semPreco !== draft.text) {
        this.registrarDecisao('resposta trazia PRECO - frase removida', {});
        draft.text = semPreco;
      }
    }

    // Promessa de registro tambem nao chega ao campo de digitacao.
    //
    // Caso real (16/10/2026): "Registrei aqui que voces vao chegar as 19h" e
    // "ja anotei na sua reserva para deixarmos a recepcao ciente". Ela nao
    // registra nada - e a hospede chega confiando num aviso que nao existe.
    if (draft.text) {
      const semPromessa = semPromessaDeRegistro(draft.text);
      if (semPromessa !== draft.text) {
        this.registrarDecisao('resposta PROMETIA registro - frase removida', {});
        draft.text = semPromessa;
      }
      // Early/late: custo e com a recepcao (regra do dono, 22/10/2026).
      const semCusto = semCustoDeHorarioExtra(draft.text);
      if (semCusto !== draft.text) {
        this.registrarDecisao('resposta dava CUSTO de early/late - frase removida', {});
        draft.text = semCusto;
      }
      // Rascunho da IA e assunto que ninguem perguntou - ver common/resposta-limpa.
      const semRascunho = semRaciocinioVazado(draft.text);
      if (semRascunho !== draft.text) {
        this.registrarDecisao('resposta trazia RASCUNHO da IA - cortado', {});
        draft.text = semRascunho;
      }
      const soOPerguntado = semAssuntoNaoPerguntado(draft.text, falasDoHospedeAgora);
      if (soOPerguntado !== draft.text) {
        this.registrarDecisao('resposta falava de estrutura NAO perguntada - frase removida', {});
        draft.text = soOPerguntado;
      }
    }

    // Vaga que ninguem consultou tambem nao chega ao campo de digitacao.
    //
    // Era a unica guarda que faltava na extensao. Caso real (20/10/2026): sete
    // pessoas em dois apartamentos, nenhuma consulta feita, e a sugestao abriu
    // com "Temos disponibilidade para o periodo de 16/11 a 25/11 para os dois
    // apartamentos". So passa quando o sistema confirmou a vaga para o periodo.
    if (draft.text) {
      const consultou = reserva.includes(AssistController.MARCA_VAGA_CONSULTADA);
      const semVaga = semGarantiaDeVaga(draft.text, consultou);
      if (semVaga !== draft.text) {
        this.registrarDecisao('resposta GARANTIA vaga sem consulta - frase removida', {});
        draft.text = semVaga;
      }
    }

    // Nota fiscal: so a frase oficial, nada alem dela (regra do dono,
    // 21/10/2026 - ver semNotaFiscalInventada). E se o hospede perguntou e a
    // resposta nao tocou no assunto, a frase entra: pergunta sem resposta e
    // pior que resposta curta.
    if (draft.text) {
      const semNF = semNotaFiscalInventada(draft.text, idiomaEsperado);
      if (semNF !== draft.text) {
        this.registrarDecisao('resposta detalhava NOTA FISCAL - trocada pela frase oficial', {});
        draft.text = semNF;
      }
      if (falaDeNotaFiscal(falasDoHospedeDepoisDaNossa(conversation)) && !falaDeNotaFiscal(draft.text)) {
        draft.text = draft.text.trim() + '\n\n' + fraseOficialNotaFiscal(idiomaEsperado);
      }
    }
    }


    // Nenhum modelo respondeu.
    //
    // Caso real (08/09/2026): o hospede perguntou o horario de entrada e saida
    // e o painel ofereceu ao atendente o texto de emergencia - "estou com a
    // inteligencia em configuracao". Parecia a Bella errando uma pergunta
    // simples; era ela sem resposta nenhuma. Pior: bastava clicar em inserir
    // para o hospede receber que a IA do hotel esta quebrada.
    //
    // Sugestao vazia e honesta: quem atende escreve, como escrevia antes.
    if (draft.model === 'mock') {
      // Antes de desistir: da para responder sem IA?
      //
      // Na pergunta mais comum do atendimento - "gostaria de reservar um quarto
      // pra 2 pessoas?", sem dizer quando - a resposta certa e pedir a data, e
      // isso nao precisa de modelo. Caso real de 10/09/2026: a IA caiu, a
      // sugestao veio vazia e o hospede ficou sem resposta quando bastava
      // perguntar o periodo.
      const pronta = respostaSemIA(reserva, conversation);
      if (pronta) {
        return {
          suggestion: formatarParaWhatsApp(pronta),
          model: 'sem-ia',
          attachments: [],
        };
      }
      return {
        suggestion: '',
        model: 'mock',
        erro: 'A IA nao respondeu agora. Tente de novo em instantes.',
        attachments: [],
      };
    }

    // O texto final sai DEPOIS de todas as guardas e da refacao de idioma.
    //
    // Achado de 26/10/2026: esta linha ficava ANTES delas desde 09/2026, e as
    // guardas criadas depois (preco, registro, vaga, custo de early/late,
    // nota fiscal, rascunho, assunto nao perguntado) alteravam draft.text sem
    // efeito nenhum - registravam "frase removida" no diagnostico e a frase
    // chegava inteira ao atendente. Ex. real de 23/10: "Ja anotei o aviso de
    // chegada" com a guarda de registro ativa.
    const textoFinal = garantirLink(corrigirLinks(draft.text, oficiais), oficiais);

    marcos.total = Date.now() - t0;
    this.tempos.push({ quando: new Date().toISOString(), ...marcos });
    if (this.tempos.length > 20) this.tempos.shift();

    // Esta conversa precisa de gente? A extensao usa isso para tocar o alerta.
    //
    // Pedido do dono em 16/10/2026: quem atende olha varias conversas ao mesmo
    // tempo e nao percebe quando a Bella chega no limite dela. O motivo vai
    // junto com a sugestao para o alerta dizer POR QUE tocou - alerta sem
    // motivo vira barulho que se aprende a ignorar.
    const motivoHumano = motivoParaHumano({
      falaDoHospede: ultimaFalaDoHospede(conversation),
      resposta: textoFinal,
    } as any) ||
      // A pergunta de nota fiscal pode estar numa fala anterior da mesma
      // rajada, nao so na ultima linha.
      (falaDeNotaFiscal(falasDoHospedeDepoisDaNossa(conversation))
        ? 'o hóspede perguntou sobre nota fiscal: verificar o tomador (hóspede, empresa ou portal) antes de confirmar'
        : null) ||
      (devePassarParaHumano(conversation) ? 'a Bella já pediu os mesmos dados duas vezes' : null);

    return {
      suggestion: formatarParaWhatsApp(textoFinal),
      model: draft.model,
      attachments: anexos,
      precisaDeHumano: motivoHumano,
    };
  }
}

@Module({
  imports: [BellaModule, KnowledgeModule, PoliciesModule, ReservationsModule],
  controllers: [AssistController],
})
export class AssistModule {}
