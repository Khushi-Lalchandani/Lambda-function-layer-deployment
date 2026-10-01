/** Shared Gemini model identifiers. */
export declare const GEMINI_3_5_FLASH_LITE = "gemini-3.5-flash-lite";
export declare const GEMINI_3_5_FLASH = "gemini-3.5-flash";
export declare const GEMINI_3_1_FLASH_LITE = "gemini-3.1-flash-lite";
export declare const GEMINI_3_FLASH_PREVIEW = "gemini-3-flash-preview";
export declare const GEMINI_3_1_PRO = "gemini-3.1-pro";
/** Default OpenAI model for gateway fallbacks and OpenAI-first flows. */
export declare const OPENAI_DEFAULT_MODEL = "gpt-4.1-mini";
/** GPT-5 mini — used for planner and answer refinement. */
export declare const GPT_5_MINI = "gpt-5-mini";
/** Maps Gemini model → OpenAI fallback when Vertex AI fails. */
export declare const GEMINI_TO_OPENAI_MODEL: Record<string, string>;
/** Jobs document extraction — Gemini primary, Gemini then OpenAI on failure. */
export declare const EXTRACTION_PRIMARY_MODEL = "gemini-3.1-flash-lite";
export declare const EXTRACTION_FALLBACK_MODEL = "gemini-3-flash-preview";
/** Default Gemini model when an OpenAI-first flow falls back to Vertex. */
export declare const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";
export declare function isGemini3Model(model: string): boolean;
/** Gemini 3.x ignores topK in generationConfig — strip before API calls. */
export declare function sanitizeGeminiGenerationConfig<T extends {
    topK?: number;
}>(model: string, config?: T): T | undefined;
//# sourceMappingURL=llm-model.constants.d.ts.map