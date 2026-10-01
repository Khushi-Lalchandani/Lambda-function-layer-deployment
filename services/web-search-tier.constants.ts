import {
  GEMINI_3_1_FLASH_LITE,
  GEMINI_3_1_PRO,
  GEMINI_3_5_FLASH_LITE,
  GEMINI_3_FLASH_PREVIEW,
} from './llm-model.constants';

/** Strict temperature for all legal RAG tier calls. */
export const LEGAL_MODEL_TEMPERATURE = 0.1;

/** Semantic sufficiency / routing — quality-sensitive. */export const TIER_MODEL_SUFFICIENCY_PRIMARY = GEMINI_3_1_FLASH_LITE;
export const TIER_MODEL_SUFFICIENCY_FALLBACK = GEMINI_3_5_FLASH_LITE;

/** Web grounding / summarization — latency-optimized. */
export const TIER_MODEL_WEB_GROUNDING_PRIMARY = GEMINI_3_1_FLASH_LITE;
export const TIER_MODEL_WEB_GROUNDING_FALLBACK = GEMINI_3_FLASH_PREVIEW;
/** Escalation when both Lite models fail (never downgrade hybrid synthesis). */
export const TIER_MODEL_WEB_GROUNDING_ESCALATE = GEMINI_3_FLASH_PREVIEW;

/** Hybrid synthesis (documents + web) — highest-risk; never Flash Lite. */
export const TIER_MODEL_HYBRID_SYNTHESIS_PRIMARY = GEMINI_3_FLASH_PREVIEW;
export const TIER_MODEL_HYBRID_SYNTHESIS_FALLBACK = GEMINI_3_1_PRO;

/** Document-only final answer (legal-answer-generation.txt). */
export const TIER_MODEL_LEGAL_ANSWER_GENERATION = GEMINI_3_FLASH_PREVIEW;
export const LEGAL_ANSWER_GENERATION_TEMPERATURE = 0;
/** Default thinking level for legal answer generation (override via WEB_SEARCH_LEGAL_ANSWER_THINKING_LEVEL). */
export const LEGAL_ANSWER_GENERATION_THINKING_LEVEL = 'low';

/** Document insufficiency responses — Gemini primary, OpenAI fallback. */
export const TIER_MODEL_DOCUMENT_INSUFFICIENCY_OPENAI_FALLBACK = 'gpt-5-mini';
