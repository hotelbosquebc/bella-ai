import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { assinaturaDaMetaConfere } from './meta-assinatura';

/**
 * Deixa passar so o que a Meta assinou.
 *
 * Fica nos POST dos webhooks. Os GET de verificacao nao sao assinados - eles
 * se defendem pelo hub.verify_token, que e segredo nosso tambem.
 */
@Injectable()
export class MetaWebhookGuard implements CanActivate {
  private readonly logger = new Logger(MetaWebhookGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req: any = context.switchToHttp().getRequest();
    const ok = assinaturaDaMetaConfere(
      req.rawBody,
      req.headers?.['x-hub-signature-256'],
      process.env.META_APP_SECRET,
    );
    if (!ok) {
      // Sem texto do payload no log: a mensagem do hospede nao vira registro.
      this.logger.warn(
        `Webhook recusado em ${req.originalUrl || req.url}: assinatura ausente ou invalida` +
          (process.env.META_APP_SECRET ? '' : ' (META_APP_SECRET nao configurado)'),
      );
      throw new ForbiddenException('assinatura invalida');
    }
    return true;
  }
}
