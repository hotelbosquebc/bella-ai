import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { NormalizedInboundMessage } from './channel.types';
import { BellaOrchestratorService } from '../bella/bella-orchestrator.service';
import { ModelRouterService } from '../bella/model-router.service';
import { PrismaService } from '../../prisma/prisma.service';

const GRAPH_VERSION = 'v21.0';

/**
 * Normaliza payloads dos provedores e encaminha para o orquestrador da Bella.
 * Notas de voz (áudio) são baixadas do canal e transcritas pelo Gemini antes
 * de seguir o mesmo fluxo de uma mensagem de texto.
 */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly bella: BellaOrchestratorService,
    private readonly ai: ModelRouterService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * As ultimas mensagens que chegaram pelos canais - sem o texto delas.
   *
   * O caminho dos canais (Meta -> webhook -> Bella -> resposta) e novo e eu
   * nao tinha NENHUMA visibilidade sobre ele: se o hospede escrevesse na
   * Pagina e nada acontecesse, a unica saida era adivinhar. Aqui fica o
   * registro do percurso: chegou, de qual canal, quanto tempo levou, se a
   * Bella respondeu ou se parou antes - e por que.
   *
   * Nada do que o hospede escreveu entra aqui, nem quem ele e. So o caminho.
   */
  readonly percurso: {
    quando: string;
    canal: string;
    tipo: string;
    caracteres: number;
    respondeu: boolean;
    motivo?: string;
    ms?: number;
  }[] = [];

  registrarPercurso(dados: {
    canal: string;
    tipo: string;
    caracteres: number;
    respondeu: boolean;
    motivo?: string;
    ms?: number;
  }) {
    this.percurso.push({ quando: new Date().toISOString(), ...dados });
    // Tambem no banco: a memoria some a cada deploy, e e por ela que eu
    // acompanho a lentidao dos canais ao longo dos dias. Sem await, para o
    // hospede nunca esperar por causa de um registro de diagnostico.
    this.prisma.diagnostico
      .create({
        data: {
          tipo: 'canal',
          motivo: dados.respondeu ? 'respondeu' : String(dados.motivo || 'parou').replace(/[0-9]+/g, 'N').slice(0, 120),
          canal: dados.canal,
          ms: dados.ms ?? null,
          detalhe: dados.tipo,
        },
      })
      .catch(() => {});
    if (this.percurso.length > 50) this.percurso.shift();
  }

  /**
   * A Pagina continua inscrita no app? So LEITURA na Graph API.
   *
   * Em 21/10/2026 nenhuma mensagem do Messenger/Instagram chegava - nem a de
   * um administrador do app, que o modo desenvolvimento entregaria. O painel
   * da Meta nao pode ser mexido durante a Analise do App, mas consultar nao
   * muda nada: aqui perguntamos a Meta, com o token da Pagina que ja esta no
   * servidor, se a inscricao (subscribed_apps) e o token estao de pe.
   * Nenhum token sai na resposta.
   */
  async diagnosticoMeta() {
    const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    const pagina = process.env.FACEBOOK_PAGE_ID;
    if (!token || !pagina) return { erro: 'FACEBOOK_PAGE_ACCESS_TOKEN ou FACEBOOK_PAGE_ID ausente' };
    const ler = async (caminho: string) => {
      try {
        const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${caminho}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j: any = await r.json();
        return j?.error ? { erro: `${j.error.code ?? ''} ${j.error.type ?? ''}: ${String(j.error.message ?? '').slice(0, 200)}` } : j;
      } catch (err) {
        return { erro: String(err instanceof Error ? err.message : err).slice(0, 200) };
      }
    };
    const [eu, inscricoes, instagram] = await Promise.all([
      ler('me?fields=id,name'),
      ler(`${pagina}/subscribed_apps`),
      ler(`${pagina}?fields=instagram_business_account{id,username}`),
    ]);
    return {
      tokenDaPagina: eu?.erro ? { valido: false, erro: eu.erro } : { valido: true, id: eu?.id, nome: eu?.name },
      paginaConfigurada: pagina,
      inscricoes: inscricoes?.erro
        ? { erro: inscricoes.erro }
        : (inscricoes?.data || []).map((a: any) => ({ app: a.id, nome: a.name, campos: a.subscribed_fields })),
      instagram: instagram?.erro ? { erro: instagram.erro } : instagram?.instagram_business_account ?? null,
    };
  }

  /**
   * Reinscreve a Pagina no app com os campos de MENSAGEM.
   *
   * Achado de 21/10/2026: a Pagina estava inscrita so no campo "name" (aviso
   * de troca de nome). Sem "messages", a Meta nao entregava nenhuma mensagem
   * do Messenger nem do Instagram - nem a de um administrador do app. O
   * hospede via so a resposta automatica do Business Suite.
   *
   * E a mesma chamada que a configuracao inicial faz, com o token da Pagina
   * que ja esta no servidor. Nao mexe nas configuracoes do APP (o que esta
   * em analise na Meta) - so diz a Meta quais avisos DESTA Pagina mandar.
   * So roda quando o dono clica no painel.
   */
  async religarPagina() {
    const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    const pagina = process.env.FACEBOOK_PAGE_ID;
    if (!token || !pagina) return { ok: false, erro: 'FACEBOOK_PAGE_ACCESS_TOKEN ou FACEBOOK_PAGE_ID ausente' };
    const campos = ['messages', 'messaging_postbacks'];
    try {
      const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pagina}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `subscribed_fields=${encodeURIComponent(campos.join(','))}`,
      });
      const j: any = await r.json();
      if (j?.error) {
        return { ok: false, erro: `${j.error.code ?? ''}: ${String(j.error.message ?? '').slice(0, 200)}` };
      }
      this.logger.warn(`Pagina ${pagina} reinscrita no app com: ${campos.join(', ')}`);
      return { ok: Boolean(j?.success), depois: await this.diagnosticoMeta() };
    } catch (err) {
      return { ok: false, erro: String(err instanceof Error ? err.message : err).slice(0, 200) };
    }
  }

  /** As ultimas passagens gravadas no banco (canal, motivo, tempo) - nenhum texto. */
  async percursoGravado() {
    try {
      const linhas = await this.prisma.diagnostico.findMany({
        where: { tipo: 'canal' },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      return linhas.map((l) => ({ quando: l.createdAt, canal: l.canal, motivo: l.motivo, tipo: l.detalhe, ms: l.ms }));
    } catch (err) {
      // Lista vazia por ERRO nao pode parecer "nada chegou".
      return [{ erroAoLer: String(err instanceof Error ? err.message : err).slice(0, 200) }];
    }
  }

  private get hotelId() {
    return process.env.DEFAULT_HOTEL_ID ?? 'hotel-do-bosque';
  }

  /**
   * A mensagem foi mesmo para a NOSSA Pagina?
   *
   * O app da Meta pode ter mais de uma Pagina conectada - no Hotel do Bosque
   * ha tambem a do NUT Restaurante, de outro portfolio, que o dono nem tem
   * permissao para desvincular. Sem esta conferencia, uma mensagem enviada ao
   * restaurante chegaria aqui e a Bella responderia como se fosse o hotel,
   * falando de diarias e mandando link de reserva para quem perguntou de
   * comida.
   *
   * Assinar o webhook so para a Pagina certa ja resolve - mas isso e
   * configuracao, e configuracao se perde num clique. Esta trava fica no
   * codigo.
   *
   * Sem FACEBOOK_PAGE_ID configurado nao filtramos nada: e melhor atender
   * tudo do que, por falta de variavel, parar de atender em silencio.
   */
  private paginaCorreta(channel: Channel, entry: any, evento: any): boolean {
    if (channel !== Channel.FACEBOOK) return true;
    const nossa = process.env.FACEBOOK_PAGE_ID;
    if (!nossa) return true;
    const destino = String(evento?.recipient?.id ?? entry?.id ?? '');
    if (!destino || destino === String(nossa)) return true;
    this.logger.warn(`Mensagem ignorada: foi para a Pagina ${destino}, e a nossa e ${nossa}`);
    return false;
  }

  /**
   * Webhook da Meta. Trata os DOIS formatos:
   *  - WhatsApp: entry[].changes[].value.messages[]  (remetente em msg.from)
   *  - Messenger/Instagram: entry[].messaging[]       (remetente em sender.id)
   */
  async ingestMetaWebhook(channel: Channel, payload: any): Promise<void> {
    for (const entry of payload?.entry ?? []) {
      // Formato WhatsApp (changes/value/messages)
      for (const change of entry.changes ?? []) {
        const contacts = change.value?.contacts ?? [];
        for (const msg of change.value?.messages ?? []) {
          // Nota de voz do WhatsApp → transcreve; texto → usa direto
          const isAudio = msg.type === 'audio' || msg.type === 'voice';
          const content = isAudio
            ? await this.transcribeWhatsappAudio(msg.audio?.id ?? msg.voice?.id, msg.audio?.mime_type)
            : msg.text?.body ?? '';
          await this.dispatch({
            hotelId: this.hotelId,
            channel,
            senderExternalId: msg.from,
            senderName: contacts[0]?.profile?.name,
            content,
            contentType: isAudio ? 'audio' : msg.type === 'text' ? 'text' : 'document',
            receivedAt: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date(),
            raw: payload,
          });
        }
      }

      // Formato Messenger / Instagram Direct (messaging)
      for (const event of entry.messaging ?? []) {
        if (!event.message || event.message.is_echo) continue; // ignora ecos do próprio bot
        if (!this.paginaCorreta(channel, entry, event)) continue;

        // Anexo no Instagram/Messenger: ate 16/10/2026 isso era DESCARTADO em
        // silencio. O texto vinha vazio, o dispatch desistia por "sem
        // conteudo", e o hospede que mandava um audio nao recebia resposta
        // nenhuma - sem erro, sem aviso, sem ninguem saber.
        //
        // Audio agora e transcrito (os dois canais entregam a URL direto, sem
        // token). Os outros anexos viram um marcador: a Bella precisa saber
        // que chegou alguma coisa, mesmo sem conseguir ler, para nao responder
        // como se o hospede tivesse ficado calado.
        const anexo = (event.message.attachments ?? [])[0];
        let conteudo: string = event.message?.text ?? '';
        let tipo: 'text' | 'image' | 'audio' | 'document' = 'text';

        if (!conteudo && anexo) {
          const url = anexo?.payload?.url;
          if (anexo.type === 'audio' && url) {
            tipo = 'audio';
            const transcrito = await this.transcreverPorUrl(url);
            conteudo = transcrito || '[mensagem de voz — não foi possível transcrever]';
          } else {
            tipo = anexo.type === 'image' ? 'image' : 'document';
            const nome = { image: 'uma imagem', video: 'um vídeo', file: 'um arquivo' }[String(anexo.type)] ?? 'um anexo';
            conteudo = `[o hóspede enviou ${nome}]`;
          }
        }

        await this.dispatch({
          hotelId: this.hotelId,
          channel,
          senderExternalId: event.sender?.id,
          content: conteudo,
          contentType: tipo,
          receivedAt: event.timestamp ? new Date(Number(event.timestamp)) : new Date(),
          raw: payload,
        });
      }
    }
  }

  /**
   * Webhook do Telegram (Bot API). O chat.id é usado como identificador do
   * remetente e como destino das respostas (sendMessage chat_id).
   */
  async ingestTelegramWebhook(payload: any): Promise<void> {
    const msg = payload?.message ?? payload?.edited_message;
    if (!msg?.chat?.id) return;
    const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username;

    // Nota de voz / áudio do Telegram → transcreve
    const voice = msg.voice ?? msg.audio;
    let content = msg.text ?? msg.caption ?? '';
    let contentType: NormalizedInboundMessage['contentType'] = msg.text ? 'text' : 'document';
    if (voice?.file_id) {
      content = await this.transcribeTelegramAudio(voice.file_id, voice.mime_type ?? 'audio/ogg');
      contentType = 'audio';
    }

    await this.dispatch({
      hotelId: this.hotelId,
      channel: Channel.TELEGRAM,
      senderExternalId: String(msg.chat.id),
      senderName: name,
      content,
      contentType,
      receivedAt: msg.date ? new Date(Number(msg.date) * 1000) : new Date(),
      raw: payload,
    });
  }

  /**
   * Transcreve um audio a partir da URL que o proprio webhook entrega.
   *
   * O Instagram e o Messenger mandam o anexo com uma URL direta de CDN, ja
   * assinada - diferente do WhatsApp, que da um ID e exige duas chamadas com
   * token. Por isso esta funcao existe separada da do WhatsApp.
   */
  private async transcreverPorUrl(url: string, mimeType = 'audio/mp4'): Promise<string> {
    try {
      const base64 = await this.fetchAsBase64(url);
      const texto = await this.ai.transcribeAudio(base64, mimeType);
      this.logger.log(`Áudio de canal transcrito (${texto.length} caracteres)`);
      return texto;
    } catch (err) {
      this.logger.error(`Falha ao transcrever áudio por URL: ${err instanceof Error ? err.message : err}`);
      return '';
    }
  }

  /** Baixa a nota de voz do WhatsApp (Graph media API) e transcreve. */
  private async transcribeWhatsappAudio(mediaId?: string, mimeType = 'audio/ogg'): Promise<string> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!mediaId || !token) return '';
    try {
      // 1) resolve a URL temporária da mídia
      const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meta: any = await metaRes.json();
      if (!meta?.url) return '';
      // 2) baixa os bytes (também exige o token) e transcreve
      const base64 = await this.fetchAsBase64(meta.url, { Authorization: `Bearer ${token}` });
      const text = await this.ai.transcribeAudio(base64, meta.mime_type ?? mimeType);
      this.logger.log(`Áudio WhatsApp transcrito (${text.length} caracteres)`);
      return text;
    } catch (err) {
      this.logger.error(`Falha ao transcrever áudio do WhatsApp: ${err instanceof Error ? err.message : err}`);
      return '';
    }
  }

  /** Baixa a nota de voz do Telegram (getFile) e transcreve. */
  private async transcribeTelegramAudio(fileId: string, mimeType = 'audio/ogg'): Promise<string> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return '';
    try {
      const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
      const info: any = await infoRes.json();
      const path = info?.result?.file_path;
      if (!path) return '';
      const base64 = await this.fetchAsBase64(`https://api.telegram.org/file/bot${token}/${path}`);
      const text = await this.ai.transcribeAudio(base64, mimeType);
      this.logger.log(`Áudio Telegram transcrito (${text.length} caracteres)`);
      return text;
    } catch (err) {
      this.logger.error(`Falha ao transcrever áudio do Telegram: ${err instanceof Error ? err.message : err}`);
      return '';
    }
  }

  /** Baixa um arquivo e devolve em base64 (para enviar ao Gemini). */
  private async fetchAsBase64(url: string, headers: Record<string, string> = {}): Promise<string> {
    const res = await fetch(url, { headers });
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  }

  /** Canais genéricos (chat do site, e-mail, testes): { from, name, text } */
  async ingestGenericWebhook(channel: Channel, payload: any): Promise<void> {
    await this.dispatch({
      hotelId: payload.hotelId ?? this.hotelId,
      channel,
      senderExternalId: payload.from,
      senderName: payload.name,
      content: payload.text ?? payload.content ?? '',
      contentType: 'text',
      receivedAt: new Date(),
      raw: payload,
    });
  }

  private async dispatch(message: NormalizedInboundMessage): Promise<void> {
    const t0 = Date.now();
    if (!message.senderExternalId || !message.content) {
      this.logger.debug(`Evento ${message.channel} ignorado (sem remetente ou conteúdo)`);
      this.registrarPercurso({
        canal: String(message.channel),
        tipo: message.contentType,
        caracteres: (message.content || '').length,
        respondeu: false,
        motivo: !message.senderExternalId ? 'sem remetente' : 'sem conteudo',
      });
      return;
    }
    this.logger.log(`Mensagem recebida via ${message.channel} de ${message.senderExternalId}`);
    try {
      // TODO: publicar em RabbitMQ (inbound.messages) e consumir no orquestrador
      await this.bella.handleInbound(message);
      this.registrarPercurso({
        canal: String(message.channel),
        tipo: message.contentType,
        caracteres: message.content.length,
        respondeu: true,
        ms: Date.now() - t0,
      });
    } catch (err) {
      // Webhook nunca deve falhar para o provedor (a Meta/Telegram desativam endpoints com erro)
      this.logger.error(`Falha ao processar mensagem de ${message.senderExternalId}`, err instanceof Error ? err.stack : String(err));
      this.registrarPercurso({
        canal: String(message.channel),
        tipo: message.contentType,
        caracteres: message.content.length,
        respondeu: false,
        motivo: 'erro: ' + (err instanceof Error ? err.message : String(err)).slice(0, 80),
        ms: Date.now() - t0,
      });
    }
  }

  getChannelStatus(channel: Channel) {
    const configured: Record<string, boolean> = {
      WHATSAPP: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      INSTAGRAM: Boolean(process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN),
      FACEBOOK: Boolean(process.env.FACEBOOK_PAGE_ACCESS_TOKEN),
      TELEGRAM: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    };
    return { channel, connected: configured[channel] ?? false };
  }
}
