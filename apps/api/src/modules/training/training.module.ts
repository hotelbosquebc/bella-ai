import { Body, Controller, Module, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BellaModule } from '../bella/bella.module';
import { ModelRouterService } from '../bella/model-router.service';

/** Ferramenta de extração estruturada a partir de conversas reais. */
const EXTRACT_TOOL = {
  name: 'extract_knowledge',
  input_schema: {
    type: 'object' as const,
    properties: {
      entries: {
        type: 'array',
        description:
          'Lista de conhecimentos extraídos das conversas. Cada item é um objeto com "titulo" (assunto curto, ex.: "Café da manhã") e "conteudo" (o fato sobre o hotel OU uma pergunta frequente com a resposta que o hotel deu). Extraia SOMENTE informações factuais e objetivas sobre o hotel e dúvidas recorrentes de hóspedes. NÃO invente nada que não esteja explícito nas conversas. Ignore dados pessoais, valores/promoções específicas e datas pontuais.',
      },
    },
    required: ['entries'],
  },
};

@Controller('training')
export class TrainingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: ModelRouterService,
  ) {}

  /**
   * Importa uma conversa exportada do WhatsApp (texto), extrai conhecimentos
   * com a IA e cria itens INATIVOS para revisão do hotel (não afetam a Bella
   * até serem ativados na tela de Conhecimento).
   */
  @Post('import-whatsapp')
  async importWhatsapp(@Body() body: { hotelId: string; content: string; source?: string }) {
    const text = (body.content ?? '').slice(0, 30000); // limita o tamanho enviado à IA
    if (text.trim().length < 20) {
      return { created: 0, entries: [], message: 'Conteúdo muito curto.' };
    }

    const result = await this.ai.complete({
      task: 'general',
      system:
        'Você analisa conversas reais de atendimento de um hotel e extrai conhecimento para treinar um assistente. ' +
        'Foque em informações úteis e recorrentes sobre o hotel e em perguntas frequentes de hóspedes com as respostas dadas.',
      messages: [{ role: 'user', content: `Conversas exportadas do WhatsApp:\n\n${text}` }],
      temperature: 0,
      tools: [EXTRACT_TOOL],
    });

    const raw = (result.toolInput?.entries as Array<{ titulo?: string; conteudo?: string }>) ?? [];
    const valid = raw.filter((e) => e?.titulo && e?.conteudo);

    // Cria como INATIVO (active: false) para revisão antes de valer para a Bella
    const created = [];
    for (const e of valid) {
      const doc = await this.prisma.knowledgeDocument.create({
        data: {
          hotelId: body.hotelId,
          title: e.titulo!.slice(0, 200),
          type: 'whatsapp_import',
          content: e.conteudo!,
          active: false,
          embeddingStatus: 'INDEXED',
        },
      });
      created.push({ id: doc.id, title: doc.title, content: doc.content });
    }

    return {
      created: created.length,
      entries: created,
      message:
        created.length > 0
          ? `${created.length} conhecimentos extraídos e criados como INATIVOS para sua revisão.`
          : 'Nenhum conhecimento novo identificado nesta conversa.',
    };
  }
}

@Module({
  imports: [BellaModule], // fornece o ModelRouterService (IA)
  controllers: [TrainingController],
})
export class TrainingModule {}
