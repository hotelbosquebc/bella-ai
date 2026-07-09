import { Controller, Get } from '@nestjs/common';
import { Public } from './modules/auth/public.decorator';

/** Usado pelo Render (health check) e pelo GitHub Actions (manter a API acordada). */
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', service: 'bella-ai-api', timestamp: new Date().toISOString() };
  }
}
