import { Logger } from '@nestjs/common';
export type RetrievalRankRow = {
    id: string;
    documentId?: string;
    denseScore?: number;
    bm25Score?: number;
    rerankScore?: number;
    similarity?: number;
    content?: string;
};
export declare function logRetrievalRankTable(logger: Logger, stage: string, query: string, rows: RetrievalRankRow[], options?: {
    limit?: number;
}): void;
export declare function logRerankOrderChange(logger: Logger, before: RetrievalRankRow[], after: RetrievalRankRow[]): void;
//# sourceMappingURL=retrieval-log.util.d.ts.map