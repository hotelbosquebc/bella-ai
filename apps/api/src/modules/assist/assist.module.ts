import { Body, Controller, Module, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BellaModule } from '../bella/bella.module';
import { ModelRouterService } from '../bella/model-router.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PoliciesModule } from '../policies/policies.module';
import { PoliciesService } from '../policies/policies.service';
import { MASTER_PROMPT } from '../bella/prompts';

/**
 * Co-piloto do atendente (extensão do WhatsApp Web): sugere uma resposta a
 * partir do texto da conversa, SEM enviar nada e SEM criar registros. O humano
 * revisa e envia. Não há automação de envio — risco de ban praticamente nulo.
 */
@Controller('assist')
export class AssistController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: ModelRouterService,
    private readonly knowledge: KnowledgeService,
    private readonly policies: PoliciesService,
  ) {}

  @Post('suggest')
  async suggest(@Body() body: { hotelId?: string; conversation: string; lastMessage?: string }) {
    const hotelId = body.hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    const conversation = (body.conversation || '').slice(-6000); // últimas mensagens
    const focus = body.lastMessage || conversation;

    const [settings, hotel, relevantPolicies, knowledgeText] = await Promise.all([
      this.prisma.aiSettings.findUnique({ where: { hotelId } }),
      this.prisma.hotel.findUnique({ where: { id: hotelId } }),
      this.policies.findRelevant(hotelId, focus),
      this.knowledge.getKnowledgeContext(hotelId),
    ]);

    const system =
      (settings?.masterPrompt ?? MASTER_PROMPT)
        .replace('{{assistantName}}', settings?.assistantName ?? 'Bella')
        .replace(/\{\{hotelName\}\}/g, hotel?.name ?? 'Hotel do Bosque')
        .replace('{{personality}}', settings?.personality ?? 'acolhedora, educada e natural')
        .replace('{{guestContext}}', 'Atendimento em andamento pelo WhatsApp.')
        .replace('{{policiesContext}}', relevantPolicies.map((p) => `[${p.category}] ${p.content}`).join('\n') || 'Nenhuma.')
        .replace('{{knowledgeContext}}', knowledgeText || 'Nenhum.') +
      '\n\nVocê está SUGERINDO uma resposta para um atendente humano usar. Escreva apenas a mensagem sugerida ao hóspede, pronta para enviar, sem rótulos nem aspas.';

    const draft = await this.ai.complete({
      task: 'sales',
      system,
      messages: [{ role: 'user', content: `Conversa até aqui:\n${conversation}\n\nSugira a próxima resposta ao hóspede.` }],
      temperature: settings?.temperature ?? 0.7,
    });

    return { suggestion: draft.text, model: draft.model };
  }
}

@Module({
  imports: [BellaModule, KnowledgeModule, PoliciesModule],
  controllers: [AssistController],
})
export class AssistModule {}
