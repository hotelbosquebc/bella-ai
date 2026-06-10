import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Auditoria total: registro imutável de toda interação da Bella.
 * Somente inserção — nunca atualização ou exclusão.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(entry: {
    conversationId: string;
    question: string;
    response: string;
    sources: string[];
    policyUsed: string | null;
    confidence: number;
    model: string;
    guardrailLevel: number;
    escalated: boolean;
  }) {
    return this.prisma.aiAudit.create({ data: { ...entry, sources: entry.sources } });
  }

  list(conversationId?: string) {
    return this.prisma.aiAudit.findMany({
      where: conversationId ? { conversationId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
