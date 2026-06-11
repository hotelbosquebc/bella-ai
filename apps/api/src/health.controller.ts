import { Controller, Get } from '@nestjs/common';

/** Usado pelo Render (health check) e pelo cron-job.org (manter a API acordada). */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', service: 'bella-ai-api', timestamp: new Date().toISOString() };
  }
}
