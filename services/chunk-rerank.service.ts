import { Injectable, Logger } from '@nestjs/common';
import { getLlmGateway } from './llm-gateway.service';
import { GEMINI_3_1_FLASH_LITE } from './llm-model.constants';
import { ChunkResult } from '../types/chat.interface';
import { PromptTemplateService } from './prompt-template.service';
import { retrievalConfig } from './retrieval-config';
import { QueryIntent } from './query-intent-classifier';
import {
  logRerankOrderChange,
  logRetrievalRankTable,
} from './retrieval-log.util';
import { extractLlmText } from './web-search-model-tier';

export type RerankCandidate = ChunkResult & {
  denseScore?: number;
  bm25Score?: number;
  rerankScore?: number;
};

@Injectable()
export class ChunkRerankService {
  private readonly logger = new Logger(ChunkRerankService.name);
  private readonly llm = getLlmGateway();

  private readonly model = GEMINI_3_1_FLASH_LITE;

  constructor(
    private readonly promptTemplateService: PromptTemplateService,
  ) {}

  /**
   * Reranks merged retrieval candidates with Gemini 3.1 Flash Lite.
   * Falls back to existing fusion order on API/parse errors.
   */
  async rerank(
    query: string,
    candidates: RerankCandidate[],
    finalTopK: number,
    queryIntent: QueryIntent = 'REASONING',
  ): Promise<RerankCandidate[]> {
    if (!candidates.length) {
      return [];
    }

    if (queryIntent === 'FACT_LOOKUP') {
      this.logger.log(
        '[RERANK] Skipped LLM rerank for FACT_LOOKUP intent; using fusion ranking',
      );
      return candidates.slice(0, finalTopK);
    }

    if (candidates.length <= finalTopK) {
      this.logger.log(
        `[RERANK] Skipped LLM rerank: only ${candidates.length} candidate(s), need > ${finalTopK}`,
      );
      return candidates.slice(0, finalTopK);
    }

    const fusionBefore = candidates.slice(0, retrievalConfig.llmRerankPoolMax);
    logRetrievalRankTable(
      this.logger,
      'LLM_RERANK_INPUT',
      query,
      fusionBefore.map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        denseScore: chunk.denseScore,
        bm25Score: chunk.bm25Score,
        rerankScore: chunk.rerankScore,
        content: chunk.content,
      })),
      { limit: 15 },
    );

    const pool = fusionBefore;
    const candidatesText = pool
      .map((chunk, index) => {
        const excerpt = chunk.content.slice(0, 500).replace(/\s+/g, ' ');
        const fusion = chunk.rerankScore?.toFixed(3) ?? 'n/a';
        return `${index + 1}. id=${chunk.id} fusion=${fusion}\n${excerpt}`;
      })
      .join('\n\n');

    const prompt = this.promptTemplateService.renderTemplate('chunk-rerank.txt', {
      query,
      candidates: candidatesText,
      maxResults: String(finalTopK),
    });

    try {
      const response = await this.withRerankTimeout(
        this.llm.generateContent({
          model: this.model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            temperature: 0,
            topP: 0.95,
            topK: 64,
          },
        }),
        retrievalConfig.llmRerankTimeoutMs,
      );

      const orderedIds = this.parseOrderedChunkIds(response);
      if (retrievalConfig.debugRetrievalLogs) {
        this.logger.log(
          `[RERANK] Gemini ${this.model} raw order (${orderedIds.length} ids): ${orderedIds.map((id) => id.slice(0, 8)).join(', ')}`,
        );
      }
      if (!orderedIds.length) {
        if (retrievalConfig.debugRetrievalLogs) {
          this.logger.warn(
            `Rerank returned no valid chunk IDs; using fusion order (raw=${extractLlmText(response).slice(0, 200) || 'empty'})`,
          );
        } else {
          this.logger.warn(
            'Rerank returned no valid chunk IDs; using fusion order',
          );
        }
        return candidates.slice(0, finalTopK);
      }

      const byId = new Map(pool.map((chunk) => [chunk.id, chunk]));
      const reranked: RerankCandidate[] = [];

      for (const id of orderedIds) {
        const chunk = byId.get(id);
        if (chunk) {
          reranked.push(chunk);
        }
      }

      for (const chunk of pool) {
        if (!reranked.some((item) => item.id === chunk.id)) {
          reranked.push(chunk);
        }
      }

      const final = reranked.slice(0, finalTopK);

      logRerankOrderChange(this.logger, fusionBefore, final);
      logRetrievalRankTable(
        this.logger,
        'LLM_RERANK_OUTPUT',
        query,
        final.map((chunk) => ({
          id: chunk.id,
          documentId: chunk.documentId,
          denseScore: chunk.denseScore,
          bm25Score: chunk.bm25Score,
          rerankScore: chunk.rerankScore,
          content: chunk.content,
        })),
      );

      this.logger.log(
        `[RERANK] Gemini ${this.model} ${fusionBefore.length} candidates → top ${finalTopK} in ${final.length} selected`,
      );

      return final;
    } catch (error: any) {
      this.logger.warn(
        `Gemini rerank failed (${error.message}); using fusion order`,
      );
      return candidates.slice(0, finalTopK);
    }
  }

  private withRerankTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Rerank timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private parseOrderedChunkIds(response: unknown): string[] {
    const text = extractLlmText(response).replace(/```json|```/g, '').trim();
    if (!text) {
      return [];
    }

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((id): id is string => typeof id === 'string');
    } catch {
      return [];
    }
  }
}
