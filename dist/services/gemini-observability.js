"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiMetricsStore = exports.GEMINI_PROVIDER_NAME = void 0;
exports.extractUsageFromResponse = extractUsageFromResponse;
exports.extractErrorCode = extractErrorCode;
exports.extractErrorMessage = extractErrorMessage;
exports.resolveApplicationName = resolveApplicationName;
exports.resolveEnvironment = resolveEnvironment;
exports.createRequestId = createRequestId;
exports.GEMINI_PROVIDER_NAME = 'vertex_ai';
const MAX_STORED_RECORDS = 5000;
const TOP_ENTRIES_LIMIT = 10;
class GeminiMetricsStore {
    constructor() {
        this.records = [];
    }
    add(record) {
        this.records.push(record);
        if (this.records.length > MAX_STORED_RECORDS) {
            this.records.splice(0, this.records.length - MAX_STORED_RECORDS);
        }
    }
    getRecords() {
        return this.records;
    }
    clear() {
        this.records.length = 0;
    }
    buildMetrics() {
        const totalRequests = this.records.length;
        const failures = this.records.filter((record) => record.status === 'failed');
        const successes = this.records.filter((record) => record.status === 'success');
        const totalFailures = failures.length;
        const errorRate = totalRequests > 0 ? totalFailures / totalRequests : 0;
        const averageInputTokens = average(successes.map((record) => record.input_tokens ?? 0));
        const averageOutputTokens = average(successes.map((record) => record.output_tokens ?? 0));
        const averageLatencyMs = average(this.records.map((record) => record.latency_ms));
        const averageSystemPromptTokens = average(successes.map((record) => record.system_prompt_tokens ?? 0));
        const averageHistoryTokens = average(successes.map((record) => record.history_tokens ?? 0));
        const averageRetrievalTokens = average(successes.map((record) => record.retrieval_tokens ?? 0));
        const averageQueryTokens = average(successes.map((record) => record.query_tokens ?? 0));
        return {
            total_requests: totalRequests,
            total_failures: totalFailures,
            error_rate: round(errorRate, 4),
            average_input_tokens: round(averageInputTokens, 2),
            average_output_tokens: round(averageOutputTokens, 2),
            average_latency_ms: round(averageLatencyMs, 2),
            average_system_prompt_tokens: round(averageSystemPromptTokens, 2),
            average_history_tokens: round(averageHistoryTokens, 2),
            average_retrieval_tokens: round(averageRetrievalTokens, 2),
            average_query_tokens: round(averageQueryTokens, 2),
            top_conversations_by_token_usage: this.rankConversations(),
            top_models_by_token_usage: this.rankModels(),
        };
    }
    buildDashboardData(applicationName, environment) {
        const metrics = this.buildMetrics();
        const totalTokensConsumed = this.records.reduce((sum, record) => sum + (record.total_tokens ?? 0), 0);
        const recentFailures = [...this.records]
            .filter((record) => record.status === 'failed')
            .slice(-TOP_ENTRIES_LIMIT)
            .reverse()
            .map((record) => ({
            timestamp: record.timestamp,
            request_id: record.request_id,
            model: record.model,
            error_code: record.error_code ?? 'UNKNOWN',
            error_message: record.error_message ?? 'Unknown error',
            conversation_id: record.conversation_id,
            user_id: record.user_id,
        }));
        return {
            generated_at: new Date().toISOString(),
            application_name: applicationName,
            environment,
            provider: exports.GEMINI_PROVIDER_NAME,
            summary: {
                total_requests: metrics.total_requests,
                total_failures: metrics.total_failures,
                error_rate_percent: round(metrics.error_rate * 100, 2),
                average_input_tokens: metrics.average_input_tokens,
                average_output_tokens: metrics.average_output_tokens,
                average_latency_ms: metrics.average_latency_ms,
                average_system_prompt_tokens: metrics.average_system_prompt_tokens,
                average_history_tokens: metrics.average_history_tokens,
                average_retrieval_tokens: metrics.average_retrieval_tokens,
                average_query_tokens: metrics.average_query_tokens,
                total_tokens_consumed: totalTokensConsumed,
            },
            top_conversations_by_token_usage: metrics.top_conversations_by_token_usage,
            top_models_by_token_usage: metrics.top_models_by_token_usage,
            recent_failures: recentFailures,
        };
    }
    rankConversations() {
        const totals = new Map();
        for (const record of this.records) {
            if (!record.conversation_id) {
                continue;
            }
            const current = totals.get(record.conversation_id) ?? {
                total_tokens: 0,
                request_count: 0,
            };
            current.total_tokens += record.total_tokens ?? 0;
            current.request_count += 1;
            totals.set(record.conversation_id, current);
        }
        return [...totals.entries()]
            .map(([conversation_id, stats]) => ({
            conversation_id,
            total_tokens: stats.total_tokens,
            request_count: stats.request_count,
        }))
            .sort((left, right) => right.total_tokens - left.total_tokens)
            .slice(0, TOP_ENTRIES_LIMIT);
    }
    rankModels() {
        const totals = new Map();
        for (const record of this.records) {
            const current = totals.get(record.model) ?? {
                total_tokens: 0,
                request_count: 0,
            };
            current.total_tokens += record.total_tokens ?? 0;
            current.request_count += 1;
            totals.set(record.model, current);
        }
        return [...totals.entries()]
            .map(([model, stats]) => ({
            model,
            total_tokens: stats.total_tokens,
            request_count: stats.request_count,
        }))
            .sort((left, right) => right.total_tokens - left.total_tokens)
            .slice(0, TOP_ENTRIES_LIMIT);
    }
}
exports.GeminiMetricsStore = GeminiMetricsStore;
function extractUsageFromResponse(response) {
    const usage = readUsageMetadata(response);
    const inputTokens = usage.promptTokenCount ?? 0;
    const outputTokens = usage.candidatesTokenCount ?? 0;
    const totalTokens = usage.totalTokenCount ?? inputTokens + outputTokens;
    const cachedTokens = usage.cachedContentTokenCount ?? 0;
    return {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        cached_tokens: cachedTokens,
    };
}
function extractErrorCode(error) {
    if (!error || typeof error !== 'object') {
        return 'UNKNOWN';
    }
    const err = error;
    const candidates = [
        err.code,
        err.status,
        err.cause?.code,
        err.cause?.status,
        err.error?.code,
        err.error?.status,
    ];
    for (const candidate of candidates) {
        if (candidate == null || candidate === '') {
            continue;
        }
        return String(candidate);
    }
    return 'UNKNOWN';
}
function extractErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function resolveApplicationName() {
    return (process.env.GEMINI_APPLICATION_NAME?.trim() ||
        process.env.APPLICATION_NAME?.trim() ||
        'socket-ai-service-function');
}
function resolveEnvironment() {
    return (process.env.APP_ENV?.trim() ||
        process.env.ENVIRONMENT?.trim() ||
        process.env.NODE_ENV?.trim() ||
        'unknown');
}
function createRequestId(existingId) {
    if (existingId?.trim()) {
        return existingId.trim();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
function readUsageMetadata(response) {
    if (!response || typeof response !== 'object') {
        return {};
    }
    const res = response;
    return res.usageMetadata ?? {};
}
function average(values) {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function round(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
}
//# sourceMappingURL=gemini-observability.js.map