import { ChunkResult } from '../types/chat.interface';
import { BackendService } from './backend.service';
import { PromptBuilderService } from './prompt-builder.service';
import { AnswerRefinementService } from './answer-refinement.service';
import { HybridRetrievalService } from './hybrid-retrieval.service';
import { type ProcessVectorQueryOptions } from './retrieval-profile';
export declare class VectorSearchService {
    private readonly backendService;
    private readonly hybridRetrievalService;
    private readonly promptBuilderService;
    private readonly answerRefinementService;
    private readonly logger;
    private readonly llm;
    constructor(backendService: BackendService, hybridRetrievalService: HybridRetrievalService, promptBuilderService: PromptBuilderService, answerRefinementService: AnswerRefinementService);
    retrieveRankedChunks(query: string, documentIds: string[], fileName?: string, options?: ProcessVectorQueryOptions): Promise<ChunkResult[]>;
    getSimilarChunks(query: string, documentIds: string[], topK?: number, fileName?: string): Promise<ChunkResult[]>;
    private getFallbackChunks;
    private searchForExactMatch;
    processVectorQuery(question: string, documentIds: string[], documentChats: any[], fileName: string | undefined, emitPartial: (partial: any) => void, chatHistory?: string, options?: ProcessVectorQueryOptions): Promise<{
        answer: string;
        references: any[];
        confidence: number;
    }>;
    private generateVectorResponse;
    deduplicateAnswer(answer: string): string;
    safeExtractTextFromResponse(response: any): string;
}
//# sourceMappingURL=vector-service.d.ts.map