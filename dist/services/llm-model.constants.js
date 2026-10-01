"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_GEMINI_FALLBACK_MODEL = exports.EXTRACTION_FALLBACK_MODEL = exports.EXTRACTION_PRIMARY_MODEL = exports.GEMINI_TO_OPENAI_MODEL = exports.GPT_5_MINI = exports.OPENAI_DEFAULT_MODEL = exports.GEMINI_3_1_PRO = exports.GEMINI_3_FLASH_PREVIEW = exports.GEMINI_3_1_FLASH_LITE = exports.GEMINI_3_5_FLASH = exports.GEMINI_3_5_FLASH_LITE = void 0;
exports.isGemini3Model = isGemini3Model;
exports.sanitizeGeminiGenerationConfig = sanitizeGeminiGenerationConfig;
/** Shared Gemini model identifiers. */
exports.GEMINI_3_5_FLASH_LITE = 'gemini-3.5-flash-lite';
exports.GEMINI_3_5_FLASH = 'gemini-3.5-flash';
exports.GEMINI_3_1_FLASH_LITE = 'gemini-3.1-flash-lite';
exports.GEMINI_3_FLASH_PREVIEW = 'gemini-3-flash-preview';
exports.GEMINI_3_1_PRO = 'gemini-3.1-pro';
/** Default OpenAI model for gateway fallbacks and OpenAI-first flows. */
exports.OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';
/** GPT-5 mini — used for planner and answer refinement. */
exports.GPT_5_MINI = 'gpt-5-mini';
/** Maps Gemini model → OpenAI fallback when Vertex AI fails. */
exports.GEMINI_TO_OPENAI_MODEL = {
    [exports.GEMINI_3_5_FLASH_LITE]: exports.OPENAI_DEFAULT_MODEL,
    [exports.GEMINI_3_5_FLASH]: exports.OPENAI_DEFAULT_MODEL,
    [exports.GEMINI_3_1_FLASH_LITE]: exports.OPENAI_DEFAULT_MODEL,
    [exports.GEMINI_3_FLASH_PREVIEW]: 'gpt-5-mini',
    [exports.GEMINI_3_1_PRO]: exports.OPENAI_DEFAULT_MODEL,
};
/** Jobs document extraction — Gemini primary, Gemini then OpenAI on failure. */
exports.EXTRACTION_PRIMARY_MODEL = exports.GEMINI_3_1_FLASH_LITE;
exports.EXTRACTION_FALLBACK_MODEL = exports.GEMINI_3_FLASH_PREVIEW;
/** Default Gemini model when an OpenAI-first flow falls back to Vertex. */
exports.DEFAULT_GEMINI_FALLBACK_MODEL = exports.GEMINI_3_5_FLASH_LITE;
function isGemini3Model(model) {
    return model.startsWith('gemini-3');
}
/** Gemini 3.x ignores topK in generationConfig — strip before API calls. */
function sanitizeGeminiGenerationConfig(model, config) {
    if (!config || !isGemini3Model(model)) {
        return config;
    }
    const { topK: _topK, ...rest } = config;
    return rest;
}
//# sourceMappingURL=llm-model.constants.js.map