/**
 * Okapi BM25 over a fixed document set (chunk contents).
 */
export declare function scoreBm25(query: string, documents: string[], k1?: number, b?: number): number[];
export declare function rankByBm25(query: string, items: Array<{
    id: string;
    content: string;
}>, topK: number): Array<{
    id: string;
    score: number;
}>;
//# sourceMappingURL=bm25.d.ts.map