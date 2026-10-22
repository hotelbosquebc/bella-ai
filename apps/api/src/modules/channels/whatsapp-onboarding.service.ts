import { Injectable, Logger } from '@nestjs/common';

const GRAPH_VERSION = 'v21.0';

/**
 * Conclusao do Cadastro Incorporado (coexistencia do WhatsApp).
 *
 * O navegador faz o fluxo com a Meta e volta com um CODIGO de uso unico. Esse
 * codigo so vira token com a chave secreta do app - que vive no servidor e
 * nunca no navegador. E por isso que esta troca acontece aqui.
 *
 * O que a Meta devolve e um token de usuario com validade de ~60 dias. Isso
 * nao serve para um hotel que atende todo dia: em dois meses a Bella pararia
 * sozinha, no meio de um atendimento, sem ninguem entender por que. O token
 * definitivo e o de USUARIO DE SISTEMA, criado no Gerenciador de Negocios, e
 * esse e um passo humano - esta funcao diz isso com todas as letras em vez de
 * fingir que terminou.
 */
@Injectable()
export class WhatsAppOnboardingService {
  private readonly logger = new Logger(WhatsAppOnboardingService.name);

  async concluir(dados: { code: string; wabaId?: string; phoneNumberId?: string }) {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!appId || !appSecret) {
      return {
        ok: false,
        message: 'Faltam META_APP_ID e/ou META_APP_SECRET no servidor. Configure e tente de novo.',
      };
    }
    if (!dados?.code) {
      return { ok: false, message: 'A Meta nao devolveu o codigo do cadastro.' };
    }

    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&code=${encodeURIComponent(dados.code)}`;

    let token: string | null = null;
    try {
      const res = await fetch(url);
      const corpo: any = await res.json();
      if (!res.ok || !corpo?.access_token) {
        // O corpo do erro da Meta pode conter o codigo; nao vai para o log.
        this.logger.error(`Troca de codigo recusada pela Meta (HTTP ${res.status})`);
        return {
          ok: false,
          message:
            'A Meta recusou a troca do codigo. Os motivos mais comuns sao o dominio do painel nao estar na lista de dominios permitidos do app, ou o cadastro nao ter sido concluido ate o fim.',
        };
      }
      token = String(corpo.access_token);
    } catch (err) {
      this.logger.error(`Erro de rede ao trocar o codigo: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, message: 'Nao consegui falar com a Meta agora. Tente novamente em instantes.' };
    }

    // Os passos que a COEXISTENCIA exige logo depois da conexao, enquanto o
    // token ainda esta em maos (preparado em 22/10/2026, para o dia em que a
    // Meta aprovar a analise):
    //  1. inscrever o app na conta do WhatsApp - sem isso nenhuma mensagem
    //     chega ao webhook, mesmo com tudo configurado no app;
    //  2. pedir a sincronizacao dos contatos e do historico - a Meta da 24h
    //     para isso, e depois desse prazo so refazendo a conexao.
    // Cada passo diz se deu certo; nenhum derruba os outros.
    const passos = await this.posConexao(token, dados.wabaId, dados.phoneNumberId);
    const phoneNumberId = dados.phoneNumberId ?? passos.numeroDescoberto ?? null;

    // O token NAO e gravado em lugar nenhum: nem no banco, nem em log, nem na
    // resposta. O que volta e a identificacao dos ativos (que nao e segredo) e
    // a instrucao do passo humano que falta.
    this.logger.log(
      `Cadastro Incorporado concluido. waba=${dados.wabaId ?? '?'} numero=${phoneNumberId ?? '?'} passos=${JSON.stringify(passos.resultado)} (token descartado)`,
    );

    return {
      ok: true,
      wabaId: dados.wabaId ?? null,
      phoneNumberId,
      passos: passos.resultado,
      tokenRecebido: Boolean(token),
      instrucao:
        'Conexao autorizada com sucesso. ' +
        `Conta de mensagens: ${dados.wabaId ?? '(nao informada)'} | Numero: ${phoneNumberId ?? '(nao informado)'}. ` +
        'Falta UM passo, que so voce pode fazer: no Gerenciador de Negocios, crie um Usuario de Sistema com acesso a essa conta ' +
        'e gere um token permanente. Cole esse token no Render como WHATSAPP_ACCESS_TOKEN, e o numero como WHATSAPP_PHONE_NUMBER_ID. ' +
        'O token que a Meta acabou de devolver expira em cerca de 60 dias e por isso foi descartado - se usassemos ele, a Bella pararia sozinha daqui a dois meses.',
    };
  }

  private async posConexao(token: string | null, wabaId?: string, phoneNumberId?: string) {
    const resultado: Record<string, string> = {};
    let numeroDescoberto: string | undefined;
    if (!token) return { resultado: { erro: 'sem token' }, numeroDescoberto };

    const chamar = async (metodo: 'GET' | 'POST', caminho: string, corpo?: Record<string, string>) => {
      try {
        const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${caminho}`, {
          method: metodo,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: corpo ? JSON.stringify(corpo) : undefined,
        });
        const j: any = await r.json().catch(() => ({}));
        return j?.error ? { ok: false, j, erro: `${j.error.code ?? r.status}: ${String(j.error.message ?? '').slice(0, 160)}` } : { ok: r.ok, j, erro: '' };
      } catch (err) {
        return { ok: false, j: null, erro: String(err instanceof Error ? err.message : err).slice(0, 160) };
      }
    };

    if (!wabaId) {
      resultado.inscricao = 'nao feita: a Meta nao devolveu a conta (waba)';
      return { resultado, numeroDescoberto };
    }

    const inscricao = await chamar('POST', `${wabaId}/subscribed_apps`);
    resultado.inscricao = inscricao.ok ? 'ok' : `falhou (${inscricao.erro})`;

    // A janela da Meta nem sempre devolve o numero na coexistencia: busca na conta.
    if (!phoneNumberId) {
      const nums = await chamar('GET', `${wabaId}/phone_numbers?fields=id,display_phone_number`);
      const lista: any[] = nums.j?.data ?? [];
      const doHotel = lista.find((n) => String(n.display_phone_number || '').replace(/\D/g, '').endsWith('33670211')) ?? lista[0];
      numeroDescoberto = doHotel?.id;
      phoneNumberId = numeroDescoberto;
    }
    if (!phoneNumberId) {
      resultado.sincronizacao = 'nao feita: numero nao encontrado na conta';
      return { resultado, numeroDescoberto };
    }

    for (const tipo of ['smb_app_state_sync', 'history']) {
      const s = await chamar('POST', `${phoneNumberId}/smb_app_data`, { messaging_product: 'whatsapp', sync_type: tipo });
      resultado[tipo === 'history' ? 'historico' : 'contatos'] = s.ok ? 'pedida' : `falhou (${s.erro})`;
    }
    return { resultado, numeroDescoberto };
  }
}
