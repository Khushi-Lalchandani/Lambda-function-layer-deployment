export type SufficiencyResult = 'YES' | 'PARTIAL' | 'NO';
export type FinalStrategyLabel = 'document_only' | 'hybrid' | 'web_only' | 'document_insufficient' | string;
export interface RequestTiming {
    preprocessingMs: number;
    retrievalMs: number;
    sufficiencyMs: number;
    webSearchMs: number;
    answerGenerationMs: number;
    refinementMs: number;
}
export interface RequestObservabilityState {
    requestId: string;
    chatId: string;
    query: string;
    startTime: number;
    plannerCapability?: string;
    plannerConfidence?: string;
    executor?: string;
    finalStrategy?: FinalStrategyLabel;
    sourceInfo?: string;
    sufficiencyResult?: SufficiencyResult;
    guardrailTriggered: boolean;
    webSearchTriggered: boolean;
    timing: RequestTiming;
}
export interface RequestEndOverrides {
    finalStrategy?: FinalStrategyLabel | string;
    executor?: string;
    sourceInfo?: string;
    tokenUsage?: string;
}
export declare function newRequestId(): string;
export declare function getRequestContext(): RequestObservabilityState | undefined;
export declare function runWithRequestObservability<T>(params: {
    requestId?: string;
    chatId: string;
    query: string;
}, fn: () => Promise<T>): Promise<T>;
export declare function logInfo(tag: string, fields: object): void;
export declare function logDebug(tag: string, fields: object): void;
export declare function logTrace(tag: string, payload: object | string): void;
export declare function logObservabilityError(component: string, error: unknown): void;
export declare function logRequestStart(): void;
export declare function logRequestEnd(overrides?: RequestEndOverrides): void;
export declare function recordTiming(phase: keyof RequestTiming, ms: number): void;
export declare function markWebSearchTriggered(): void;
export declare function markGuardrailTriggered(): void;
export declare function setPlannerDecision(plannerCapability: string, confidence: string): void;
export declare function setSufficiencyResult(result: SufficiencyResult): void;
export declare function logPlannerDecision(fields: {
    plannerCapability: string;
    confidence: string;
    executor?: string;
}): void;
export declare function logRetrievalSummary(fields: {
    intent: string;
    chunkCount: number;
    topSimilarity: number;
    retrievalMs: number;
    profile: string;
}): void;
export declare function logQueryRewrite(fields: {
    originalQuery: string;
    rewrittenQuery: string;
    wasRewritten: boolean;
    reason: string;
    historyMessageCount?: number;
    historyTurnCount?: number;
    historyUsed?: boolean;
    historyChars?: number;
}): void;
export declare function logQueryRewriteHistory(fields: {
    historySent: string;
    llmUserPrompt: string;
}): void;
export declare function logQueryDecomposition(fields: {
    originalQuery: string;
    shouldDecompose: boolean;
    subQueries: string[];
    reason: string;
}): void;
export declare function logWebSearchQueryOptimization(fields: {
    originalWebQuery: string;
    optimizedWebQuery: string;
    optimizationApplied: boolean;
}): void;
export declare function logSufficiency(fields: {
    result: SufficiencyResult;
    topSimilarity: number;
    chunkCount: number;
    guardrailTriggered: boolean;
    latencyMs: number;
    missingInfo?: string;
}): void;
export declare function logWebSearchInvocation(fields: {
    triggerReason: 'PARTIAL' | 'NO' | 'DIRECT';
    queryMode: 'original' | 'enhanced';
    latencyMs: number;
    model?: string;
    missingInfo?: string;
    originalWebQuery?: string;
    optimizedWebQuery?: string;
    enhancedWebQuery?: string;
    optimizationApplied?: boolean;
    missingInfoUsed?: boolean;
}): void;
export declare function setSourceInfo(sourceInfo: string): void;
export declare function mapSourceInfoToFinalStrategy(sourceInfo?: string): FinalStrategyLabel;
export declare function mapExecutorStrategyToFinalStrategy(strategy?: string): FinalStrategyLabel;
//# sourceMappingURL=request-observability.d.ts.map