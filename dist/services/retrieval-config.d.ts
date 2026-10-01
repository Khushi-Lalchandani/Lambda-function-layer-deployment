/**
 * Hybrid retrieval: dense + BM25 merge → dedupe → rerank → final chunks for LLM context.
 * Query embeddings must match the document parsing lambda (model + dimensions).
 */
/** Default max candidates in the LLM rerank prompt (override via RETRIEVAL_LLM_RERANK_POOL_MAX). */
export declare const DEFAULT_LLM_RERANK_POOL_MAX = 15;
/** Default LLM rerank timeout in ms before falling back to fusion order (override via RETRIEVAL_LLM_RERANK_TIMEOUT_MS). */
export declare const DEFAULT_LLM_RERANK_TIMEOUT_MS = 4000;
export declare const retrievalConfig: {
    /** OpenAI embedding model — must match document indexing. */
    embeddingModel: string;
    /** Embedding vector size — must match stored document chunk vectors. */
    embeddingDimensions: number;
    /** Dense vector candidates (first stage). */
    denseCandidateK: number;
    /** Lexical (BM25) candidates (first stage). */
    bm25CandidateK: number;
    /** Wide pool fetched in one embedding call before merge/rerank. */
    poolSize: number;
    /** Chunks passed to answer generation after rerank. */
    finalTopK: number;
    /** Dense candidates for FACT_LOOKUP queries. */
    factLookupDenseCandidateK: number;
    /** BM25 candidates for FACT_LOOKUP queries. */
    factLookupBm25CandidateK: number;
    /** Pool size for FACT_LOOKUP queries. */
    factLookupPoolSize: number;
    /** Final chunks for FACT_LOOKUP queries. */
    factLookupFinalTopK: number;
    /** Dense candidates for REASONING queries. */
    reasoningDenseCandidateK: number;
    /** BM25 candidates for REASONING queries. */
    reasoningBm25CandidateK: number;
    /** Pool size for REASONING queries. */
    reasoningPoolSize: number;
    /** Final chunks for REASONING queries. */
    reasoningFinalTopK: number;
    /** Weight for dense score in fusion rerank (0–1). */
    denseWeight: number;
    /** Weight for BM25 score in fusion rerank (0–1). */
    bm25Weight: number;
    /** Second-stage Gemini 2.5 Flash rerank on merged candidates. */
    useLlmRerank: boolean;
    /** Max candidates sent to LLM rerank prompt. */
    llmRerankPoolMax: number;
    /** LLM rerank call timeout (ms); fusion order used on timeout or error. */
    llmRerankTimeoutMs: number;
    /** Verbose retrieval/rerank logs (set RETRIEVAL_DEBUG_LOGS=true to enable). */
    debugRetrievalLogs: boolean;
    /** Normalized max similarity below which retrieval is treated as absent (web fallback). */
    retrievalStrengthWeakThreshold: number;
    /** Normalized max similarity at or above which retrieval is treated as strong (document-first on NO). */
    retrievalStrengthStrongThreshold: number;
    /** Minimum normalized similarity for a chunk to count as topically relevant. */
    retrievalStrengthRelevanceFloor: number;
};
//# sourceMappingURL=retrieval-config.d.ts.map