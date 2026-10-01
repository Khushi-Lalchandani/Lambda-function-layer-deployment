export type WebSearchTier = 'sufficiency_routing' | 'web_grounding' | 'hybrid_synthesis' | 'legal_answer_generation' | 'document_insufficiency';
export type TierLatencyStatus = 'success' | 'failed';
export interface TierLatencyRecord {
    tier: WebSearchTier;
    latencyMs: number;
    model: string;
    status: TierLatencyStatus;
    timestamp: string;
}
export interface TierPercentiles {
    p50: number | null;
    p95: number | null;
    sampleCount: number;
}
export interface HybridQualityMetrics {
    citationPreservationRate: number;
    citationsExpected: number;
    citationsPreserved: number;
    tablePreservationRate: number;
    tablesExpected: number;
    tablesPreserved: number;
    answerLength: number;
}
export declare function getWebSearchTierMetrics(): WebSearchTierMetricsStore;
export declare function resetWebSearchTierMetrics(): void;
export declare function extractSourceCitations(text: string): string[];
export declare function computeCitationPreservationRate(expectedSources: string[], answer: string): Pick<HybridQualityMetrics, 'citationPreservationRate' | 'citationsExpected' | 'citationsPreserved'>;
export declare function extractMarkdownTables(text: string): string[];
export declare function computeTablePreservationRate(inputText: string, answer: string): Pick<HybridQualityMetrics, 'tablePreservationRate' | 'tablesExpected' | 'tablesPreserved'>;
export declare function measureHybridAnswerQuality(documentContext: string, answer: string): HybridQualityMetrics;
export declare class WebSearchTierMetricsStore {
    private readonly latencyRecords;
    private readonly hybridQualityRecords;
    recordTierLatency(tier: WebSearchTier, latencyMs: number, model: string, status: TierLatencyStatus): void;
    recordHybridQuality(documentContext: string, answer: string, meta?: {
        query?: string;
        model?: string;
    }): HybridQualityMetrics;
    getTierPercentiles(tier: WebSearchTier, status?: TierLatencyStatus): TierPercentiles;
    getHybridQualitySummary(): {
        sampleCount: number;
        avgCitationPreservationRate: number;
        avgTablePreservationRate: number;
        avgAnswerLength: number;
    };
    logTierLatencySummary(): void;
}
//# sourceMappingURL=web-search-tier-metrics.d.ts.map