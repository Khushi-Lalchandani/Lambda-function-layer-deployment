import { Injectable, Logger } from '@nestjs/common';
import { OpenAI } from 'openai';
import { ChunkResult } from '../types/chat.interface';
import { BackendService } from './backend.service';
import { rankByBm25, scoreBm25 } from './bm25';
import { ChunkRerankService, RerankCandidate } from './chunk-rerank.service';
import { retrievalConfig } from './retrieval-config';
import {
  logRetrievalProfile,
  resolveRetrievalParameters,
  type RetrievalOptions,
} from './retrieval-profile';
import { logDebug, logRetrievalSummary } from './request-observability';

type ScoredChunk = RerankCandidate & {
  denseScore: number;
  bm25Score: number;
};

@Injectable()
export class HybridRetrievalService {
  private readonly logger = new Logger(HybridRetrievalService.name);
  private readonly openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY!,
  });

  constructor(
    private readonly backendService: BackendService,
    private readonly chunkRerankService: ChunkRerankService,
  ) {}

  /**
   * Dense + BM25 → merge → dedupe → fusion score → Gemini 2.5 Flash rerank → top K.
   */
  async retrieveRankedChunks(
    query: string,
    documentIds: string[],
    fileName?: string,
    options?: RetrievalOptions,
  ): Promise<ChunkResult[]> {
    const profileParams = await resolveRetrievalParameters(query, options);
    const {
      queryIntent,
      poolSize,
      finalTopK,
      denseCandidateK,
      bm25CandidateK,
    } = profileParams;
    const isFactLookup = queryIntent === 'FACT_LOOKUP';
    const startTime = Date.now();

    logRetrievalProfile(this.logger, options?.executor, profileParams);
    logDebug('RETRIEVAL_CLASSIFIER_ROUTING', {
      intent: queryIntent,
      isFactLookup,
      embeddingModel: retrievalConfig.embeddingModel,
      embeddingDimensions: retrievalConfig.embeddingDimensions,
      poolSize,
      finalTopK,
      denseCandidateK,
      bm25CandidateK,
    });

    if (!documentIds.length) {
      return [];
    }

    const denseStart = Date.now();
    const queryEmbedding = await this.getQueryEmbedding(query);
    const densePool = await this.fetchChunksByEmbedding(
      queryEmbedding,
      documentIds,
      poolSize,
      fileName,
    );

    const corpus = densePool;
    if (!corpus.length) {
      this.logger.warn(
        `[RETRIEVAL] Dense search returned zero chunks (poolSize=${poolSize})`,
      );
      logRetrievalSummary({
        intent: queryIntent,
        chunkCount: 0,
        topSimilarity: 0,
        retrievalMs: Date.now() - startTime,
        profile: profileParams.profile,
      });
      return [];
    }

    const denseTop = [...densePool]
      .sort(
        (a, b) =>
          this.normalizeDenseScore(b.similarity) -
          this.normalizeDenseScore(a.similarity),
      )
      .slice(0, denseCandidateK);
    const denseMs = Date.now() - denseStart;

    const bm25Start = Date.now();
    const bm25Ranked = rankByBm25(
      query,
      corpus.map((chunk) => ({ id: chunk.id, content: chunk.content })),
      bm25CandidateK,
    );
    const bm25TopIds = new Set(bm25Ranked.map((item) => item.id));
    const bm25Top = corpus.filter((chunk) => bm25TopIds.has(chunk.id));
    const bm25Ms = Date.now() - bm25Start;

    const mergeStart = Date.now();
    const mergedById = new Map<string, ScoredChunk>();

    const upsertChunk = (
      chunk: ChunkResult,
      denseScore: number,
      bm25Score: number,
    ) => {
      const existing = mergedById.get(chunk.id);
      if (!existing) {
        mergedById.set(chunk.id, { ...chunk, denseScore, bm25Score });
        return;
      }

      mergedById.set(chunk.id, {
        ...existing,
        denseScore: Math.max(existing.denseScore, denseScore),
        bm25Score: Math.max(existing.bm25Score, bm25Score),
        similarity: chunk.similarity ?? existing.similarity,
      });
    };

    for (const chunk of denseTop) {
      upsertChunk(chunk, this.normalizeDenseScore(chunk.similarity), 0);
    }

    const bm25Scores = scoreBm25(
      query,
      corpus.map((chunk) => chunk.content),
    );
    const bm25ScoreById = new Map(
      corpus.map((chunk, index) => [chunk.id, bm25Scores[index] ?? 0]),
    );
    const maxBm25 = Math.max(...bm25Scores, 1e-6);

    for (const chunk of bm25Top) {
      const rawBm25 = bm25ScoreById.get(chunk.id) ?? 0;
      upsertChunk(
        chunk,
        this.normalizeDenseScore(chunk.similarity),
        rawBm25 / maxBm25,
      );
    }

    const fusionRanked: ScoredChunk[] = Array.from(mergedById.values())
      .map((chunk) => ({
        ...chunk,
        rerankScore:
          retrievalConfig.denseWeight * chunk.denseScore +
          retrievalConfig.bm25Weight * chunk.bm25Score,
      }))
      .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
    const mergeMs = Date.now() - mergeStart;

    const isRerankEnabledForQuery = retrievalConfig.useLlmRerank && !isFactLookup;

    const rerankStart = Date.now();
    const reranked = isRerankEnabledForQuery
      ? await this.chunkRerankService.rerank(query, fusionRanked, finalTopK, queryIntent)
      : fusionRanked.slice(0, finalTopK);
    const rerankMs = Date.now() - rerankStart;
    const latencyMs = Date.now() - startTime;
    const topSimilarity = this.normalizeDenseScore(reranked[0]?.similarity);

    logRetrievalSummary({
      intent: queryIntent,
      chunkCount: reranked.length,
      topSimilarity,
      retrievalMs: latencyMs,
      profile: profileParams.profile,
    });
    logDebug('RETRIEVAL_RESULT', {
      chunks_total_pool: corpus.length,
      chunks_merged: mergedById.size,
      chunks_final: reranked.length,
      rerank: isRerankEnabledForQuery,
      denseMs,
      bm25Ms,
      mergeMs,
      rerankMs,
      latencyMs,
    });

    return reranked.map((chunk) => ({
      id: chunk.id,
      content: chunk.content,
      documentId: chunk.documentId,
      similarity: chunk.similarity,
      bm25Score: chunk.bm25Score,
      rerankScore: chunk.rerankScore,
    }));
  }

  async getQueryEmbedding(query: string): Promise<number[]> {
    const embedResp = await this.openai.embeddings.create({
      model: retrievalConfig.embeddingModel,
      input: query,
      dimensions: retrievalConfig.embeddingDimensions,
    });
    return embedResp.data[0]?.embedding ?? [];
  }

  async fetchChunksByEmbedding(
    queryEmbedding: number[],
    documentIds: string[],
    topK: number,
    fileName?: string,
  ): Promise<ChunkResult[]> {
    const response = await this.backendService.getSimilarChunks({
      queryEmbedding,
      documentIds,
      topK,
      fileName,
    });

    if (!response.success || !response.data) {
      return [];
    }

    return this.mapRawChunks(response.data);
  }

  mapRawChunks(chunks: any[] | undefined): ChunkResult[] {
    return (chunks ?? []).map((chunk: any) => ({
      id: chunk.id,
      content: chunk.content,
      documentId: chunk.documentId,
      similarity: chunk.similarity,
    }));
  }

  normalizeDenseScore(distance: number | undefined): number {
    const value = distance ?? 1;
    return Math.max(0, Math.min(1, 1 - Math.min(value / 2, 1)));
  }
}
