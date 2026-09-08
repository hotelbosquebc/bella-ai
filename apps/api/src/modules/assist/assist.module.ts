import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { createHash } from 'crypto';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { BellaModule } from '../bella/bella.module';
import { ModelRouterService } from '../bella/model-router.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PoliciesModule } from '../policies/policies.module';
import { PoliciesService } from '../policies/policies.service';
import { MASTER_PROMPT, STAY_EXTRACTION_TOOL } from '../bella/prompts';
import { contextoDeHorario, isWithinBusinessHours, HORARIO_RESERVAS_TEXTO } from '../bella/business-hours';
import { normalizar } from '../attachments/attachments.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { ReservationEngineService } from '../reservations/reservation-engine.service';
import { SilbeckAvailabilityService } from '../reservations/silbeck-availability.service';

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
 * Garante que os links da resposta sejam os NOSSOS.
 *
 * Caso real (04/09/2026): a Bella enviou
 * "/hotelbosque/resultado?checkin=2023-09-08&adultos=2&criancas=0" - endereco
 * inventado, com caminho que nao existe, parametros errados e ano 2023. O
 * modelo escreveu uma URL de memoria em vez de usar a que o servidor montou.
 * Instrucao no prompt nao basta: aqui a troca e feita no codigo.
 *
 * - Havendo UM link oficial, qualquer endereco do motor vira ele.
 * - Havendo VARIOS (um por apartamento), so os oficiais sobrevivem; um link
 *   inventado no meio deles e removido.
 * - Nao havendo nenhum, todo link do motor sai da mensagem: se nao montamos um
 *   link, e porque ainda falta dado - mandar qualquer coisa e pior que nada.
 */
export function corrigirLinks(texto: string, oficiais: string[]): string {
  const doMotor = /https?:\/\/(?:www\.)?sbreserva\.silbeck\.com\.br\/\S*/gi;
  const achados = texto.match(doMotor);
  if (!achados) return texto;

  if (oficiais.length === 1) {
    return texto.replace(doMotor, oficiais[0]);
  }

  if (oficiais.length > 1) {
    const validos = new Set(oficiais);
    return texto.replace(doMotor, (url) => (validos.has(url) ? url : ''));
  }

  // Sem link oficial: remove o endereco e a linha que ficaria orfa.
  return texto
    .replace(doMotor, '')
    .split('\n')
    .filter((l, i, arr) => !(l.trim() === '' && arr[i - 1] !== undefined && arr[i - 1].trim() === ''))
    .join('\n');
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
  const ultima = ultimaFalaDoHospede(conversation);
  if (!ultima) return '';
  return (
    `\n\nRESPONDA AGORA A ESTA MENSAGEM DO HÓSPEDE:\n"${ultima.slice(0, 600)}"\n` +
    `Responda TUDO o que está nela — se traz duas perguntas, responda as duas. ` +
    `E só isso: o que já foi respondido antes na conversa não se repete.`
  );
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
  const t = (falasDoHospede || '').toLowerCase();
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

/** Instrucao pronta de idioma, entregue ao prompt ja decidida. */
export function contextoDeIdioma(falasDoHospede: string): string {
  const idioma = idiomaDoHospede(falasDoHospede);
  if (idioma === 'es') {
    return (
      `\n\nIDIOMA (JÁ DECIDIDO): o hóspede escreveu em ESPANHOL. Responda INTEIRAMENTE em espanhol, ` +
      `sem uma palavra em português — inclusive o bloco de abertura, para o qual existe a versão em espanhol pronta. ` +
      `Ignore o idioma das mensagens automáticas do hotel que aparecem na conversa: elas são nossas, não dele.`
    );
  }
  if (idioma === 'en') {
    return (
      `\n\nIDIOMA (JÁ DECIDIDO): o hóspede escreveu em INGLÊS. Responda INTEIRAMENTE em inglês, ` +
      `inclusive o bloco de abertura, para o qual existe a versão em inglês pronta. ` +
      `Ignore o idioma das mensagens automáticas do hotel que aparecem na conversa.`
    );
  }
  return `\n\nIDIOMA (JÁ DECIDIDO): o hóspede escreveu em PORTUGUÊS. Responda em português.`;
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
export class AssistController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: ModelRouterService,
    private readonly knowledge: KnowledgeService,
    private readonly policies: PoliciesService,
    private readonly reservations: ReservationEngineService,
    private readonly disponibilidade: SilbeckAvailabilityService,
  ) {}

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

  private readonly extracaoCache = new Map<string, { stay: any; ts: number }>();

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
    const extraido: any = extraction.toolInput ?? {};
    this.extracaoCache.set(chave, { stay: extraido, ts: Date.now() });
    return extraido;
  }

  private async bookingContext(conversation: string, htmlDisponibilidade?: string): Promise<string> {
    // Sem nenhum sinal de estadia na fala do hospede, nao ha o que extrair:
    // poupa uma chamada de IA por sugestao (ver pareceOrcamento).
    const stay: any = pareceOrcamento(apenasFalasDoHospede(conversation))
      ? await this.extrair(conversation)
      : {};
    // Tem dados de estadia? Entao e orcamento, qualquer que seja o rotulo.
    //
    // Caso real: "preciso saber o valor total das diarias para check in sexta
    // (28/08) e check out segunda. Para casal". O extrator classificou como
    // 'question' (ele pediu um VALOR), o link nunca foi montado e a Bella
    // improvisou mandando o endereco generico do site - sem datas, sem pessoas.
    // Perguntar o preco de um periodo E pedir orcamento.
    const temDadosDeEstadia = Boolean(stay.checkin && stay.checkout && stay.adults);
    if (stay.intent !== 'booking' && !temDadosDeEstadia) return '';

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

    if (!mencionaData && (stay.checkin || stay.checkout)) {
      stay.checkin = null;
      stay.checkout = null;
    }


    // Trava contra quantidade de pessoas inventada.
    //
    // Caso real: o hospede escreveu "gostaria de ver disponibilidade pra
    // 16/01/2027 ate 20/01/2027" - so as datas - e a sugestao saiu "para 2
    // pessoas" com o link pronto. O 2 nunca foi dito por ninguem. Mesmo erro da
    // data inventada, so que na ocupacao: o modelo preenche o campo com um
    // padrao plausivel e o link sai com gente a mais ou a menos.
    const temNumeroDePessoas = /\b\d+\s*(pessoa|adulto|h[óo]spede|crian|beb[êe]|gente)/i;
    const temPessoasPorExtenso = /\b(um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez)\s+(pessoa|adulto|h[óo]spede|crian)/i;
    const temTipoDeQuarto = /\b(casal|duplo|dupla|triplo|tripla|qu[áa]druplo|individual|single|solteiro)\b/i;
    const temComposicao = /\b(somos|seremos|s[ãa]o)\s+\d+|\bsozinh[oa]\b|\beu e (a |o |minha |meu )/i;
    const mencionaPessoas =
      temNumeroDePessoas.test(falasDoHospede) ||
      temPessoasPorExtenso.test(falasDoHospede) ||
      temTipoDeQuarto.test(falasDoHospede) ||
      temComposicao.test(falasDoHospede);

    if (!mencionaPessoas && stay.adults) {
      stay.adults = null;
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
    if (stay.checkin && stay.checkout) {
      const entrada = new Date(stay.checkin + 'T12:00:00');
      const saida = new Date(stay.checkout + 'T12:00:00');
      const noites = Math.round((saida.getTime() - entrada.getTime()) / 86400000);

      // A virada esta dentro da estadia? (a noite de 31/12 e a que conta)
      const virada = new Date(`${entrada.getFullYear() + (entrada.getMonth() === 0 ? -1 : 0)}-12-31T12:00:00`);
      const pegaVirada = entrada <= virada && virada < saida;

      if (pegaVirada && noites > 0 && noites < 5) {
        const novaSaida = new Date(entrada.getTime() + 5 * 86400000);
        const iso = novaSaida.toISOString().slice(0, 10);
        const original = `${stay.checkin} a ${stay.checkout}`;
        stay.checkout = iso;
        contextoReveillon =
          `\n\nPACOTE DE RÉVEILLON: o hóspede pediu ${noites} diária(s) (${original}), mas a virada de ano é ` +
          `pacote fechado de 5 diárias — com menos que isso o site nem mostra disponibilidade. ` +
          `O link abaixo JÁ FOI AJUSTADO para as 5 diárias (até ${iso}), para ele conseguir ver os valores.\n` +
          `Explique isso de forma leve e acolhedora, como uma característica da temporada e não como uma negativa: ` +
          `no Réveillon a estadia é um pacote de 5 diárias, e por isso o link mostra o período completo. ` +
          `Diga que o valor total é o mesmo de 1 a 5 diárias, então ele pode aproveitar os dias extras sem custo ` +
          `adicional — é um ganho, e vale apresentar assim. Nada de "não é possível" ou "infelizmente".`;
      }
    }

    const ofertaAtendimento = isWithinBusinessHours()
      ? `\n\nOFERTA DE ATENDIMENTO HUMANO (o setor de reservas está atendendo AGORA): ` +
        `logo DEPOIS do link, acrescente UMA frase curta oferecendo que, se ele preferir fazer a reserva ` +
        `por aqui mesmo pelo WhatsApp com pagamento via pix, basta pedir que você encaminha para o nosso ` +
        `especialista em reservas. Diga de forma natural, sem insistir e sem repetir em toda mensagem. ` +
        `NÃO prometa valor, desconto, prazo nem condição: só ofereça o encaminhamento. ` +
        `Se ele aceitar, encaminhe para a equipe.`
      : '';
    const faltam = ['checkin', 'checkout', 'adults'].filter((c) => !stay[c]);
    if (faltam.length) {
      const rotulos: Record<string, string> = {
        checkin: 'data de entrada',
        checkout: 'data de saída',
        adults: 'quantidade de adultos',
      };
      return (
        `\n\nRESERVA: faltam dados para gerar o link. Peça ao hóspede APENAS: ` +
        `${faltam.map((c) => rotulos[c]).join(', ')}. Não pergunte o que ele já informou. ` +
        `NÃO prometa verificar valores ou disponibilidade — quem consulta é o próprio hóspede no link.`
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

    const detalhe: any[] = Array.isArray(stay.apartamentos_detalhe) ? stay.apartamentos_detalhe : [];
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

    if (totalNoPedido > 6 && !(detalhe.length > 1)) {
      return (
        `\n\nOCUPAÇÃO ACIMA DO LIMITE (${totalNoPedido} pessoas): cada apartamento acomoda no MÁXIMO 6 pessoas, ` +
        `então isso não cabe num apartamento só e um link único não serve. NÃO envie link agora. ` +
        `Confirme o total e pergunte como ele prefere dividir — quantas pessoas em cada apartamento — ` +
        `para você montar um orçamento por apartamento. Se preferir, ofereça que a equipe de reservas monte a divisão.`
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

      const totalPessoas = detalhe.reduce(
        (s: number, a: any) =>
          s + (Number(a.adultos) || 0) + (Number(a.criancas0_6) || 0) + (Number(a.criancas7_9) || 0),
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
      if (totalPessoas > 1 && totalPessoas <= 6) {
        const juntos = this.reservations.buildBookingLink({
          checkin: stay.checkin,
          checkout: stay.checkout,
          adults: detalhe.reduce((s: number, a: any) => s + (Number(a.adultos) || 0), 0),
          children0_6: detalhe.reduce((s: number, a: any) => s + (Number(a.criancas0_6) || 0), 0),
          children7_9: detalhe.reduce((s: number, a: any) => s + (Number(a.criancas7_9) || 0), 0),
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
    if (Number(stay.apartamentos) > 1) {
      const linkBase = this.reservations.buildSearchLink(stay.checkin, stay.checkout);
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
          contextoDisponibilidade =
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

    const link = this.reservations.buildBookingLink(stay);
    return (
      `\n\nRESERVA: envie ESTE link ao hóspede, exatamente como está, para ele ver ` +
      `disponibilidade e valores e reservar pelo site:\n${link}\n` +
      `ANTES do link escreva UMA FRASE dizendo o que ele é e que a reserva se faz ali — ` +
      `por exemplo: "Segue o link com os valores e a disponibilidade para o seu período. ` +
      `Por ele você já consegue concluir a sua reserva:". Nunca cole o link solto, sem essa frase: ` +
      `o hóspede não sabe se aquilo é um orçamento, uma foto ou onde deve clicar.\n` +
      `O link deve ficar SOZINHO em uma linha, com uma linha em branco antes e outra depois — ` +
      `nunca grudado no texto nem logo após dois-pontos, senão o WhatsApp quebra o endereço.\n` +
      `NÃO informe preços nem prometa verificar disponibilidade — o link já mostra tudo isso.` + contextoDisponibilidade + contextoReveillon + ofertaAtendimento
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
    const autoSuggest = mode === 'on' || (mode === 'auto' && !dentroDoHorario);
    return {
      mode,
      dentroDoHorario,
      horarioTexto: HORARIO_RESERVAS_TEXTO,
      /** sugerir sozinha ao abrir a conversa */
      autoSuggest,
      /** botão manual disponível (some só com a Bella desligada) */
      manualDisponivel: mode !== 'off',
    };
  }

  @Post('suggest')
  async suggest(@Body() body: { hotelId?: string; conversation: string; lastMessage?: string; disponibilidadeHtml?: string; pularDisponibilidade?: boolean }) {
    const hotelId = body.hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    const conversation = (body.conversation || '').slice(-6000); // últimas mensagens
    const focus = body.lastMessage || conversation;

    // Pede a disponibilidade ANTES de escrever qualquer coisa.
    //
    // Antes eu gerava a resposta, descobria que precisava consultar, e gerava
    // TUDO DE NOVO com o dado em maos - duas chamadas de IA por sugestao, e o
    // atendente esperando o dobro. Agora a primeira passagem so extrai as datas
    // (que ficam em cache) e devolve o pedido; o texto e escrito uma vez so, ja
    // com a disponibilidade real.
    if (!body.disponibilidadeHtml && !body.pularDisponibilidade) {
      const s: any = await this.extrair(conversation);
      if (s && s.checkin && s.checkout) {
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

    const [settings, hotel, relevantPolicies, knowledgeText, reserva, anexos] = await Promise.all([
      this.prisma.aiSettings.findUnique({ where: { hotelId } }),
      this.prisma.hotel.findUnique({ where: { id: hotelId } }),
      this.policies.findRelevant(hotelId, focus),
      this.knowledge.getKnowledgeContext(hotelId),
      this.bookingContext(conversation, body.disponibilidadeHtml),
      this.anexosRelevantes(focus, hotelId),
    ]);

    const system =
      (settings?.masterPrompt ?? MASTER_PROMPT)
        .replaceAll('{{assistantName}}', settings?.assistantName ?? 'Bella')
        .replaceAll('{{hotelName}}', hotel?.name ?? 'Hotel do Bosque')
        .replaceAll('{{personality}}', settings?.personality ?? 'acolhedora, educada e natural')
        // A regra de apresentação deste caminho vem de contextoDeApresentacao()
        // (abaixo), que enxerga a conversa raspada do WhatsApp.
        .replaceAll('{{identityRule}}', 'siga a instrução de APRESENTAÇÃO indicada mais abaixo.')
        .replaceAll('{{guestContext}}', 'Atendimento em andamento pelo WhatsApp.')
        .replaceAll('{{policiesContext}}', relevantPolicies.map((p) => `[${p.category}] ${p.content}`).join('\n') || 'Nenhuma.')
        .replaceAll('{{knowledgeContext}}', knowledgeText || 'Nenhum.') +
      contextoDeApresentacao(conversation) +
      (await this.contextoDasLicoes(hotelId)) +
      contextoDeIdioma(apenasFalasDoHospede(conversation)) +
      contextoDaPergunta(conversation) +
      contextoDeHorario() +
      reserva +
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

    // Se ha datas mas ninguem consultou a disponibilidade, pedimos que a
    // extensao consulte e chame de novo. O servidor nao consegue: o Cloudflare
    // do Silbeck bloqueia o IP do Render (403 "Just a moment").
    // Troca qualquer endereco inventado pelo link oficial que montamos.
    const oficiais = (reserva.match(/https?:\/\/\S+/g) || []).map((u) => u.replace(/[),.]+$/, ''));
    const textoFinal = corrigirLinks(draft.text, oficiais);

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
      return {
        suggestion: '',
        model: 'mock',
        erro: 'A IA nao respondeu agora. Tente de novo em instantes.',
        attachments: [],
      };
    }

    return { suggestion: formatarParaWhatsApp(textoFinal), model: draft.model, attachments: anexos };
  }
}

@Module({
  imports: [BellaModule, KnowledgeModule, PoliciesModule, ReservationsModule],
  controllers: [AssistController],
})
export class AssistModule {}
