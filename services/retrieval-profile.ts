import { Logger } from '@nestjs/common';
import { ChunkResult } from '../types/chat.interface';
import { retrievalConfig } from './retrieval-config';
import { classifyQueryIntent, QueryIntent } from './query-intent-classifier';
import { logDebug } from './request-observability';

export type RetrievalProfile = 'fast' | 'deep';

export interface RetrievalProfileParameters {
  profile: RetrievalProfile;
  queryIntent: QueryIntent;
  poolSize: number;
  denseCandidateK: number;
  bm25CandidateK: number;
  finalTopK: number;
  geminiRerank: boolean;
}

export interface RetrievalOptions {
  finalTopK?: number;
  poolSize?: number;
  profile?: RetrievalProfile;
  executor?: string;
}

export interface ProcessVectorQueryOptions extends RetrievalOptions {
  preloadedChunks?: ChunkResult[];
}

export const RETRIEVAL_SKIP_REASONS = {
  METADATA_ONLY: 'metadata_only',
  GREETING_RESPONSE: 'greeting_response',
  CONSERVATIVE_RESPONSE: 'conservative_response',
  WEB_SEARCH_ONLY: 'web_search_only',
  METADATA_SUMMARY_AVAILABLE: 'metadata_summary_available',
} as const;

export type RetrievalSkipReason =
  (typeof RETRIEVAL_SKIP_REASONS)[keyof typeof RETRIEVAL_SKIP_REASONS];

export async function resolveRetrievalProfile(
  query: string,
  explicitProfile?: RetrievalProfile,
): Promise<RetrievalProfile> {
  if (explicitProfile) {
    return explicitProfile;
  }

  const queryIntent = await classifyQueryIntent(query);
  return queryIntent === 'FACT_LOOKUP' ? 'fast' : 'deep';
}

export function getProfileParameters(
  profile: RetrievalProfile,
): RetrievalProfileParameters {
  const isFast = profile === 'fast';
  const queryIntent: QueryIntent = isFast ? 'FACT_LOOKUP' : 'REASONING';
  const poolSize = isFast
    ? retrievalConfig.factLookupPoolSize
    : retrievalConfig.reasoningPoolSize;
  const denseCandidateK = isFast
    ? retrievalConfig.factLookupDenseCandidateK
    : retrievalConfig.reasoningDenseCandidateK;
  const bm25CandidateK = isFast
    ? retrievalConfig.factLookupBm25CandidateK
    : retrievalConfig.reasoningBm25CandidateK;
  const finalTopK = isFast
    ? retrievalConfig.factLookupFinalTopK
    : retrievalConfig.reasoningFinalTopK;

  return {
    profile,
    queryIntent,
    poolSize,
    denseCandidateK,
    bm25CandidateK,
    finalTopK,
    geminiRerank: !isFast && retrievalConfig.useLlmRerank,
  };
}

export async function resolveRetrievalParameters(
  query: string,
  options?: RetrievalOptions,
): Promise<RetrievalProfileParameters> {
  const profile = await resolveRetrievalProfile(query, options?.profile);
  const configured = getProfileParameters(profile);

  return {
    ...configured,
    poolSize: options?.poolSize ?? configured.poolSize,
    finalTopK: options?.finalTopK ?? configured.finalTopK,
    denseCandidateK: Math.min(
      options?.poolSize ?? configured.poolSize,
      configured.denseCandidateK,
    ),
    bm25CandidateK: Math.min(
      options?.poolSize ?? configured.poolSize,
      configured.bm25CandidateK,
    ),
  };
}

export function logRetrievalSkipped(
  logger: Logger,
  executor: string,
  reason: RetrievalSkipReason,
): void {
  logDebug('RETRIEVAL_DECISION', {
    executor,
    retrieval: 'skipped',
    reason,
  });
}

export function logRetrievalProfile(
  logger: Logger,
  executor: string | undefined,
  parameters: RetrievalProfileParameters,
): void {
  logDebug('RETRIEVAL_DECISION', {
    executor: executor ?? 'unknown',
    retrievalProfile: parameters.profile,
    densePool: parameters.poolSize,
    bm25Pool: parameters.bm25CandidateK,
    finalTopK: parameters.finalTopK,
    ...(parameters.geminiRerank ? { geminiRerank: true } : {}),
  });
}
