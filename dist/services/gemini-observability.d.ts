import { GeminiPromptBreakdown } from './gemini-prompt-breakdown';
export declare const GEMINI_PROVIDER_NAME = "vertex_ai";
export type { GeminiPromptBreakdown };
export interface GeminiMonitoringContext {
    request_id?: string;
    conversation_id?: string;
    user_id?: string;
    prompt_breakdown?: Partial<GeminiPromptBreakdown>;
}
export interface GeminiUsageRecord {
    timestamp: string;
    request_id: string;
    conversation_id?: string;
    user_id?: string;
    application_name: string;
    environment: string;
    provider: typeof GEMINI_PROVIDER_NAME;
    model: string;
    region: string;
    status: 'success' | 'failed';
    latency_ms: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cached_tokens?: number;
    system_prompt_tokens?: number;
    history_tokens?: number;
    retrieval_tokens?: number;
    query_tokens?: number;
    error_code?: string;
    error_message?: string;
}
export interface GeminiUsageLogPayload {
    event: 'gemini_usage';
    timestamp: string;
    request_id: string;
    conversation_id?: string;
    user_id?: string;
    application_name: string;
    environment: string;
    provider: typeof GEMINI_PROVIDER_NAME;
    model: string;
    region: string;
    status: 'success';
    latency_ms: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cached_tokens: number;
    system_prompt_tokens: number;
    history_tokens: number;
    retrieval_tokens: number;
    query_tokens: number;
}
export interface GeminiFailureLogPayload {
    event: 'gemini_failure';
    timestamp: string;
    request_id: string;
    conversation_id?: string;
    user_id?: string;
    application_name: string;
    environment: string;
    provider: typeof GEMINI_PROVIDER_NAME;
    model: string;
    region: string;
    status: 'failed';
    latency_ms: number;
    error_code: string;
    error_message: string;
}
export interface GeminiUsageMetrics {
    total_requests: number;
    total_failures: number;
    error_rate: number;
    average_input_tokens: number;
    average_output_tokens: number;
    average_latency_ms: number;
    average_system_prompt_tokens: number;
    average_history_tokens: number;
    average_retrieval_tokens: number;
    average_query_tokens: number;
    top_conversations_by_token_usage: Array<{
        conversation_id: string;
        total_tokens: number;
        request_count: number;
    }>;
    top_models_by_token_usage: Array<{
        model: string;
        total_tokens: number;
        request_count: number;
    }>;
}
export interface GeminiUsageDashboardData {
    generated_at: string;
    application_name: string;
    environment: string;
    provider: typeof GEMINI_PROVIDER_NAME;
    summary: {
        total_requests: number;
        total_failures: number;
        error_rate_percent: number;
        average_input_tokens: number;
        average_output_tokens: number;
        average_latency_ms: number;
        average_system_prompt_tokens: number;
        average_history_tokens: number;
        average_retrieval_tokens: number;
        average_query_tokens: number;
        total_tokens_consumed: number;
    };
    top_conversations_by_token_usage: GeminiUsageMetrics['top_conversations_by_token_usage'];
    top_models_by_token_usage: GeminiUsageMetrics['top_models_by_token_usage'];
    recent_failures: Array<{
        timestamp: string;
        request_id: string;
        model: string;
        error_code: string;
        error_message: string;
        conversation_id?: string;
        user_id?: string;
    }>;
}
export declare class GeminiMetricsStore {
    private readonly records;
    add(record: GeminiUsageRecord): void;
    getRecords(): readonly GeminiUsageRecord[];
    clear(): void;
    buildMetrics(): GeminiUsageMetrics;
    buildDashboardData(applicationName: string, environment: string): GeminiUsageDashboardData;
    private rankConversations;
    private rankModels;
}
export declare function extractUsageFromResponse(response: unknown): {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cached_tokens: number;
};
export declare function extractErrorCode(error: unknown): string;
export declare function extractErrorMessage(error: unknown): string;
export declare function resolveApplicationName(): string;
export declare function resolveEnvironment(): string;
export declare function createRequestId(existingId?: string): string;
//# sourceMappingURL=gemini-observability.d.ts.map