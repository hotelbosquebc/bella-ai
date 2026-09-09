import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Anexos da Bella (regras de pets, catálogo de ingressos) sobem em base64 e
  // passam de 10 MB — o limite padrão de 100 kb rejeitaria o upload.
  const { json, urlencoded } = require('express');
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // CORS restrito às origens que realmente usam a API: o painel na Vercel e a
  // extensão (que envia Origin chrome-extension://...). Antes era enableCors()
  // sem argumento, que libera QUALQUER site a chamar a API do navegador.
  // ORIGENS_PERMITIDAS aceita uma lista separada por vírgula, para quando o
  // endereço do painel mudar.
  const origensFixas = [/^chrome-extension:\/\//, /^https:\/\/.*\.vercel\.app$/];
  const extras = (process.env.ORIGENS_PERMITIDAS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin, callback) => {
      // Sem Origin: curl, healthcheck do Render, webhooks. Não é navegador.
      if (!origin) return callback(null, true);
      const ok = origensFixas.some((r) => r.test(origin)) || extras.includes(origin);
      return callback(null, ok);
    },
  });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
