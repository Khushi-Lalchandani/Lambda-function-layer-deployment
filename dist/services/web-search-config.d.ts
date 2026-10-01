export interface WebSearchConfigInterface {
    enabled: boolean;
    cache_enabled: boolean;
    cache_ttl_seconds: number;
    min_chunks_threshold: number;
    min_chunk_length: number;
    legal_keywords: string[];
    gemini_temperature: number;
    gemini_top_p: number;
    gemini_top_k: number;
    require_legal_domain: boolean;
    allowed_domains: string[];
    sufficiency_normal_similarity_threshold: number;
    sufficiency_completeness_similarity_threshold: number;
    model_sufficiency_primary: string;
    model_sufficiency_fallback: string;
    model_web_grounding_primary: string;
    model_web_grounding_fallback: string;
    model_web_grounding_escalate: string;
    model_hybrid_synthesis_primary: string;
    model_hybrid_synthesis_fallback: string;
    model_legal_answer_generation: string;
    legal_model_temperature: number;
    legal_answer_thinking_level: string;
}
export declare class WebSearchConfig {
    private readonly promptCache;
    private readonly promptDirectories;
    enabled: boolean;
    cache_enabled: boolean;
    cache_ttl_seconds: number;
    min_chunks_threshold: number;
    min_chunk_length: number;
    legal_keywords: string[];
    gemini_temperature: number;
    gemini_top_p: number;
    gemini_top_k: number;
    require_legal_domain: boolean;
    allowed_domains: string[];
    sufficiency_normal_similarity_threshold: number;
    sufficiency_completeness_similarity_threshold: number;
    model_sufficiency_primary: string;
    model_sufficiency_fallback: string;
    model_web_grounding_primary: string;
    model_web_grounding_fallback: string;
    model_web_grounding_escalate: string;
    model_hybrid_synthesis_primary: string;
    model_hybrid_synthesis_fallback: string;
    model_legal_answer_generation: string;
    legal_answer_thinking_level: string;
    legal_model_temperature: number;
    /** TEMPORARY: set WEB_SEARCH_LEGACY_LANGUAGE_INSTRUCTION=true to A/B compare old vs new static prompt block. Remove after manual verification. */
    legacy_language_instruction: boolean;
    private parseBoolean;
    isLegalQuery(query: string): Promise<boolean>;
    /**
     * Robustly extracts text from Gemini API response, handling multiple response formats
     */
    private _extractTextFromResponse;
    private _fallbackLegalQueryDetection;
    private getPromptTemplate;
    toDict(): WebSearchConfigInterface;
}
export declare const webSearchConfig: WebSearchConfig;
//# sourceMappingURL=web-search-config.d.ts.map