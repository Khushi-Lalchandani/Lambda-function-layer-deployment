/**
 * Hybrid retrieval: dense + BM25 merge → dedupe → rerank → final chunks for LLM context.
 * Query embeddings must match the document parsing lambda (model + dimensions).
 */

/** Default max candidates in the LLM rerank prompt (override via RETRIEVAL_LLM_RERANK_POOL_MAX). */
export const DEFAULT_LLM_RERANK_POOL_MAX = 15;

/** Default LLM rerank timeout in ms before falling back to fusion order (override via RETRIEVAL_LLM_RERANK_TIMEOUT_MS). */
export const DEFAULT_LLM_RERANK_TIMEOUT_MS = 4000;

export const retrievalConfig = {
  /** OpenAI embedding model — must match document indexing. */
  embeddingModel:
    process.env.RETRIEVAL_EMBEDDING_MODEL ?? 'text-embedding-3-large',
  /** Embedding vector size — must match stored document chunk vectors. */
  embeddingDimensions: parseInt(
    process.env.RETRIEVAL_EMBEDDING_DIMENSIONS ?? '3072',
    10,
  ),
  /** Dense vector candidates (first stage). */
  denseCandidateK: parseInt(process.env.RETRIEVAL_DENSE_CANDIDATES ?? '30', 10),
  /** Lexical (BM25) candidates (first stage). */
  bm25CandidateK: parseInt(process.env.RETRIEVAL_BM25_CANDIDATES ?? '10', 10),
  /** Wide pool fetched in one embedding call before merge/rerank. */
  poolSize: parseInt(process.env.RETRIEVAL_POOL_SIZE ?? '15', 10),
  /** Chunks passed to answer generation after rerank. */
  finalTopK: parseInt(process.env.RETRIEVAL_FINAL_TOP_K ?? '6', 10),
  /** Dense candidates for FACT_LOOKUP queries. */
  factLookupDenseCandidateK: parseInt(
    process.env.RETRIEVAL_FACT_LOOKUP_DENSE_CANDIDATES ?? '12',
    10,
  ),
  /** BM25 candidates for FACT_LOOKUP queries. */
  factLookupBm25CandidateK: parseInt(
    process.env.RETRIEVAL_FACT_LOOKUP_BM25_CANDIDATES ?? '8',
    10,
  ),
  /** Pool size for FACT_LOOKUP queries. */
  factLookupPoolSize: parseInt(
    process.env.RETRIEVAL_FACT_LOOKUP_POOL_SIZE ?? '12',
    10,
  ),
  /** Final chunks for FACT_LOOKUP queries. */
  factLookupFinalTopK: parseInt(
    process.env.RETRIEVAL_FACT_LOOKUP_FINAL_TOP_K ?? '5',
    10,
  ),
  /** Dense candidates for REASONING queries. */
  reasoningDenseCandidateK: parseInt(
    process.env.RETRIEVAL_REASONING_DENSE_CANDIDATES ?? '20',
    10,
  ),
  /** BM25 candidates for REASONING queries. */
  reasoningBm25CandidateK: parseInt(
    process.env.RETRIEVAL_REASONING_BM25_CANDIDATES ?? '12',
    10,
  ),
  /** Pool size for REASONING queries. */
  reasoningPoolSize: parseInt(
    process.env.RETRIEVAL_REASONING_POOL_SIZE ?? '20',
    10,
  ),
  /** Final chunks for REASONING queries. */
  reasoningFinalTopK: parseInt(
    process.env.RETRIEVAL_REASONING_FINAL_TOP_K ?? '8',
    10,
  ),
  /** Weight for dense score in fusion rerank (0–1). */
  denseWeight: parseFloat(process.env.RETRIEVAL_DENSE_WEIGHT ?? '0.55'),
  /** Weight for BM25 score in fusion rerank (0–1). */
  bm25Weight: parseFloat(process.env.RETRIEVAL_BM25_WEIGHT ?? '0.45'),
  /** Second-stage Gemini 2.5 Flash rerank on merged candidates. */
  useLlmRerank: (process.env.RETRIEVAL_USE_LLM_RERANK ?? 'true').toLowerCase() === 'true',
  /** Max candidates sent to LLM rerank prompt. */
  llmRerankPoolMax: parseInt(
    process.env.RETRIEVAL_LLM_RERANK_POOL_MAX ??
      String(DEFAULT_LLM_RERANK_POOL_MAX),
    10,
  ),
  /** LLM rerank call timeout (ms); fusion order used on timeout or error. */
  llmRerankTimeoutMs: parseInt(
    process.env.RETRIEVAL_LLM_RERANK_TIMEOUT_MS ??
      String(DEFAULT_LLM_RERANK_TIMEOUT_MS),
    10,
  ),
  /** Verbose retrieval/rerank logs (set RETRIEVAL_DEBUG_LOGS=true to enable). */
  debugRetrievalLogs:
    (process.env.RETRIEVAL_DEBUG_LOGS ?? 'false').toLowerCase() === 'true',
  /** Normalized max similarity below which retrieval is treated as absent (web fallback). */
  retrievalStrengthWeakThreshold: parseFloat(
    process.env.RETRIEVAL_STRENGTH_WEAK_THRESHOLD ?? '0.40',
  ),
  /** Normalized max similarity at or above which retrieval is treated as strong (document-first on NO). */
  retrievalStrengthStrongThreshold: parseFloat(
    process.env.RETRIEVAL_STRENGTH_STRONG_THRESHOLD ?? '0.60',
  ),
  /** Minimum normalized similarity for a chunk to count as topically relevant. */
  retrievalStrengthRelevanceFloor: parseFloat(
    process.env.RETRIEVAL_STRENGTH_RELEVANCE_FLOOR ?? '0.40',
  ),
};
