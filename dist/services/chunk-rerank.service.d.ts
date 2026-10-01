import { ChunkResult } from '../types/chat.interface';
import { PromptTemplateService } from './prompt-template.service';
import { QueryIntent } from './query-intent-classifier';
export type RerankCandidate = ChunkResult & {
    denseScore?: number;
    bm25Score?: number;
    rerankScore?: number;
};
export declare class ChunkRerankService {
    private readonly promptTemplateService;
    private readonly logger;
    private readonly llm;
    private readonly model;
    constructor(promptTemplateService: PromptTemplateService);
    /**
     * Reranks merged retrieval candidates with Gemini 3.1 Flash Lite.
     * Falls back to existing fusion order on API/parse errors.
     */
    rerank(query: string, candidates: RerankCandidate[], finalTopK: number, queryIntent?: QueryIntent): Promise<RerankCandidate[]>;
    private withRerankTimeout;
    private parseOrderedChunkIds;
}
//# sourceMappingURL=chunk-rerank.service.d.ts.map