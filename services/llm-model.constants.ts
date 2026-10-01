/** Shared Gemini model identifiers. */
export const GEMINI_3_5_FLASH_LITE = 'gemini-3.5-flash-lite';
export const GEMINI_3_5_FLASH = 'gemini-3.5-flash';
export const GEMINI_3_1_FLASH_LITE = 'gemini-3.1-flash-lite';
export const GEMINI_3_FLASH_PREVIEW = 'gemini-3-flash-preview';
export const GEMINI_3_1_PRO = 'gemini-3.1-pro';

/** Default OpenAI model for gateway fallbacks and OpenAI-first flows. */
export const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';

/** GPT-5 mini — used for planner and answer refinement. */
export const GPT_5_MINI = 'gpt-5-mini';

/** Maps Gemini model → OpenAI fallback when Vertex AI fails. */
export const GEMINI_TO_OPENAI_MODEL: Record<string, string> = {
  [GEMINI_3_5_FLASH_LITE]: OPENAI_DEFAULT_MODEL,
  [GEMINI_3_5_FLASH]: OPENAI_DEFAULT_MODEL,
  [GEMINI_3_1_FLASH_LITE]: OPENAI_DEFAULT_MODEL,
  [GEMINI_3_FLASH_PREVIEW]: 'gpt-5-mini',
  [GEMINI_3_1_PRO]: OPENAI_DEFAULT_MODEL,
};

/** Jobs document extraction — Gemini primary, Gemini then OpenAI on failure. */
export const EXTRACTION_PRIMARY_MODEL = GEMINI_3_1_FLASH_LITE;
export const EXTRACTION_FALLBACK_MODEL = GEMINI_3_FLASH_PREVIEW;

/** Default Gemini model when an OpenAI-first flow falls back to Vertex. */
export const DEFAULT_GEMINI_FALLBACK_MODEL = GEMINI_3_5_FLASH_LITE;

export function isGemini3Model(model: string): boolean {
  return model.startsWith('gemini-3');
}

/** Gemini 3.x ignores topK in generationConfig — strip before API calls. */
export function sanitizeGeminiGenerationConfig<T extends { topK?: number }>(
  model: string,
  config?: T,
): T | undefined {
  if (!config || !isGemini3Model(model)) {
    return config;
  }
  const { topK: _topK, ...rest } = config;
  return rest as T;
}
