import { ChunkResult } from '../types/chat.interface';
import { isExplicitWebSearchQuery } from './explicit-web-search-query.util';
import { HybridRetrievalService } from './hybrid-retrieval.service';
import {
  WEB_FIRST_PROBE_MIN_CHUNKS,
  WEB_FIRST_PROBE_SIMILARITY_THRESHOLD,
  WEB_FIRST_PROBE_TOP_K,
} from './web-first-probe.config';

export interface WebFirstProbeLog {
  probeTriggered: true;
  topSimilarity: number;
  chunkCount: number;
  redirected: boolean;
}

export type WebFirstStrategyResolution =
  | { action: 'redirect_document_first'; probe: WebFirstProbeLog }
  | { action: 'web_only'; probe: WebFirstProbeLog };

export function normalizeChunkSimilarity(distance: number | undefined): number {
  const value = distance ?? 1;
  return Math.max(0, Math.min(1, 1 - Math.min(value / 2, 1)));
}

export function computeTopSimilarity(chunks: ChunkResult[]): number {
  if (!chunks.length) {
    return 0;
  }

  return Math.max(
    ...chunks.map((chunk) => normalizeChunkSimilarity(chunk.similarity)),
  );
}

export function hasStrongDocumentEvidence(
  chunks: ChunkResult[],
): boolean {
  const topSimilarity = computeTopSimilarity(chunks);
  const chunkCount = chunks.length;

  return (
    topSimilarity >= WEB_FIRST_PROBE_SIMILARITY_THRESHOLD &&
    chunkCount >= WEB_FIRST_PROBE_MIN_CHUNKS
  );
}

export async function resolveWebFirstStrategy(
  query: string,
  documentIds: string[],
  fileName: string | undefined,
  hybridRetrievalService: HybridRetrievalService,
): Promise<WebFirstStrategyResolution> {
  if (isExplicitWebSearchQuery(query)) {
    return {
      action: 'web_only',
      probe: {
        probeTriggered: true,
        topSimilarity: 0,
        chunkCount: 0,
        redirected: false,
      },
    };
  }

  if (!documentIds.length) {
    return {
      action: 'web_only',
      probe: {
        probeTriggered: true,
        topSimilarity: 0,
        chunkCount: 0,
        redirected: false,
      },
    };
  }

  const chunks = await hybridRetrievalService.retrieveRankedChunks(
    query,
    documentIds,
    fileName,
    {
      executor: 'WebFirstExecutor',
      profile: 'fast',
      finalTopK: WEB_FIRST_PROBE_TOP_K,
    },
  );

  const topSimilarity = computeTopSimilarity(chunks);
  const chunkCount = chunks.length;
  const redirected = hasStrongDocumentEvidence(chunks);

  const probe: WebFirstProbeLog = {
    probeTriggered: true,
    topSimilarity,
    chunkCount,
    redirected,
  };

  return redirected
    ? { action: 'redirect_document_first', probe }
    : { action: 'web_only', probe };
}
