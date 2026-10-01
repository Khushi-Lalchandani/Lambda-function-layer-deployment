"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIER_MODEL_LEGAL_ANSWER_GENERATION = exports.LEGAL_ANSWER_GENERATION_TEMPERATURE = exports.LEGAL_MODEL_TEMPERATURE = void 0;
exports.getTierModelChain = getTierModelChain;
exports.buildTierGenerationConfig = buildTierGenerationConfig;
exports.extractLlmText = extractLlmText;
exports.invokeWebSearchTier = invokeWebSearchTier;
exports.invokeLegalAnswerGenerationTier = invokeLegalAnswerGenerationTier;
exports.invokeDocumentInsufficiencyTier = invokeDocumentInsufficiencyTier;
const common_1 = require("@nestjs/common");
const llm_gateway_service_1 = require("./llm-gateway.service");
const web_search_config_1 = require("./web-search-config");
const web_search_tier_constants_1 = require("./web-search-tier.constants");
const web_search_tier_metrics_1 = require("./web-search-tier-metrics");
var web_search_tier_constants_2 = require("./web-search-tier.constants");
Object.defineProperty(exports, "LEGAL_MODEL_TEMPERATURE", { enumerable: true, get: function () { return web_search_tier_constants_2.LEGAL_MODEL_TEMPERATURE; } });
var web_search_tier_constants_3 = require("./web-search-tier.constants");
Object.defineProperty(exports, "LEGAL_ANSWER_GENERATION_TEMPERATURE", { enumerable: true, get: function () { return web_search_tier_constants_3.LEGAL_ANSWER_GENERATION_TEMPERATURE; } });
Object.defineProperty(exports, "TIER_MODEL_LEGAL_ANSWER_GENERATION", { enumerable: true, get: function () { return web_search_tier_constants_3.TIER_MODEL_LEGAL_ANSWER_GENERATION; } });
const tierLogger = new common_1.Logger('WebSearchModelTier');
function resolveTierModelChain(tier) {
    switch (tier) {
        case 'sufficiency_routing':
            return [
                web_search_config_1.webSearchConfig.model_sufficiency_primary,
                web_search_config_1.webSearchConfig.model_sufficiency_fallback,
            ];
        case 'web_grounding':
            return [
                web_search_config_1.webSearchConfig.model_web_grounding_primary,
                web_search_config_1.webSearchConfig.model_web_grounding_fallback,
                web_search_config_1.webSearchConfig.model_web_grounding_escalate,
            ];
        case 'hybrid_synthesis':
            return [
                web_search_config_1.webSearchConfig.model_hybrid_synthesis_primary,
                web_search_config_1.webSearchConfig.model_hybrid_synthesis_fallback,
            ];
        default:
            return [];
    }
}
function getTierModelChain(tier) {
    return { tier, models: resolveTierModelChain(tier) };
}
function buildTierGenerationConfig(overrides) {
    return {
        temperature: web_search_config_1.webSearchConfig.legal_model_temperature,
        topP: web_search_config_1.webSearchConfig.gemini_top_p,
        ...overrides,
    };
}
function extractLlmText(response) {
    if (!response || typeof response !== 'object') {
        return '';
    }
    const res = response;
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
async function invokeWebSearchTier(params, tier, llm = (0, llm_gateway_service_1.getLlmGateway)()) {
    const chain = resolveTierModelChain(tier);
    const tierStart = Date.now();
    let lastError = null;
    for (let attempt = 0; attempt < chain.length; attempt++) {
        const model = chain[attempt];
        const attemptStart = Date.now();
        try {
            const response = await llm.generateContent({
                ...params,
                model,
                config: {
                    ...buildTierGenerationConfig(),
                    ...params.config,
                    temperature: web_search_config_1.webSearchConfig.legal_model_temperature,
                },
            });
            const text = extractLlmText(response);
            if (!text) {
                throw new Error(`Empty response from ${model}`);
            }
            const latencyMs = Date.now() - attemptStart;
            (0, web_search_tier_metrics_1.getWebSearchTierMetrics)().recordTierLatency(tier, latencyMs, model, 'success');
            if (attempt > 0) {
                tierLogger.warn(`[WEB_SEARCH_TIER] tier=${tier} succeeded on fallback model=${model} after ${attempt} failure(s)`);
            }
            tierLogger.log(`[WEB_SEARCH_TIER] tier=${tier} model=${model} latencyMs=${latencyMs} fallbackUsed=${attempt > 0} totalMs=${Date.now() - tierStart}`);
            return {
                response,
                tier,
                modelUsed: model,
                latencyMs,
                fallbackUsed: attempt > 0,
                attemptCount: attempt + 1,
            };
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const latencyMs = Date.now() - attemptStart;
            (0, web_search_tier_metrics_1.getWebSearchTierMetrics)().recordTierLatency(tier, latencyMs, model, 'failed');
            tierLogger.warn(`[WEB_SEARCH_TIER] tier=${tier} model=${model} failed (${lastError.message}); ${attempt < chain.length - 1 ? 'trying next in chain' : 'no more fallbacks'}`);
        }
    }
    throw lastError ?? new Error(`All models failed for tier ${tier}`);
}
/**
 * Document-only final answer (legal-answer-generation.txt):
 * gemini-3-flash-preview, temperature 0, thinking level configurable (default low).
 */
async function invokeLegalAnswerGenerationTier(params, llm = (0, llm_gateway_service_1.getLlmGateway)()) {
    const tier = 'legal_answer_generation';
    const model = web_search_config_1.webSearchConfig.model_legal_answer_generation;
    const tierStart = Date.now();
    const attemptStart = Date.now();
    try {
        const response = await llm.generateContent({
            ...params,
            model,
            config: {
                topP: web_search_config_1.webSearchConfig.gemini_top_p,
                topK: 64,
                ...params.config,
                temperature: web_search_tier_constants_1.LEGAL_ANSWER_GENERATION_TEMPERATURE,
                thinkingConfig: {
                    thinkingLevel: web_search_config_1.webSearchConfig.legal_answer_thinking_level,
                },
            },
        });
        const text = extractLlmText(response);
        if (!text) {
            throw new Error(`Empty response from ${model}`);
        }
        const latencyMs = Date.now() - attemptStart;
        (0, web_search_tier_metrics_1.getWebSearchTierMetrics)().recordTierLatency(tier, latencyMs, model, 'success');
        tierLogger.log(`[WEB_SEARCH_TIER] tier=${tier} model=${model} latencyMs=${latencyMs} fallbackUsed=false totalMs=${Date.now() - tierStart}`);
        return {
            response,
            tier,
            modelUsed: model,
            latencyMs,
            fallbackUsed: false,
            attemptCount: 1,
        };
    }
    catch (error) {
        const latencyMs = Date.now() - attemptStart;
        const message = error instanceof Error ? error.message : String(error);
        (0, web_search_tier_metrics_1.getWebSearchTierMetrics)().recordTierLatency(tier, latencyMs, model, 'failed');
        tierLogger.warn(`[WEB_SEARCH_TIER] tier=${tier} model=${model} failed (${message})`);
        throw error instanceof Error ? error : new Error(message);
    }
}
/**
 * Document insufficiency prompts: Gemini hybrid-primary first, then gpt-5-mini.
 */
async function invokeDocumentInsufficiencyTier(params, llm = (0, llm_gateway_service_1.getLlmGateway)()) {
    const tier = 'document_insufficiency';
    const primaryModel = web_search_config_1.webSearchConfig.model_hybrid_synthesis_primary;
    const openAiFallback = process.env.WEB_SEARCH_MODEL_DOCUMENT_INSUFFICIENCY_OPENAI_FALLBACK ??
        web_search_tier_constants_1.TIER_MODEL_DOCUMENT_INSUFFICIENCY_OPENAI_FALLBACK;
    const tierStart = Date.now();
    const attemptStart = Date.now();
    try {
        const { response, modelUsed, fallbackUsed } = await llm.generateContentWithExplicitOpenAiFallback({
            ...params,
            model: primaryModel,
            config: {
                ...buildTierGenerationConfig(),
                ...params.config,
                temperature: web_search_config_1.webSearchConfig.legal_model_temperature,
            },
        }, openAiFallback);
        const text = extractLlmText(response);
        if (!text) {
            throw new Error(`Empty response from ${modelUsed}`);
        }
        const latencyMs = Date.now() - attemptStart;
        (0, web_search_tier_metrics_1.getWebSearchTierMetrics)().recordTierLatency(tier, latencyMs, modelUsed, 'success');
        if (fallbackUsed) {
            tierLogger.warn(`[WEB_SEARCH_TIER] tier=${tier} succeeded on OpenAI fallback model=${modelUsed}`);
        }
        tierLogger.log(`[WEB_SEARCH_TIER] tier=${tier} model=${modelUsed} latencyMs=${latencyMs} fallbackUsed=${fallbackUsed} totalMs=${Date.now() - tierStart}`);
        return {
            response,
            tier,
            modelUsed,
            latencyMs,
            fallbackUsed,
            attemptCount: fallbackUsed ? 2 : 1,
        };
    }
    catch (error) {
        const latencyMs = Date.now() - attemptStart;
        const message = error instanceof Error ? error.message : String(error);
        (0, web_search_tier_metrics_1.getWebSearchTierMetrics)().recordTierLatency(tier, latencyMs, primaryModel, 'failed');
        tierLogger.warn(`[WEB_SEARCH_TIER] tier=${tier} failed (${message}); no more fallbacks`);
        throw error instanceof Error ? error : new Error(message);
    }
}
//# sourceMappingURL=web-search-model-tier.js.map