/** Strict temperature for all legal RAG tier calls. */
export declare const LEGAL_MODEL_TEMPERATURE = 0.1;
/** Semantic sufficiency / routing — quality-sensitive. */ export declare const TIER_MODEL_SUFFICIENCY_PRIMARY = "gemini-3.1-flash-lite";
export declare const TIER_MODEL_SUFFICIENCY_FALLBACK = "gemini-3.5-flash-lite";
/** Web grounding / summarization — latency-optimized. */
export declare const TIER_MODEL_WEB_GROUNDING_PRIMARY = "gemini-3.1-flash-lite";
export declare const TIER_MODEL_WEB_GROUNDING_FALLBACK = "gemini-3-flash-preview";
/** Escalation when both Lite models fail (never downgrade hybrid synthesis). */
export declare const TIER_MODEL_WEB_GROUNDING_ESCALATE = "gemini-3-flash-preview";
/** Hybrid synthesis (documents + web) — highest-risk; never Flash Lite. */
export declare const TIER_MODEL_HYBRID_SYNTHESIS_PRIMARY = "gemini-3-flash-preview";
export declare const TIER_MODEL_HYBRID_SYNTHESIS_FALLBACK = "gemini-3.1-pro";
/** Document-only final answer (legal-answer-generation.txt). */
export declare const TIER_MODEL_LEGAL_ANSWER_GENERATION = "gemini-3-flash-preview";
export declare const LEGAL_ANSWER_GENERATION_TEMPERATURE = 0;
/** Default thinking level for legal answer generation (override via WEB_SEARCH_LEGAL_ANSWER_THINKING_LEVEL). */
export declare const LEGAL_ANSWER_GENERATION_THINKING_LEVEL = "low";
/** Document insufficiency responses — Gemini primary, OpenAI fallback. */
export declare const TIER_MODEL_DOCUMENT_INSUFFICIENCY_OPENAI_FALLBACK = "gpt-5-mini";
//# sourceMappingURL=web-search-tier.constants.d.ts.map