import { type LlmGatewayService } from './llm-gateway.service';
import type { LlmGenerateContentParams } from './gemini-provider';
import { type WebSearchTier } from './web-search-tier-metrics';
export type { WebSearchTier };
export { LEGAL_MODEL_TEMPERATURE } from './web-search-tier.constants';
export { LEGAL_ANSWER_GENERATION_TEMPERATURE, TIER_MODEL_LEGAL_ANSWER_GENERATION, } from './web-search-tier.constants';
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
export declare function getTierModelChain(tier: WebSearchTier): TierModelChain;
export declare function buildTierGenerationConfig(overrides?: LlmGenerateContentParams['config']): LlmGenerateContentParams['config'];
export declare function extractLlmText(response: unknown): string;
/**
 * Invokes the LLM using the tier's model chain.
 * Lower tiers escalate to the next model in the chain; hybrid synthesis never uses Flash Lite.
 */
export declare function invokeWebSearchTier(params: Omit<LlmGenerateContentParams, 'model'>, tier: WebSearchTier, llm?: LlmGatewayService): Promise<TierInvocationResult>;
/**
 * Document-only final answer (legal-answer-generation.txt):
 * gemini-3-flash-preview, temperature 0, thinking level configurable (default low).
 */
export declare function invokeLegalAnswerGenerationTier(params: Omit<LlmGenerateContentParams, 'model'>, llm?: LlmGatewayService): Promise<TierInvocationResult>;
/**
 * Document insufficiency prompts: Gemini hybrid-primary first, then gpt-5-mini.
 */
export declare function invokeDocumentInsufficiencyTier(params: Omit<LlmGenerateContentParams, 'model'>, llm?: LlmGatewayService): Promise<TierInvocationResult>;
//# sourceMappingURL=web-search-model-tier.d.ts.map