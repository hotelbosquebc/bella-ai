import { Controller, Get } from '@nestjs/common';
import { Public } from './modules/auth/public.decorator';

/** Usado pelo Render (health check) e pelo GitHub Actions (manter a API acordada). */
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'bella-ai-api',
      timestamp: new Date().toISOString(),
      // QUAL codigo esta rodando. Em 20/10/2026 uma correcao publicada no dia
      // anterior parecia nao ter efeito, e nao havia como saber se o Render
      // tinha republicado ou se a correcao e que estava errada - as duas
      // hipoteses tem conserto bem diferente. O Render preenche estas duas
      // variaveis sozinho em cada deploy; local elas nao existem.
      commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7),
      publicadoEm: process.env.RENDER_GIT_COMMIT ? undefined : 'ambiente local',
    };
  }
}
