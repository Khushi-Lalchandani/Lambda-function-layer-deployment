import { Logger } from '@nestjs/common';
import {
  getLlmGateway,
  type LlmGatewayService,
} from './llm-gateway.service';
import type { LlmGenerateContentParams } from './gemini-provider';
import { webSearchConfig } from './web-search-config';
import {
  LEGAL_ANSWER_GENERATION_TEMPERATURE,
  LEGAL_MODEL_TEMPERATURE,
  TIER_MODEL_DOCUMENT_INSUFFICIENCY_OPENAI_FALLBACK,
} from './web-search-tier.constants';
import {
  getWebSearchTierMetrics,
  type WebSearchTier,
} from './web-search-tier-metrics';

export type { WebSearchTier };
export { LEGAL_MODEL_TEMPERATURE } from './web-search-tier.constants';
export {
  LEGAL_ANSWER_GENERATION_TEMPERATURE,
  TIER_MODEL_LEGAL_ANSWER_GENERATION,
} from './web-search-tier.constants';

export interface TierModelChain {
  tier: WebSearchTier;
  models: string[];
}

export interface TierInvocationResult {
  response: unknown;
  tier: WebSearchTier;
  modelUsed: string;
  latencyMs: number;
  fallbackUsed: boolean;
  attemptCount: number;
}

const tierLogger = new Logger('WebSearchModelTier');

function resolveTierModelChain(tier: WebSearchTier): string[] {
  switch (tier) {
    case 'sufficiency_routing':
      return [
        webSearchConfig.model_sufficiency_primary,
        webSearchConfig.model_sufficiency_fallback,
      ];
    case 'web_grounding':
      return [
        webSearchConfig.model_web_grounding_primary,
        webSearchConfig.model_web_grounding_fallback,
        webSearchConfig.model_web_grounding_escalate,
      ];
    case 'hybrid_synthesis':
      return [
        webSearchConfig.model_hybrid_synthesis_primary,
        webSearchConfig.model_hybrid_synthesis_fallback,
      ];
    default:
      return [];
  }
}

export function getTierModelChain(tier: WebSearchTier): TierModelChain {
  return { tier, models: resolveTierModelChain(tier) };
}

export function buildTierGenerationConfig(
  overrides?: LlmGenerateContentParams['config'],
): LlmGenerateContentParams['config'] {
  return {
    temperature: webSearchConfig.legal_model_temperature,
    topP: webSearchConfig.gemini_top_p,
    ...overrides,
  };
}

export function extractLlmText(response: unknown): string {
  if (!response || typeof response !== 'object') {
    return '';
  }

  const res = response as {
    text?: string | (() => string);
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
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

/**
 * Invokes the LLM using the tier's model chain.
 * Lower tiers escalate to the next model in the chain; hybrid synthesis never uses Flash Lite.
 */
export async function invokeWebSearchTier(
  params: Omit<LlmGenerateContentParams, 'model'>,
  tier: WebSearchTier,
  llm: LlmGatewayService = getLlmGateway(),
): Promise<TierInvocationResult> {
  const chain = resolveTierModelChain(tier);
  const tierStart = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < chain.length; attempt++) {
    const model = chain[attempt]!;
    const attemptStart = Date.now();

    try {
      const response = await llm.generateContent({
        ...params,
        model,
        config: {
          ...buildTierGenerationConfig(),
          ...params.config,
          temperature: webSearchConfig.legal_model_temperature,
        },
      });

      const text = extractLlmText(response);
      if (!text) {
        throw new Error(`Empty response from ${model}`);
      }

      const latencyMs = Date.now() - attemptStart;
      getWebSearchTierMetrics().recordTierLatency(tier, latencyMs, model, 'success');

      if (attempt > 0) {
        tierLogger.warn(
          `[WEB_SEARCH_TIER] tier=${tier} succeeded on fallback model=${model} after ${attempt} failure(s)`,
        );
      }

      tierLogger.log(
        `[WEB_SEARCH_TIER] tier=${tier} model=${model} latencyMs=${latencyMs} fallbackUsed=${attempt > 0} totalMs=${Date.now() - tierStart}`,
      );

      return {
        response,
        tier,
        modelUsed: model,
        latencyMs,
        fallbackUsed: attempt > 0,
        attemptCount: attempt + 1,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const latencyMs = Date.now() - attemptStart;
      getWebSearchTierMetrics().recordTierLatency(
        tier,
        latencyMs,
        model,
        'failed',
      );

      tierLogger.warn(
        `[WEB_SEARCH_TIER] tier=${tier} model=${model} failed (${lastError.message}); ${attempt < chain.length - 1 ? 'trying next in chain' : 'no more fallbacks'}`,
      );
    }
  }

  throw lastError ?? new Error(`All models failed for tier ${tier}`);
}

/**
 * Document-only final answer (legal-answer-generation.txt):
 * gemini-3-flash-preview, temperature 0, thinking level configurable (default low).
 */
export async function invokeLegalAnswerGenerationTier(
  params: Omit<LlmGenerateContentParams, 'model'>,
  llm: LlmGatewayService = getLlmGateway(),
): Promise<TierInvocationResult> {
  const tier: WebSearchTier = 'legal_answer_generation';
  const model = webSearchConfig.model_legal_answer_generation;
  const tierStart = Date.now();
  const attemptStart = Date.now();

  try {
    const response = await llm.generateContent({
      ...params,
      model,
      config: {
        topP: webSearchConfig.gemini_top_p,
        topK: 64,
        ...params.config,
        temperature: LEGAL_ANSWER_GENERATION_TEMPERATURE,
        thinkingConfig: {
          thinkingLevel: webSearchConfig.legal_answer_thinking_level,
        },
      },
    });

    const text = extractLlmText(response);
    if (!text) {
      throw new Error(`Empty response from ${model}`);
    }

    const latencyMs = Date.now() - attemptStart;
    getWebSearchTierMetrics().recordTierLatency(tier, latencyMs, model, 'success');

    tierLogger.log(
      `[WEB_SEARCH_TIER] tier=${tier} model=${model} latencyMs=${latencyMs} fallbackUsed=false totalMs=${Date.now() - tierStart}`,
    );

    return {
      response,
      tier,
      modelUsed: model,
      latencyMs,
      fallbackUsed: false,
      attemptCount: 1,
    };
  } catch (error) {
    const latencyMs = Date.now() - attemptStart;
    const message = error instanceof Error ? error.message : String(error);
    getWebSearchTierMetrics().recordTierLatency(tier, latencyMs, model, 'failed');
    tierLogger.warn(`[WEB_SEARCH_TIER] tier=${tier} model=${model} failed (${message})`);
    throw error instanceof Error ? error : new Error(message);
  }
}

/**
 * Document insufficiency prompts: Gemini hybrid-primary first, then gpt-5-mini.
 */
export async function invokeDocumentInsufficiencyTier(
  params: Omit<LlmGenerateContentParams, 'model'>,
  llm: LlmGatewayService = getLlmGateway(),
): Promise<TierInvocationResult> {
  const tier: WebSearchTier = 'document_insufficiency';
  const primaryModel = webSearchConfig.model_hybrid_synthesis_primary;
  const openAiFallback =
    process.env.WEB_SEARCH_MODEL_DOCUMENT_INSUFFICIENCY_OPENAI_FALLBACK ??
    TIER_MODEL_DOCUMENT_INSUFFICIENCY_OPENAI_FALLBACK;
  const tierStart = Date.now();
  const attemptStart = Date.now();

  try {
    const { response, modelUsed, fallbackUsed } =
      await llm.generateContentWithExplicitOpenAiFallback(
        {
          ...params,
          model: primaryModel,
          config: {
            ...buildTierGenerationConfig(),
            ...params.config,
            temperature: webSearchConfig.legal_model_temperature,
          },
        },
        openAiFallback,
      );

    const text = extractLlmText(response);
    if (!text) {
      throw new Error(`Empty response from ${modelUsed}`);
    }

    const latencyMs = Date.now() - attemptStart;
    getWebSearchTierMetrics().recordTierLatency(tier, latencyMs, modelUsed, 'success');

    if (fallbackUsed) {
      tierLogger.warn(
        `[WEB_SEARCH_TIER] tier=${tier} succeeded on OpenAI fallback model=${modelUsed}`,
      );
    }

    tierLogger.log(
      `[WEB_SEARCH_TIER] tier=${tier} model=${modelUsed} latencyMs=${latencyMs} fallbackUsed=${fallbackUsed} totalMs=${Date.now() - tierStart}`,
    );

    return {
      response,
      tier,
      modelUsed,
      latencyMs,
      fallbackUsed,
      attemptCount: fallbackUsed ? 2 : 1,
    };
  } catch (error) {
    const latencyMs = Date.now() - attemptStart;
    const message = error instanceof Error ? error.message : String(error);
    getWebSearchTierMetrics().recordTierLatency(
      tier,
      latencyMs,
      primaryModel,
      'failed',
    );
    tierLogger.warn(
      `[WEB_SEARCH_TIER] tier=${tier} failed (${message}); no more fallbacks`,
    );
    throw error instanceof Error ? error : new Error(message);
  }
}
