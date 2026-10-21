import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { assinaturaDaMetaConfere } from './meta-assinatura';
import { ChannelsService } from './channels.service';

/**
 * Deixa passar so o que a Meta assinou.
 *
 * Fica nos POST dos webhooks. Os GET de verificacao nao sao assinados - eles
 * se defendem pelo hub.verify_token, que e segredo nosso tambem.
 */
@Injectable()
export class MetaWebhookGuard implements CanActivate {
  private readonly logger = new Logger(MetaWebhookGuard.name);

  constructor(private readonly channels: ChannelsService) {}

  canActivate(context: ExecutionContext): boolean {
    const req: any = context.switchToHttp().getRequest();
    const cabecalho = req.headers?.['x-hub-signature-256'];
    const segredo = process.env.META_APP_SECRET;
    const ok = assinaturaDaMetaConfere(req.rawBody, cabecalho, segredo);
    if (!ok) {
      const motivo = !segredo
        ? 'META_APP_SECRET nao configurado'
        : !cabecalho
          ? 'chamada sem assinatura'
          : req.rawBody === undefined
            ? 'corpo cru indisponivel'
            : 'assinatura nao confere (segredo do app diferente?)';
      // Sem texto do payload no log: a mensagem do hospede nao vira registro.
      this.logger.warn(`Webhook recusado em ${req.originalUrl || req.url}: ${motivo}`);
      // A recusa tambem vai para o diagnostico. Ate 21/10/2026 ela acontecia
      // ANTES de qualquer registro, e "a Meta nao entregou" ficava
      // indistinguivel de "entregou e nos recusamos na porta".
      const url = String(req.originalUrl || req.url || '');
      const canal = /instagram/.test(url) ? 'INSTAGRAM' : /facebook/.test(url) ? 'FACEBOOK' : /whatsapp/.test(url) ? 'WHATSAPP' : 'desconhecido';
      this.channels.registrarPercurso({ canal, tipo: 'webhook', caracteres: 0, respondeu: false, motivo: 'recusado na porta: ' + motivo });
      throw new ForbiddenException('assinatura invalida');
    }
    return true;
  }
}
