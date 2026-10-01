import { ChunkResult } from '../types/chat.interface';
import { retrievalConfig } from './retrieval-config';

export type RetrievalStrength = 'NONE' | 'WEAK' | 'STRONG';

/** Answer path when semantic sufficiency is NO (retrieval strength is the first gate). */
export type NoSufficiencyFallback =
  | 'web_search_only'
  | 'document_insufficient'
  | 'vector_search_only';

/** Hybrid answer routing — retrieval evidence is authoritative; sufficiency is advisory. */
export type HybridAnswerRoute =
  | 'web_search_only'
  | 'document_answer'
  | 'hybrid'
  | 'document_insufficient'
  | 'vector_search_only'
  | 'no_topic_coverage';

/** Honest response when retrieval is NONE and web search is unavailable. */
export const NO_TOPIC_COVERAGE_WEB_DISABLED_MESSAGE =
  'The uploaded documents do not appear to cover this topic, and web search is currently disabled. Please ask about content in your uploaded documents, or enable web search to look outside them.';

/** Scenario C (parametric general knowledge) is only allowed when retrieval found topical evidence. */
export function isGeneralKnowledgeScenarioAllowed(
  chunks: ChunkLike[],
): boolean {
  return classifyRetrievalStrength(chunks).strength !== 'NONE';
}

export type SufficiencyVerdict = 'YES' | 'PARTIAL' | 'NO';

export interface RetrievalStrengthMetrics {
  strength: RetrievalStrength;
  maxSimilarity: number;
  chunkCount: number;
  relevantChunkCount: number;
}

type ChunkLike = Pick<ChunkResult, 'similarity'> | { similarity?: number };

/** Converts raw vector distance to a 0–1 relevance score (higher = more relevant). */
export function normalizeChunkSimilarity(similarity: number): number {
  return 1 - Math.min(similarity / 2, 1);
}

export function classifyRetrievalStrength(
  chunks: ChunkLike[],
): RetrievalStrengthMetrics {
  const chunkCount = chunks?.length ?? 0;
  if (chunkCount === 0) {
    return {
      strength: 'NONE',
      maxSimilarity: 0,
      chunkCount: 0,
      relevantChunkCount: 0,
    };
  }

  const topSimilarity = chunks[0]?.similarity ?? 1.0;
  const maxSimilarity = normalizeChunkSimilarity(topSimilarity);
  const relevanceFloor = retrievalConfig.retrievalStrengthRelevanceFloor;
  const relevantChunkCount = chunks.filter(
    (chunk) =>
      normalizeChunkSimilarity(chunk?.similarity ?? 1.0) >= relevanceFloor,
  ).length;

  const weakThreshold = retrievalConfig.retrievalStrengthWeakThreshold;
  const strongThreshold = retrievalConfig.retrievalStrengthStrongThreshold;

  let strength: RetrievalStrength;
  if (maxSimilarity < weakThreshold) {
    strength = 'NONE';
  } else if (maxSimilarity < strongThreshold) {
    strength = 'WEAK';
  } else {
    strength = 'STRONG';
  }

  return {
    strength,
    maxSimilarity,
    chunkCount,
    relevantChunkCount,
  };
}

/**
 * Retrieval-evidence-first routing matrix.
 *
 * NONE  → web when enabled (corpus has no topical coverage)
 * WEAK  → NO: web | PARTIAL: hybrid | YES: documents
 * STRONG → NO: document insufficiency | PARTIAL: hybrid | YES: documents
 *
 * Document-scoped + NO always → document insufficiency (overrides strength tier).
 */
export function resolveHybridAnswerRoute(
  retrievalStrength: RetrievalStrength,
  sufficiency: SufficiencyVerdict,
  options: {
    documentScoped: boolean;
    webSearchEnabled: boolean;
    explicitWebSearch?: boolean;
  },
): HybridAnswerRoute {
  if (options.explicitWebSearch && options.webSearchEnabled) {
    return 'web_search_only';
  }

  if (options.documentScoped && sufficiency === 'NO') {
    return 'document_insufficient';
  }

  if (retrievalStrength === 'NONE') {
    return options.webSearchEnabled ? 'web_search_only' : 'no_topic_coverage';
  }

  if (retrievalStrength === 'WEAK') {
    if (sufficiency === 'NO') {
      return options.webSearchEnabled ? 'web_search_only' : 'vector_search_only';
    }
    if (sufficiency === 'PARTIAL') {
      return options.webSearchEnabled ? 'hybrid' : 'document_answer';
    }
    return 'document_answer';
  }

  // STRONG
  if (sufficiency === 'NO') {
    return 'document_insufficient';
  }
  if (sufficiency === 'PARTIAL') {
    return options.webSearchEnabled ? 'hybrid' : 'document_answer';
  }
  return 'document_answer';
}

/**
 * @deprecated Prefer resolveHybridAnswerRoute — kept for NO-only call sites.
 */
export function resolveNoSufficiencyFallback(
  retrievalStrength: RetrievalStrength,
  options: {
    documentScoped: boolean;
    webSearchEnabled: boolean;
    explicitWebSearch?: boolean;
  },
): NoSufficiencyFallback {
  const route = resolveHybridAnswerRoute(retrievalStrength, 'NO', options);
  if (
    route === 'hybrid' ||
    route === 'document_answer' ||
    route === 'no_topic_coverage'
  ) {
    return 'vector_search_only';
  }
  return route;
}
