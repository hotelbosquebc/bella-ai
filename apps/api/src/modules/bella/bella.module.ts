import { Module } from '@nestjs/common';
import { BellaOrchestratorService } from './bella-orchestrator.service';
import { GuardrailsService } from './guardrails.service';
import { ModelRouterService } from './model-router.service';
import { MemoryService } from './memory.service';
import { FollowUpService } from './follow-up.service';
import { ReservationsModule } from '../reservations/reservations.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PoliciesModule } from '../policies/policies.module';
import { AuditModule } from '../audit/audit.module';
import { OutboundModule } from '../outbound/outbound.module';

@Module({
  imports: [ReservationsModule, KnowledgeModule, PoliciesModule, AuditModule, OutboundModule],
  providers: [
    BellaOrchestratorService,
    GuardrailsService,
    ModelRouterService,
    MemoryService,
    FollowUpService,
  ],
  exports: [BellaOrchestratorService, ModelRouterService],
})
export class BellaModule {}
