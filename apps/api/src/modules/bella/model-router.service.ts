import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export type AiTask = 'booking_extraction' | 'policy_answer' | 'sales' | 'general';

export interface CompletionRequest {
  task: AiTask;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  temperature?: number;
  tools?: any[];
}

export interface CompletionResult {
  text: string;
  toolInput?: Record<string, unknown>;
  model: string;
  /** Heurística simples de confiança; refinável com logprobs/avaliador */
  confidence: number;
}

/**
 * Roteamento inteligente de modelos por tarefa:
 *   reservas → modelo econômico | políticas → modelo preciso | vendas → modelo avançado
 * Provedor primário: Anthropic. TODO: fallback OpenAI/Gemini.
 */
@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name);
  private readonly anthropic = new Anthropic();

  private readonly modelByTask: Record<AiTask, string> = {
    booking_extraction: 'claude-haiku-4-5-20251001',
    policy_answer: 'claude-opus-4-8',
    sales: 'claude-fable-5',
    general: 'claude-fable-5',
  };

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const model = this.modelByTask[req.task];
    const response = await this.anthropic.messages.create({
      model,
      max_tokens: 1024,
      temperature: req.temperature ?? 0.7,
      system: req.system,
      messages: req.messages,
      ...(req.tools ? { tools: req.tools } : {}),
    });

    let text = '';
    let toolInput: Record<string, unknown> | undefined;
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use') toolInput = block.input as Record<string, unknown>;
    }

    const confidence = response.stop_reason === 'end_turn' || response.stop_reason === 'tool_use' ? 0.85 : 0.5;
    this.logger.debug(`Tarefa ${req.task} roteada para ${model}`);
    return { text, toolInput, model, confidence };
  }
}
