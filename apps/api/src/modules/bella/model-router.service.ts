import { Injectable, Logger } from '@nestjs/common';

export type AiTask = 'booking_extraction' | 'policy_answer' | 'sales' | 'general';

export interface CompletionRequest {
  task: AiTask;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  temperature?: number;
  /** Quando presente, a resposta deve ser um JSON estruturado (extração de dados) */
  tools?: any[];
}

export interface CompletionResult {
  text: string;
  toolInput?: Record<string, unknown>;
  model: string;
  /** Heurística simples de confiança; refinável com avaliador */
  confidence: number;
}

type Provider = 'gemini' | 'ollama' | 'anthropic' | 'mock';

/**
 * Roteamento de modelos por tarefa, agnóstico de provedor.
 *
 * Provedores suportados (escolha automática por env, ou AI_PROVIDER fixo):
 *   - gemini    → Google Gemini (nível GRATUITO, sem cartão). Requer GOOGLE_API_KEY.
 *   - ollama    → modelo LOCAL na máquina (custo zero, sem conta). Requer Ollama rodando.
 *   - anthropic → Claude (pago). Requer ANTHROPIC_API_KEY.
 *   - mock      → sem IA configurada: resposta segura padrão (não inventa nada).
 *
 * Roteamento por tarefa (reservas→econômico, políticas→preciso, vendas→avançado)
 * é aplicado via nome de modelo configurável por provedor.
 */
@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name);
  private readonly provider: Provider = this.resolveProvider();

  constructor() {
    this.logger.log(`Provedor de IA ativo: ${this.provider.toUpperCase()}`);
  }

  private resolveProvider(): Provider {
    const forced = process.env.AI_PROVIDER?.toLowerCase();
    if (forced === 'gemini' || forced === 'ollama' || forced === 'anthropic' || forced === 'mock') {
      return forced;
    }
    if (process.env.GOOGLE_API_KEY) return 'gemini';
    if (process.env.OLLAMA_URL || process.env.OLLAMA_MODEL) return 'ollama';
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    return 'mock';
  }

  /** Modelo por tarefa, configurável por env conforme o provedor */
  private modelFor(task: AiTask): string {
    const env = process.env;
    if (this.provider === 'gemini') {
      // gemini-2.5-flash é o mais confiável no nível gratuito; o -lite retorna 503
      // com frequência. Mantemos flash para extração e resposta (override via env).
      const fast = env.GEMINI_MODEL_FAST ?? 'gemini-2.5-flash';
      const main = env.GEMINI_MODEL_PRECISE ?? 'gemini-2.5-flash';
      return task === 'booking_extraction' ? fast : main;
    }
    if (this.provider === 'ollama') {
      return env.OLLAMA_MODEL ?? 'llama3.1';
    }
    // anthropic
    if (task === 'booking_extraction') return env.MODEL_BOOKING ?? 'claude-haiku-4-5-20251001';
    if (task === 'policy_answer') return env.MODEL_POLICIES ?? 'claude-opus-4-8';
    return env.MODEL_SALES ?? 'claude-fable-5';
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const model = this.modelFor(req.task);
    try {
      switch (this.provider) {
        case 'gemini':
          return await this.completeGemini(req, model);
        case 'ollama':
          return await this.completeOllama(req, model);
        case 'anthropic':
          return await this.completeAnthropic(req, model);
        default:
          return this.completeMock(req);
      }
    } catch (err) {
      this.logger.error(`Falha no provedor ${this.provider} (${model}): ${err instanceof Error ? err.message : err}`);
      // Degrada para resposta segura em vez de derrubar o atendimento
      return this.completeMock(req);
    }
  }

  // ---------- Gemini (gratuito) ----------
  private async completeGemini(req: CompletionRequest, model: string): Promise<CompletionResult> {
    const key = process.env.GOOGLE_API_KEY!;
    const wantsJson = Boolean(req.tools?.length);
    const sys = wantsJson ? `${req.system}\n\n${this.jsonInstruction(req.tools![0])}` : req.system;

    const contents = req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body: any = {
      systemInstruction: { parts: [{ text: sys }] },
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: 2048,
        // Modelos Gemini 2.5 "pensam" por padrão e gastam tokens de saída nisso,
        // o que truncava as respostas. Desligamos o thinking: chat fica rápido e completo.
        thinkingConfig: { thinkingBudget: 0 },
        ...(wantsJson ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const data = await this.fetchWithRetry(url, body);
    const text: string = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
    return this.pack(text, model, wantsJson);
  }

  /** POST ao Gemini com retry em 503/429 (transitórios comuns no nível gratuito) */
  private async fetchWithRetry(url: string, body: unknown, attempts = 3): Promise<any> {
    let lastErr = '';
    for (let i = 0; i < attempts; i++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return res.json();
      lastErr = `Gemini ${res.status}: ${await res.text()}`;
      if (res.status === 503 || res.status === 429) {
        // backoff curto e crescente (0,8s, 1,6s) antes de nova tentativa
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        continue;
      }
      break; // erros não-transitórios (400/401/403): não adianta repetir
    }
    throw new Error(lastErr);
  }

  // ---------- Ollama (local, gratuito) ----------
  private async completeOllama(req: CompletionRequest, model: string): Promise<CompletionResult> {
    const baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
    const wantsJson = Boolean(req.tools?.length);
    const sys = wantsJson ? `${req.system}\n\n${this.jsonInstruction(req.tools![0])}` : req.system;

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        ...(wantsJson ? { format: 'json' } : {}),
        options: { temperature: req.temperature ?? 0.7 },
        messages: [{ role: 'system', content: sys }, ...req.messages],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    return this.pack(data.message?.content ?? '', model, wantsJson);
  }

  // ---------- Anthropic (pago) ----------
  private async completeAnthropic(req: CompletionRequest, model: string): Promise<CompletionResult> {
    // Import dinâmico: o SDK só é carregado se este provedor for usado
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
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
    return { text, toolInput, model, confidence };
  }

  // ---------- Mock (sem IA configurada) ----------
  private completeMock(req: CompletionRequest): CompletionResult {
    if (req.tools?.length) {
      // Extração: devolve intenção neutra para não disparar fluxos sem dados reais
      return { text: '', toolInput: { intent: 'other' }, model: 'mock', confidence: 0 };
    }
    return {
      text:
        'Olá! No momento estou com a inteligência em configuração. ' +
        'Um de nossos atendentes vai falar com você em instantes. ' +
        'Nossa recepção também atende 24h pelo telefone +55 47 3367-0211. 🌿',
      model: 'mock',
      confidence: 0,
    };
  }

  /** Empacota texto de saída; quando JSON, tenta parsear para toolInput */
  private pack(text: string, model: string, wantsJson: boolean): CompletionResult {
    if (wantsJson) {
      const parsed = this.tryParseJson(text);
      return { text: '', toolInput: parsed ?? { intent: 'other' }, model, confidence: parsed ? 0.8 : 0.3 };
    }
    return { text: text.trim(), model, confidence: text.trim() ? 0.8 : 0.3 };
  }

  private tryParseJson(text: string): Record<string, unknown> | null {
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /** Converte o schema de uma ferramenta numa instrução de saída JSON portável */
  private jsonInstruction(tool: any): string {
    const props = tool?.input_schema?.properties ?? {};
    const fields = Object.entries(props)
      .map(([name, def]: [string, any]) => `- "${name}": ${def.description ?? def.type}`)
      .join('\n');
    return `Responda APENAS com um objeto JSON válido, sem texto fora dele, com os campos:\n${fields}\nUse null para campos não informados.`;
  }
}
