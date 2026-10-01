import { ChunkResult } from '../types/chat.interface';
import { BackendService } from './backend.service';
import { ChunkRerankService } from './chunk-rerank.service';
import { type RetrievalOptions } from './retrieval-profile';
export declare class HybridRetrievalService {
    private readonly backendService;
    private readonly chunkRerankService;
    private readonly logger;
    private readonly openai;
    constructor(backendService: BackendService, chunkRerankService: ChunkRerankService);
    /**
     * Dense + BM25 → merge → dedupe → fusion score → Gemini 2.5 Flash rerank → top K.
     */
    retrieveRankedChunks(query: string, documentIds: string[], fileName?: string, options?: RetrievalOptions): Promise<ChunkResult[]>;
    getQueryEmbedding(query: string): Promise<number[]>;
    fetchChunksByEmbedding(queryEmbedding: number[], documentIds: string[], topK: number, fileName?: string): Promise<ChunkResult[]>;
    mapRawChunks(chunks: any[] | undefined): ChunkResult[];
    normalizeDenseScore(distance: number | undefined): number;
}
//# sourceMappingURL=hybrid-retrieval.service.d.ts.map