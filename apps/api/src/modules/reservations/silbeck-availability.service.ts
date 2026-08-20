import { Injectable, Logger } from '@nestjs/common';

export interface CategoriaDisponivel {
  categoria: string;
  /** Quantos restam, quando o site avisa "Apenas N disponíveis". null = não avisou. */
  restantes: number | null;
}

export interface Disponibilidade {
  categorias: CategoriaDisponivel[];
  /** Categorias que NÃO apareceram na busca — sem disponibilidade no período. */
  esgotadas: string[];
  /** O período inteiro está indisponível: o site não oferece nenhum apartamento. */
  semDisponibilidade: boolean;
  /** Dias lotados dentro/perto do período, em DD/MM/AAAA. É o que trava a busca. */
  diasIndisponiveis: string[];
  consultadoEm: number;
}

/** As quatro categorias do hotel, na ordem em que o site as apresenta. */
const CATEGORIAS = ['Suíte Bosque', 'Apartamento Luxo', 'Apartamento Superior', 'Apartamento Standard'];

const BASE = 'https://sbreserva.silbeck.com.br';
const HOTEL = 'hotelbosque';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const TTL_MS = 10 * 60 * 1000;

/**
 * Consulta a disponibilidade real no motor de reservas (Silbeck).
 *
 * POR QUE ISSO EXISTE
 * A Bella não pode inventar urgência ("últimas vagas") — seria afirmar algo que
 * ela não sabe. Mas o próprio site avisa "Apenas N disponíveis" quando restam
 * poucos de uma categoria, e deixa de mostrar a categoria quando ela esgota.
 * Com esse dado na mão, ela fala de procura REAL, sem inventar nada.
 *
 * COMO O SITE FUNCIONA (descoberto inspecionando a página)
 * A página de busca NÃO traz os resultados no HTML: eles vêm de
 * /api/hotel/listagem, que depende da sessão. A sequência é:
 *   1. GET  /pt-br/reserva/        -> cria a sessão e entrega o token sbClientRef
 *   2. POST /api/hotel/busca-disponibilidades   (datas em DD/MM/AAAA)
 *   3. GET  /pt-br/reserva/busca/  -> a sessão passa a apontar para esta busca
 *   4. GET  /api/hotel/listagem    -> JSON com o HTML dos cards
 * Todas as chamadas levam os mesmos cookies e o header X-Client-Ref.
 *
 * É consulta de leitura, com cache de 10 minutos por período/ocupação: não cria
 * reserva nem segura apartamento.
 */
@Injectable()
export class SilbeckAvailabilityService {
  private readonly logger = new Logger(SilbeckAvailabilityService.name);
  private readonly cache = new Map<string, Disponibilidade>();

  async consultar(
    checkin: string,
    checkout: string,
    adultos: number,
    criancas0a6 = 0,
    criancas7a9 = 0,
  ): Promise<Disponibilidade | null> {
    const chave = `${checkin}|${checkout}|${adultos}|${criancas0a6}|${criancas7a9}`;
    const emCache = this.cache.get(chave);
    if (emCache && Date.now() - emCache.consultadoEm < TTL_MS) return emCache;

    try {
      const html = await this.buscarListagem(checkin, checkout, adultos, criancas0a6, criancas7a9);
      if (!html) return null;
      const resultado = this.interpretar(html);
      this.cache.set(chave, resultado);
      return resultado;
    } catch (err) {
      this.logger.warn(
        `Consulta de disponibilidade falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Junta os cookies de uma resposta ao que já tínhamos. */
  private acumularCookies(atual: string, res: Response): string {
    const novos: string[] = (res.headers as any).getSetCookie?.() ?? [];
    const mapa = new Map<string, string>();
    for (const par of atual.split('; ').filter(Boolean)) {
      const i = par.indexOf('=');
      if (i > 0) mapa.set(par.slice(0, i), par.slice(i + 1));
    }
    for (const bruto of novos) {
      const primeiro = String(bruto).split(';')[0];
      const i = primeiro.indexOf('=');
      if (i > 0) mapa.set(primeiro.slice(0, i).trim(), primeiro.slice(i + 1));
    }
    return [...mapa.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private extrairRef(html: string): string {
    const m = html.match(/sbClientRef\s*=\s*'([a-f0-9]+)'/i);
    return m ? m[1] : '';
  }

  /** DD/MM/AAAA — formato que o formulário do Silbeck exige. */
  private paraFormularioBR(iso: string): string {
    const partes = iso.split('-');
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }

  private async buscarListagem(
    checkin: string,
    checkout: string,
    adultos: number,
    c06: number,
    c79: number,
  ): Promise<string | null> {
    let cookies = '';

    const inicial = await fetch(`${BASE}/${HOTEL}/pt-br/reserva/`, { headers: { 'User-Agent': UA } });
    cookies = this.acumularCookies(cookies, inicial);
    const ref = this.extrairRef(await inicial.text());
    if (!ref) return null;

    const cabecalhos: Record<string, string> = {
      'User-Agent': UA,
      ChaveHotel: HOTEL,
      RequestLang: 'pt-br',
      'X-Client-Ref': ref,
      'X-Requested-With': 'XMLHttpRequest',
    };

    const formulario =
      `data_inicio=${encodeURIComponent(this.paraFormularioBR(checkin))}` +
      `&data_fim=${encodeURIComponent(this.paraFormularioBR(checkout))}` +
      `&categorias_hospede%5B000001%5D=${adultos}` +
      `&categorias_hospede%5B000003%5D=${c06}` +
      `&categorias_hospede%5B000004%5D=${c79}` +
      `&codigo_promocional=`;

    const corpo = new URLSearchParams({
      urlHotel: HOTEL,
      formulario,
      acao: 'consultaDisponibilidade',
    });

    const busca = await fetch(`${BASE}/api/hotel/busca-disponibilidades`, {
      method: 'POST',
      headers: { ...cabecalhos, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
      body: corpo.toString(),
    });
    cookies = this.acumularCookies(cookies, busca);
    const respostaBusca: any = await busca.json().catch(() => ({}));
    if (respostaBusca && respostaBusca.erro) {
      this.logger.warn(`Silbeck recusou a busca: ${respostaBusca.erro}`);
      return null;
    }

    // A sessão só passa a apontar para esta busca depois de visitar a página.
    const paginaBusca = await fetch(
      `${BASE}/${HOTEL}/pt-br/reserva/busca/?checkin=${checkin}&checkout=${checkout}&adultos-000001=${adultos}`,
      { headers: { ...cabecalhos, Cookie: cookies } },
    );
    cookies = this.acumularCookies(cookies, paginaBusca);
    const ref2 = this.extrairRef(await paginaBusca.text()) || ref;

    const listagem = await fetch(`${BASE}/api/hotel/listagem`, {
      headers: { ...cabecalhos, 'X-Client-Ref': ref2, Cookie: cookies },
    });
    const dados: any = await listagem.json().catch(() => ({}));
    return (dados && dados.html) || null;
  }

  /**
   * Lê os cards e descobre, por categoria, se ela aparece e quantos restam.
   * O aviso vem como "Apenas N disponíveis" dentro do card, então localizamos
   * onde cada card começa e olhamos só o pedaço até o começo do próximo.
   */
  interpretar(html: string): Disponibilidade {
    // O HTML traz blocos <script> (inclusive um JSON-LD que repete os nomes das
    // categorias). Removemos todos antes de localizar os cards, senão casaríamos
    // com o nome dentro do JSON e não com o card de verdade.
    const corpo = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');

    const marcos = CATEGORIAS.map((nome) => ({ nome, pos: corpo.indexOf(nome) })).filter((m) => m.pos >= 0);
    marcos.sort((a, b) => a.pos - b.pos);

    const categorias: CategoriaDisponivel[] = [];
    for (let i = 0; i < marcos.length; i++) {
      const fim = i + 1 < marcos.length ? marcos[i + 1].pos : corpo.length;
      const trecho = corpo.slice(marcos[i].pos, fim);
      const aviso = trecho.match(/Apenas\s+(\d+)\s+dispon/i);
      categorias.push({ categoria: marcos[i].nome, restantes: aviso ? Number(aviso[1]) : null });
    }

    // Quando NENHUM apartamento serve para o período, o site troca a listagem
    // por um aviso e um calendário com as datas próximas. Basta um dia lotado no
    // meio do período para a busca inteira não retornar nada — foi o caso de
    // 22 a 29/11, travado pelo dia 28. Sem detectar isso, a Bella mandava o link
    // dizendo "seguem os valores" e o hóspede batia no aviso de indisponível.
    const semDisponibilidade = /n[ãa]o h[áa] disponibilidade/i.test(corpo);

    // Os dias lotados vêm marcados no calendário de datas próximas.
    const diasIndisponiveis = [
      ...new Set(
        [...corpo.matchAll(/data-tiposelecao="indisponivel"[^>]*data-data="(\d{2}\/\d{2}\/\d{4})"/g)].map(
          (m) => m[1],
        ),
      ),
    ];

    const presentes = new Set(categorias.map((c) => c.categoria));
    return {
      categorias,
      esgotadas: semDisponibilidade ? [] : CATEGORIAS.filter((c) => !presentes.has(c)),
      semDisponibilidade,
      diasIndisponiveis,
      consultadoEm: Date.now(),
    };
  }
}
