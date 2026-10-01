import { ChunkResult } from '../types/chat.interface';
export type RetrievalStrength = 'NONE' | 'WEAK' | 'STRONG';
/** Answer path when semantic sufficiency is NO (retrieval strength is the first gate). */
export type NoSufficiencyFallback = 'web_search_only' | 'document_insufficient' | 'vector_search_only';
/** Hybrid answer routing — retrieval evidence is authoritative; sufficiency is advisory. */
export type HybridAnswerRoute = 'web_search_only' | 'document_answer' | 'hybrid' | 'document_insufficient' | 'vector_search_only' | 'no_topic_coverage';
/** Honest response when retrieval is NONE and web search is unavailable. */
export declare const NO_TOPIC_COVERAGE_WEB_DISABLED_MESSAGE = "The uploaded documents do not appear to cover this topic, and web search is currently disabled. Please ask about content in your uploaded documents, or enable web search to look outside them.";
/** Scenario C (parametric general knowledge) is only allowed when retrieval found topical evidence. */
export declare function isGeneralKnowledgeScenarioAllowed(chunks: ChunkLike[]): boolean;
export type SufficiencyVerdict = 'YES' | 'PARTIAL' | 'NO';
export interface RetrievalStrengthMetrics {
    strength: RetrievalStrength;
    maxSimilarity: number;
    chunkCount: number;
    relevantChunkCount: number;
}
type ChunkLike = Pick<ChunkResult, 'similarity'> | {
    similarity?: number;
};
/** Converts raw vector distance to a 0–1 relevance score (higher = more relevant). */
export declare function normalizeChunkSimilarity(similarity: number): number;
export declare function classifyRetrievalStrength(chunks: ChunkLike[]): RetrievalStrengthMetrics;
/**
 * Retrieval-evidence-first routing matrix.
 *
 * NONE  → web when enabled (corpus has no topical coverage)
 * WEAK  → NO: web | PARTIAL: hybrid | YES: documents
 * STRONG → NO: document insufficiency | PARTIAL: hybrid | YES: documents
 *
 * Document-scoped + NO always → document insufficiency (overrides strength tier).
 */
export declare function resolveHybridAnswerRoute(retrievalStrength: RetrievalStrength, sufficiency: SufficiencyVerdict, options: {
    documentScoped: boolean;
    webSearchEnabled: boolean;
    explicitWebSearch?: boolean;
}): HybridAnswerRoute;
/**
 * @deprecated Prefer resolveHybridAnswerRoute — kept for NO-only call sites.
 */
export declare function resolveNoSufficiencyFallback(retrievalStrength: RetrievalStrength, options: {
    documentScoped: boolean;
    webSearchEnabled: boolean;
    explicitWebSearch?: boolean;
}): NoSufficiencyFallback;
export {};
//# sourceMappingURL=retrieval-strength.d.ts.map