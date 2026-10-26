import { Controller, Get, Injectable, Logger, Module, Post } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MessageSender } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BellaModule } from '../bella/bella.module';
import { ModelRouterService } from '../bella/model-router.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { auditarResposta, Achado } from '../../common/auditoria-respostas';
import { ehMensagemDeEspera } from '../../common/mensagem-espera';

const HOTEL = () => process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';

/**
 * Auditoria diaria das respostas da Bella (pedido do dono, 26/10/2026).
 *
 * Todo dia confere o que a Bella ESCREVEU nas ultimas 24h - sugestoes da
 * extensao e respostas automaticas dos canais:
 *   1. checagem no codigo (auditarResposta): preco, promessa de registro,
 *      rascunho, link de fora, texto quebrado...;
 *   2. alucinacao: a IA confere uma amostra contra a base de conhecimento e
 *      aponta afirmacao que a base nao sustenta;
 *   3. o dia das decisoes: por que nao saiu link, que formatos nao foram lidos.
 *
 * So APONTA. Nada muda na Bella sozinho - o dono decide (mesma trava do
 * aprendizado diario). O relatorio fica no banco (Diagnostico tipo
 * "auditoria") e aparece na tela Aprendizado.
 *
 * As 9h30: o Render gratuito dorme sem uso, e a essa hora a extensao ja o
 * mantem acordado. Se nao rodar, o botao do painel roda na hora.
 */
@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);
  private rodando = false;
  private conferenciaRodou = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: ModelRouterService,
    private readonly knowledge: KnowledgeService,
  ) {}

  @Cron('30 9 * * *', { timeZone: 'America/Sao_Paulo' })
  async diaria() {
    await this.rodar().catch((err) => this.logger.error(`Auditoria diaria falhou: ${err instanceof Error ? err.message : err}`));
  }

  async rodar() {
    if (this.rodando) return { ok: false, motivo: 'auditoria ja em andamento' };
    this.rodando = true;
    try {
      const ate = new Date();
      const desde = new Date(ate.getTime() - 24 * 3600 * 1000);

      // O que a Bella escreveu: sugestoes da extensao + respostas automaticas.
      const sugestoes = await this.prisma.suggestionFeedback.findMany({
        where: { hotelId: HOTEL(), createdAt: { gte: desde } },
        select: { sugestao: true, acao: true },
        orderBy: { createdAt: 'desc' },
        take: 400,
      });
      const automaticas = await this.prisma.message.findMany({
        where: { sender: MessageSender.BELLA, timestamp: { gte: desde } },
        select: { content: true, conversation: { select: { channel: true } } },
        orderBy: { timestamp: 'desc' },
        take: 400,
      });
      const textos = [
        ...sugestoes.map((s) => ({ origem: 'extensão', texto: s.sugestao || '' })),
        ...automaticas
          .filter((m) => !ehMensagemDeEspera(m.content || ''))
          .map((m) => ({ origem: `automático ${m.conversation?.channel ?? ''}`.trim(), texto: m.content || '' })),
      ].filter((x) => x.texto.trim());

      // 1. Checagem no codigo.
      const porTipo: Record<string, { gravidade: string; quantas: number; exemplos: { origem: string; trecho: string }[] }> = {};
      for (const { origem, texto } of textos) {
        for (const a of auditarResposta(texto) as Achado[]) {
          const g = (porTipo[a.tipo] = porTipo[a.tipo] || { gravidade: a.gravidade, quantas: 0, exemplos: [] });
          g.quantas++;
          if (g.exemplos.length < 4) g.exemplos.push({ origem, trecho: a.trecho });
        }
      }

      // 2. Alucinacao: amostra conferida contra a base de conhecimento.
      this.conferenciaRodou = false;
      const alucinacoes = await this.conferirComABase(textos.map((x) => x.texto));

      // 3. O dia das decisoes (por que saiu ou nao saiu link).
      const decisoes = await this.prisma.diagnostico.findMany({
        where: { tipo: 'decisao', createdAt: { gte: desde } },
        select: { motivo: true },
        take: 3000,
      });
      const motivos: Record<string, number> = {};
      for (const d of decisoes) motivos[d.motivo] = (motivos[d.motivo] || 0) + 1;
      const principaisMotivos = Object.entries(motivos)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([motivo, n]) => ({ motivo, n }));
      const naoLidos = principaisMotivos.filter((m) => /^faltam dados/.test(m.motivo));

      // Grave e o que o CODIGO acha. O que a IA aponta e para revisar: a
      // primeira rodada (26/10/2026) marcou como "alucinacao" textos oficiais
      // do hotel - julgamento de IA nao pode pintar o painel de vermelho sozinho.
      const graves = Object.values(porTipo).filter((g) => g.gravidade === 'grave').reduce((s, g) => s + g.quantas, 0);

      const relatorio = {
        periodo: { desde: desde.toISOString(), ate: ate.toISOString() },
        respostasConferidas: textos.length,
        sugestoesDaExtensao: sugestoes.length,
        respostasAutomaticas: textos.length - sugestoes.length,
        graves,
        porTipo,
        alucinacoes,
        conferenciaComABase: this.conferenciaRodou ? 'feita' : 'não rodou (IA indisponível ou sem respostas)',
        decisoes: { total: decisoes.length, principaisMotivos, naoLidos },
        acoesSugeridas: this.acoes(porTipo, alucinacoes, naoLidos),
      };

      await this.prisma.diagnostico.create({
        data: {
          tipo: 'auditoria',
          motivo: graves ? `${graves} problema(s) grave(s) em ${textos.length} respostas` : `sem problema grave em ${textos.length} respostas`,
          detalhe: JSON.stringify(relatorio),
        },
      });
      this.logger.log(`Auditoria diaria: ${textos.length} respostas, ${graves} grave(s)`);
      return { ok: true, ...relatorio };
    } finally {
      this.rodando = false;
    }
  }

  /**
   * A IA le as respostas ao lado da base e aponta o que a base nao sustenta.
   * Uma chamada so, com amostra: e analise do dia, nao de cada mensagem.
   */
  private async conferirComABase(textos: string[]) {
    const amostra = [...new Set(textos.map((t) => t.trim()))]
      .filter((t) => t.length > 80)
      .slice(0, 25);
    if (!amostra.length) return [];
    const base = await this.knowledge.getKnowledgeContext(HOTEL(), 40000).catch(() => '');
    if (!base) return [];
    const resposta = await this.ai.complete({
      task: 'policy_answer',
      system:
        `Você audita as respostas de uma assistente de hotel. Abaixo está a BASE DE CONHECIMENTO oficial do hotel ` +
        `e uma lista de respostas que a assistente escreveu.\n` +
        `Para cada resposta, encontre AFIRMAÇÕES SOBRE O HOTEL que a base não sustenta ou que a contradizem ` +
        `(horários, estrutura, serviços, regras, distâncias, política de crianças, pet, estacionamento, café, etc.).\n` +
        `Ignore: saudações, pedidos de dados, links, frases de cortesia, a data e a ocupação do hóspede.\n` +
        `São FALAS OFICIAIS DO HOTEL, permitidas mesmo sem estar na base: encaminhar ao setor responsável ou à equipe de reservas; ` +
        `"um atendente assume"; oferecer fazer a reserva pelo WhatsApp com pagamento via PIX com o especialista; o horário do setor ` +
        `de reservas e o telefone da recepção 24h; dizer que o link mostra valores e disponibilidade; a apresentação "Sou a Bella".\n` +
        `Só aponte o que for afirmação concreta e errada ou inventada. Na dúvida, não aponte.\n` +
        `Responda SOMENTE com JSON: {"achados":[{"resposta":N,"afirmacao":"trecho curto","motivo":"o que a base diz"}]}. ` +
        `Sem achados: {"achados":[]}.\n\nBASE DE CONHECIMENTO:\n${base}`,
      messages: [{ role: 'user', content: amostra.map((t, i) => `RESPOSTA ${i + 1}:\n${t.slice(0, 900)}`).join('\n\n') }],
      temperature: 0,
    });
    // IA fora: o relatorio diz que a conferencia nao rodou, em vez de "nada achado".
    if (!resposta.text || resposta.model === 'mock') {
      this.conferenciaRodou = false;
      return [];
    }
    this.conferenciaRodou = true;
    try {
      const bruto = resposta.text.replace(/```json|```/g, '');
      const j = JSON.parse(bruto.slice(bruto.indexOf('{'), bruto.lastIndexOf('}') + 1));
      return (Array.isArray(j?.achados) ? j.achados : [])
        .slice(0, 15)
        .map((a: any) => ({
          trecho: String(amostra[Number(a.resposta) - 1] || '').slice(0, 200),
          afirmacao: String(a.afirmacao || '').slice(0, 200),
          motivo: String(a.motivo || '').slice(0, 200),
        }));
    } catch {
      return [];
    }
  }

  /** O que fazer com o que foi achado, em linguagem do dono. */
  private acoes(porTipo: Record<string, { gravidade: string; quantas: number }>, alucinacoes: any[], naoLidos: any[]) {
    const a: string[] = [];
    const graves = Object.entries(porTipo).filter(([, g]) => g.gravidade === 'grave');
    if (graves.length) a.push(`Erros graves passaram pelas travas (${graves.map(([t, g]) => `${t}: ${g.quantas}`).join('; ')}). Peça ao Claude para investigar a trava correspondente.`);
    if (alucinacoes.length) a.push(`Para revisar: ${alucinacoes.length} afirmação(ões) que, pela conferência da IA, a base de conhecimento não sustenta. Veja se é erro de verdade; se for, corrija a base ou peça ao Claude uma trava.`);
    if (naoLidos.length) a.push(`Pedidos que a Bella não conseguiu ler (${naoLidos.reduce((s: number, m: any) => s + m.n, 0)} vezes). Os formatos estão listados; peça ao Claude para ensinar a leitura.`);
    if (!a.length) a.push('Nada grave no período. Nenhuma ação necessária.');
    return a;
  }

  async ultima() {
    const d = await this.prisma.diagnostico.findFirst({ where: { tipo: 'auditoria' }, orderBy: { createdAt: 'desc' } });
    if (!d) return { existe: false };
    let relatorio: any = {};
    try {
      relatorio = JSON.parse(d.detalhe || '{}');
    } catch {
      /* relatorio antigo ou corrompido */
    }
    return { existe: true, quando: d.createdAt, resumo: d.motivo, ...relatorio };
  }
}

@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  /** O ultimo relatorio (com trechos das respostas: exige login). */
  @Get('ultima')
  ultima() {
    return this.auditoria.ultima();
  }

  /** Roda agora (botao do painel). */
  @Post('rodar')
  rodar() {
    return this.auditoria.rodar();
  }
}

@Module({
  imports: [BellaModule, KnowledgeModule],
  providers: [AuditoriaService],
  controllers: [AuditoriaController],
})
export class AuditoriaModule {}
