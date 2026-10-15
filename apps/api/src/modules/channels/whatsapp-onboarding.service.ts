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

    // O token NAO e gravado em lugar nenhum: nem no banco, nem em log, nem na
    // resposta. O que volta e a identificacao dos ativos (que nao e segredo) e
    // a instrucao do passo humano que falta.
    this.logger.log(
      `Cadastro Incorporado concluido. waba=${dados.wabaId ?? '?'} numero=${dados.phoneNumberId ?? '?'} (token recebido e descartado)`,
    );

    return {
      ok: true,
      wabaId: dados.wabaId ?? null,
      phoneNumberId: dados.phoneNumberId ?? null,
      tokenRecebido: Boolean(token),
      instrucao:
        'Conexao autorizada com sucesso. ' +
        `Conta de mensagens: ${dados.wabaId ?? '(nao informada)'} | Numero: ${dados.phoneNumberId ?? '(nao informado)'}. ` +
        'Falta UM passo, que so voce pode fazer: no Gerenciador de Negocios, crie um Usuario de Sistema com acesso a essa conta ' +
        'e gere um token permanente. Cole esse token no Render como WHATSAPP_ACCESS_TOKEN, e o numero como WHATSAPP_PHONE_NUMBER_ID. ' +
        'O token que a Meta acabou de devolver expira em cerca de 60 dias e por isso foi descartado - se usassemos ele, a Bella pararia sozinha daqui a dois meses.',
    };
  }
}
