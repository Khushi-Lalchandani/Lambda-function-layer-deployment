import { GeminiMonitoringContext, GeminiPromptBreakdown, GeminiUsageDashboardData, GeminiUsageMetrics, GeminiUsageRecord } from './gemini-observability';
import { PromptCompositionAuditReport, PromptCompositionAuditService, PromptTokenSourceReport } from './prompt-composition-audit.service';
export type { GeminiMonitoringContext, GeminiPromptBreakdown, PromptCompositionAuditReport, PromptTokenSourceReport, };
export interface LlmGenerateContentParams {
    model: string;
    contents: string | Array<{
        role?: string;
        parts?: Array<{
            text?: string;
        }>;
    }>;
    config?: {
        systemInstruction?: string;
        temperature?: number;
        topP?: number;
        topK?: number;
        maxOutputTokens?: number;
        responseMimeType?: string;
        responseSchema?: unknown;
        thinkingConfig?: {
            thinkingLevel?: string;
        };
        tools?: unknown[];
        [key: string]: unknown;
    };
    monitoring?: GeminiMonitoringContext;
}
export declare function getGeminiProvider(): GeminiProvider;
export declare function resetGeminiProvider(): void;
export declare function isGeminiConfigured(): boolean;
export declare class GeminiProvider {
    private readonly logger;
    private readonly client;
    private readonly projectId;
    private readonly location;
    private readonly metricsStore;
    private readonly promptCompositionAudit;
    private readonly applicationName;
    private readonly environment;
    constructor();
    generate(params: LlmGenerateContentParams): Promise<unknown>;
    generateContent(params: LlmGenerateContentParams): Promise<unknown>;
    logUsage(record: GeminiUsageRecord): void;
    logFailure(record: GeminiUsageRecord): void;
    getUsageMetrics(): GeminiUsageMetrics;
    buildUsageDashboardData(): GeminiUsageDashboardData;
    getPromptCompositionAuditService(): PromptCompositionAuditService;
    getTokenSourceReport(): PromptTokenSourceReport;
    buildPromptCompositionAuditReport(): PromptCompositionAuditReport;
    private toApiParams;
    private emitStructuredLog;
    private loadCredentials;
}
//# sourceMappingURL=gemini-provider.d.ts.map