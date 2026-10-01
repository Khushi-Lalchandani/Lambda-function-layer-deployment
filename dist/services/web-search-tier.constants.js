"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIER_MODEL_DOCUMENT_INSUFFICIENCY_OPENAI_FALLBACK = exports.LEGAL_ANSWER_GENERATION_THINKING_LEVEL = exports.LEGAL_ANSWER_GENERATION_TEMPERATURE = exports.TIER_MODEL_LEGAL_ANSWER_GENERATION = exports.TIER_MODEL_HYBRID_SYNTHESIS_FALLBACK = exports.TIER_MODEL_HYBRID_SYNTHESIS_PRIMARY = exports.TIER_MODEL_WEB_GROUNDING_ESCALATE = exports.TIER_MODEL_WEB_GROUNDING_FALLBACK = exports.TIER_MODEL_WEB_GROUNDING_PRIMARY = exports.TIER_MODEL_SUFFICIENCY_FALLBACK = exports.TIER_MODEL_SUFFICIENCY_PRIMARY = exports.LEGAL_MODEL_TEMPERATURE = void 0;
const llm_model_constants_1 = require("./llm-model.constants");
/** Strict temperature for all legal RAG tier calls. */
exports.LEGAL_MODEL_TEMPERATURE = 0.1;
/** Semantic sufficiency / routing — quality-sensitive. */ exports.TIER_MODEL_SUFFICIENCY_PRIMARY = llm_model_constants_1.GEMINI_3_1_FLASH_LITE;
exports.TIER_MODEL_SUFFICIENCY_FALLBACK = llm_model_constants_1.GEMINI_3_5_FLASH_LITE;
/** Web grounding / summarization — latency-optimized. */
exports.TIER_MODEL_WEB_GROUNDING_PRIMARY = llm_model_constants_1.GEMINI_3_1_FLASH_LITE;
exports.TIER_MODEL_WEB_GROUNDING_FALLBACK = llm_model_constants_1.GEMINI_3_FLASH_PREVIEW;
/** Escalation when both Lite models fail (never downgrade hybrid synthesis). */
exports.TIER_MODEL_WEB_GROUNDING_ESCALATE = llm_model_constants_1.GEMINI_3_FLASH_PREVIEW;
/** Hybrid synthesis (documents + web) — highest-risk; never Flash Lite. */
exports.TIER_MODEL_HYBRID_SYNTHESIS_PRIMARY = llm_model_constants_1.GEMINI_3_FLASH_PREVIEW;
exports.TIER_MODEL_HYBRID_SYNTHESIS_FALLBACK = llm_model_constants_1.GEMINI_3_1_PRO;
/** Document-only final answer (legal-answer-generation.txt). */
exports.TIER_MODEL_LEGAL_ANSWER_GENERATION = llm_model_constants_1.GEMINI_3_FLASH_PREVIEW;
exports.LEGAL_ANSWER_GENERATION_TEMPERATURE = 0;
/** Default thinking level for legal answer generation (override via WEB_SEARCH_LEGAL_ANSWER_THINKING_LEVEL). */
exports.LEGAL_ANSWER_GENERATION_THINKING_LEVEL = 'low';
/** Document insufficiency responses — Gemini primary, OpenAI fallback. */
exports.TIER_MODEL_DOCUMENT_INSUFFICIENCY_OPENAI_FALLBACK = 'gpt-5-mini';
//# sourceMappingURL=web-search-tier.constants.js.map