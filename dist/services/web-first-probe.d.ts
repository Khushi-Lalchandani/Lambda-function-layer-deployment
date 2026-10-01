import { ChunkResult } from '../types/chat.interface';
import { HybridRetrievalService } from './hybrid-retrieval.service';
export interface WebFirstProbeLog {
    probeTriggered: true;
    topSimilarity: number;
    chunkCount: number;
    redirected: boolean;
}
export type WebFirstStrategyResolution = {
    action: 'redirect_document_first';
    probe: WebFirstProbeLog;
} | {
    action: 'web_only';
    probe: WebFirstProbeLog;
};
export declare function normalizeChunkSimilarity(distance: number | undefined): number;
export declare function computeTopSimilarity(chunks: ChunkResult[]): number;
export declare function hasStrongDocumentEvidence(chunks: ChunkResult[]): boolean;
export declare function resolveWebFirstStrategy(query: string, documentIds: string[], fileName: string | undefined, hybridRetrievalService: HybridRetrievalService): Promise<WebFirstStrategyResolution>;
//# sourceMappingURL=web-first-probe.d.ts.map