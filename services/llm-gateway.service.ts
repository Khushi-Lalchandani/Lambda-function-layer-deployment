import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  getGeminiProvider,
  resetGeminiProvider,
  type LlmGenerateContentParams,
} from './gemini-provider';
import {
  DEFAULT_GEMINI_FALLBACK_MODEL,
  GEMINI_TO_OPENAI_MODEL,
  OPENAI_DEFAULT_MODEL,
} from './llm-model.constants';

export type { LlmGenerateContentParams };

const OPENAI_GPT5_FAMILY_MODELS = new Set(['gpt-5-mini']);

type OpenAiReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

const OPENAI_REASONING_EFFORTS = new Set<OpenAiReasoningEffort>([
  'minimal',
  'low',
  'medium',
  'high',
]);

function resolveOpenAiReasoningEffort(
  config?: LlmGenerateContentParams['config'],
): OpenAiReasoningEffort {
  const effort = config?.reasoning_effort;
  if (
    typeof effort === 'string' &&
    OPENAI_REASONING_EFFORTS.has(effort as OpenAiReasoningEffort)
  ) {
    return effort as OpenAiReasoningEffort;
  }
  return 'minimal';
}

type OpenAiFallbackRequest = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  'reasoning_effort'
> & {
  reasoning_effort?: OpenAiReasoningEffort;
};

function isOpenAiGpt5FamilyModel(model: string): boolean {
  return OPENAI_GPT5_FAMILY_MODELS.has(model.toLowerCase());
}

let gatewayInstance: LlmGatewayService | null = null;

export function getLlmGateway(): LlmGatewayService {
  if (!gatewayInstance) {
    gatewayInstance = new LlmGatewayService();
  }
  return gatewayInstance;
}

export function resetLlmGateway(): void {
  gatewayInstance = null;
  resetGeminiProvider();
}

@Injectable()
export class LlmGatewayService {
  private readonly logger = new Logger(LlmGatewayService.name);
  private readonly gemini = getGeminiProvider();
  private openaiClient: OpenAI | null = null;

  private getOpenAI(): OpenAI {
    if (!this.openaiClient) {
      const apiKey = process.env.OPENAI_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_KEY is not configured');
      }
      this.openaiClient = new OpenAI({ apiKey });
    }
    return this.openaiClient;
  }

  async generateContent(params: LlmGenerateContentParams): Promise<any> {
    let geminiFailureReason = '';

    try {
      const result = await this.gemini.generateContent(params);

      if (!this.isInvalidResponse(result)) {
        return result;
      }

      geminiFailureReason = 'empty or invalid response';
    } catch (error) {
      geminiFailureReason = this.describeError(error);
    }

    if (!process.env.OPENAI_KEY) {
      throw new Error(
        `Gemini failed (${geminiFailureReason}) and OPENAI_KEY is not configured for fallback`,
      );
    }

    this.logger.warn(
      `[LLM_FALLBACK] Gemini failed (${geminiFailureReason}); retrying with OpenAI for model=${params.model}`,
    );

    return this.generateWithOpenAI(params);
  }

  /**
   * Tries Gemini with params.model first; on failure retries with an explicit OpenAI model.
   */
  async generateContentWithExplicitOpenAiFallback(
    params: LlmGenerateContentParams,
    openAiFallbackModel: string,
  ): Promise<{ response: unknown; modelUsed: string; fallbackUsed: boolean }> {
    let geminiFailureReason = '';

    try {
      const result = await this.gemini.generateContent(params);

      if (!this.isInvalidResponse(result)) {
        return {
          response: result,
          modelUsed: params.model,
          fallbackUsed: false,
        };
      }

      geminiFailureReason = 'empty or invalid response';
    } catch (error) {
      geminiFailureReason = this.describeError(error);
    }

    if (!process.env.OPENAI_KEY) {
      throw new Error(
        `Gemini failed (${geminiFailureReason}) and OPENAI_KEY is not configured for fallback`,
      );
    }

    this.logger.warn(
      `[LLM_FALLBACK] Gemini failed (${geminiFailureReason}); retrying with OpenAI model=${openAiFallbackModel} (Gemini model was ${params.model})`,
    );

    const response = await this.generateWithOpenAI(
      params,
      openAiFallbackModel,
      'fallback',
    );
    return {
      response,
      modelUsed: openAiFallbackModel,
      fallbackUsed: true,
    };
  }

  async generateContentOpenAiFirst(
    params: LlmGenerateContentParams,
    options?: {
      openAiModel?: string;
      geminiFallbackModel?: string;
    },
  ): Promise<any> {
    const openAiModel = options?.openAiModel ?? OPENAI_DEFAULT_MODEL;
    const geminiFallbackModel =
      options?.geminiFallbackModel ??
      params.model ??
      DEFAULT_GEMINI_FALLBACK_MODEL;
    let openAiFailureReason = '';

    if (process.env.OPENAI_KEY) {
      try {
        const result = await this.generateWithOpenAI(
          params,
          openAiModel,
          'primary',
        );
        if (!this.isInvalidResponse(result)) {
          this.logger.log(
            `[LLM_PRIMARY] OpenAI succeeded with model=${openAiModel}`,
          );
          return result;
        }
        openAiFailureReason = 'empty or invalid response';
      } catch (error) {
        openAiFailureReason = this.describeError(error);
      }
    } else {
      openAiFailureReason = 'OPENAI_KEY is not configured';
    }

    this.logger.warn(
      `[LLM_FALLBACK] OpenAI failed (${openAiFailureReason}); retrying with Gemini model=${geminiFallbackModel}`,
    );

    try {
      const geminiResult = await this.gemini.generateContent({
        ...params,
        model: geminiFallbackModel,
      });

      if (!this.isInvalidResponse(geminiResult)) {
        return geminiResult;
      }

      throw new Error('Gemini fallback returned empty response');
    } catch (error) {
      throw new Error(
        `OpenAI failed (${openAiFailureReason}) and Gemini fallback failed (${this.describeError(error)})`,
      );
    }
  }

  private async generateWithOpenAI(
    params: LlmGenerateContentParams,
    openAiModelOverride?: string,
    callPath: 'primary' | 'fallback' = 'fallback',
  ): Promise<{ text: string; candidates: Array<{ content: { parts: Array<{ text: string }> } }> }> {
    const openAiStartTime = Date.now();
    const openAiModel =
      openAiModelOverride ??
      GEMINI_TO_OPENAI_MODEL[params.model] ??
      OPENAI_DEFAULT_MODEL;
    const messages = this.buildOpenAiMessages(params);
    const wantsJson = params.config?.responseMimeType === 'application/json';

    const request: OpenAiFallbackRequest = {
      model: openAiModel,
      messages,
      max_tokens: params.config?.maxOutputTokens,
      ...(wantsJson
        ? { response_format: { type: 'json_object' as const } }
        : {}),
    };

    if (isOpenAiGpt5FamilyModel(openAiModel)) {
      // Chat Completions uses top-level reasoning_effort (not nested reasoning).
      request.reasoning_effort = resolveOpenAiReasoningEffort(params.config);
    } else {
      request.temperature = params.config?.temperature ?? 0;
      if (params.config?.topP != null) {
        request.top_p = params.config.topP;
      }
    }

    const response = await this.getOpenAI().chat.completions.create(
      request as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    );

    const text = (response.choices[0]?.message?.content ?? '').trim();
    if (!text) {
      throw new Error('OpenAI fallback returned empty response');
    }

    const openAiDurationMs = Date.now() - openAiStartTime;
    if (callPath === 'primary') {
      this.logger.log(
        `[LLM_OPENAI_PRIMARY] OpenAI call completed in ${openAiDurationMs}ms with model=${openAiModel}`,
      );
    } else {
      this.logger.log(
        `[LLM_OPENAI_FALLBACK] OpenAI fallback call completed in ${openAiDurationMs}ms with model=${openAiModel} (Gemini model was ${params.model})`,
      );
    }

    return {
      text,
      candidates: [{ content: { parts: [{ text }] } }],
    };
  }

  private buildOpenAiMessages(
    params: LlmGenerateContentParams,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (params.config?.systemInstruction) {
      messages.push({
        role: 'system',
        content: String(params.config.systemInstruction),
      });
    }

    if (typeof params.contents === 'string') {
      messages.push({ role: 'user', content: params.contents });
      return messages;
    }

    for (const entry of params.contents ?? []) {
      const text = (entry.parts ?? [])
        .map((part) => part.text ?? '')
        .join('\n')
        .trim();
      if (!text) {
        continue;
      }

      const role = entry.role === 'model' ? 'assistant' : 'user';
      messages.push({ role, content: text });
    }

    if (!messages.some((message) => message.role === 'user')) {
      messages.push({ role: 'user', content: '' });
    }

    return messages;
  }

  private isInvalidResponse(response: unknown): boolean {
    const text = this.extractText(response);
    return !text.trim();
  }

  private extractText(response: unknown): string {
    if (!response || typeof response !== 'object') {
      return '';
    }

    const res = response as {
      text?: string | (() => string);
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    if (typeof res.text === 'function') {
      return String(res.text()).trim();
    }
    if (typeof res.text === 'string') {
      return res.text.trim();
    }

    const parts = res.candidates?.[0]?.content?.parts ?? [];
    return parts
      .map((part) => part.text ?? '')
      .join('')
      .trim();
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
