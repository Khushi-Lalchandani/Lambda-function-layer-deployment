"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newRequestId = newRequestId;
exports.getRequestContext = getRequestContext;
exports.runWithRequestObservability = runWithRequestObservability;
exports.logInfo = logInfo;
exports.logDebug = logDebug;
exports.logTrace = logTrace;
exports.logObservabilityError = logObservabilityError;
exports.logRequestStart = logRequestStart;
exports.logRequestEnd = logRequestEnd;
exports.recordTiming = recordTiming;
exports.markWebSearchTriggered = markWebSearchTriggered;
exports.markGuardrailTriggered = markGuardrailTriggered;
exports.setPlannerDecision = setPlannerDecision;
exports.setSufficiencyResult = setSufficiencyResult;
exports.logPlannerDecision = logPlannerDecision;
exports.logRetrievalSummary = logRetrievalSummary;
exports.logQueryRewrite = logQueryRewrite;
exports.logQueryRewriteHistory = logQueryRewriteHistory;
exports.logQueryDecomposition = logQueryDecomposition;
exports.logWebSearchQueryOptimization = logWebSearchQueryOptimization;
exports.logSufficiency = logSufficiency;
exports.logWebSearchInvocation = logWebSearchInvocation;
exports.setSourceInfo = setSourceInfo;
exports.mapSourceInfoToFinalStrategy = mapSourceInfoToFinalStrategy;
exports.mapExecutorStrategyToFinalStrategy = mapExecutorStrategyToFinalStrategy;
const node_async_hooks_1 = require("node:async_hooks");
const common_1 = require("@nestjs/common");
const gemini_observability_1 = require("./gemini-observability");
const logging_config_1 = require("./logging-config");
const observabilityLogger = new common_1.Logger('Observability');
const storage = new node_async_hooks_1.AsyncLocalStorage();
function emptyTiming() {
    return {
        preprocessingMs: 0,
        retrievalMs: 0,
        sufficiencyMs: 0,
        webSearchMs: 0,
        answerGenerationMs: 0,
        refinementMs: 0,
    };
}
function newRequestId() {
    return (0, gemini_observability_1.createRequestId)();
}
function getRequestContext() {
    return storage.getStore();
}
async function runWithRequestObservability(params, fn) {
    const state = {
        requestId: params.requestId ?? newRequestId(),
        chatId: params.chatId,
        query: params.query,
        startTime: Date.now(),
        guardrailTriggered: false,
        webSearchTriggered: false,
        timing: emptyTiming(),
    };
    return storage.run(state, fn);
}
function formatFields(fields) {
    return Object.entries(fields)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => {
        const serialized = typeof value === 'string' &&
            (value.includes('\n') || value.includes('"'))
            ? JSON.stringify(value)
            : String(value);
        return `${key}=${serialized}`;
    })
        .join('\n');
}
function logInfo(tag, fields) {
    observabilityLogger.log(`[${tag}]\n${formatFields(fields)}`);
}
function logDebug(tag, fields) {
    if (!(0, logging_config_1.isDebugEnabled)()) {
        return;
    }
    observabilityLogger.debug(`[${tag}]\n${formatFields(fields)}`);
}
function logTrace(tag, payload) {
    if (!(0, logging_config_1.isTraceEnabled)()) {
        return;
    }
    const body = typeof payload === 'string' ? payload : formatFields(payload);
    observabilityLogger.verbose(`[${tag}]\n${body}`);
}
function logObservabilityError(component, error) {
    const ctx = getRequestContext();
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    observabilityLogger.error(`[ERROR]\n${formatFields({
        requestId: ctx?.requestId ?? 'unknown',
        component,
        error: message,
        stack: stack ?? '',
    })}`);
}
function logRequestStart() {
    const ctx = getRequestContext();
    if (!ctx) {
        return;
    }
    logInfo('REQUEST_START', {
        requestId: ctx.requestId,
        chatId: ctx.chatId,
        query: ctx.query,
        plannerCapability: ctx.plannerCapability ?? 'pending',
        timestamp: new Date(ctx.startTime).toISOString(),
    });
}
function logRequestEnd(overrides = {}) {
    const ctx = getRequestContext();
    if (!ctx) {
        return;
    }
    if (overrides.executor) {
        ctx.executor = overrides.executor;
    }
    if (overrides.finalStrategy) {
        ctx.finalStrategy = overrides.finalStrategy;
    }
    if (overrides.sourceInfo) {
        ctx.sourceInfo = overrides.sourceInfo;
    }
    const totalLatencyMs = Date.now() - ctx.startTime;
    const finalStrategy = overrides.finalStrategy ??
        ctx.finalStrategy ??
        mapSourceInfoToFinalStrategy(ctx.sourceInfo) ??
        'unknown';
    logInfo('REQUEST_END', {
        requestId: ctx.requestId,
        finalStrategy,
        executor: ctx.executor ?? 'unknown',
        sourceInfo: ctx.sourceInfo ?? 'unknown',
        totalLatencyMs,
        preprocessingMs: ctx.timing.preprocessingMs,
        retrievalMs: ctx.timing.retrievalMs,
        sufficiencyMs: ctx.timing.sufficiencyMs,
        webSearchMs: ctx.timing.webSearchMs,
        answerGenerationMs: ctx.timing.answerGenerationMs,
        refinementMs: ctx.timing.refinementMs,
        tokenUsage: overrides.tokenUsage ?? 'n/a',
    });
}
function recordTiming(phase, ms) {
    const ctx = getRequestContext();
    if (!ctx || ms <= 0) {
        return;
    }
    ctx.timing[phase] += ms;
}
function markWebSearchTriggered() {
    const ctx = getRequestContext();
    if (ctx) {
        ctx.webSearchTriggered = true;
    }
}
function markGuardrailTriggered() {
    const ctx = getRequestContext();
    if (ctx) {
        ctx.guardrailTriggered = true;
    }
}
function setPlannerDecision(plannerCapability, confidence) {
    const ctx = getRequestContext();
    if (!ctx) {
        return;
    }
    ctx.plannerCapability = plannerCapability;
    ctx.plannerConfidence = confidence;
}
function setSufficiencyResult(result) {
    const ctx = getRequestContext();
    if (ctx) {
        ctx.sufficiencyResult = result;
    }
}
function logPlannerDecision(fields) {
    setPlannerDecision(fields.plannerCapability, fields.confidence);
    if (fields.executor) {
        const ctx = getRequestContext();
        if (ctx) {
            ctx.executor = fields.executor;
        }
    }
    logInfo('PLANNER_DECISION', {
        requestId: getRequestContext()?.requestId,
        plannerCapability: fields.plannerCapability,
        confidence: fields.confidence,
        executor: fields.executor ?? 'pending',
    });
}
function logRetrievalSummary(fields) {
    recordTiming('retrievalMs', fields.retrievalMs);
    logInfo('RETRIEVAL', {
        requestId: getRequestContext()?.requestId,
        intent: fields.intent,
        chunkCount: fields.chunkCount,
        topSimilarity: Number(fields.topSimilarity.toFixed(3)),
        retrievalMs: fields.retrievalMs,
        profile: fields.profile,
    });
}
function logQueryRewrite(fields) {
    logInfo('QUERY_REWRITE', {
        requestId: getRequestContext()?.requestId,
        originalQuery: fields.originalQuery,
        rewrittenQuery: fields.rewrittenQuery,
        wasRewritten: fields.wasRewritten,
        reason: fields.reason,
        historyMessageCount: fields.historyMessageCount ?? 0,
        historyTurnCount: fields.historyTurnCount ?? 0,
        historyUsed: fields.historyUsed ?? false,
        historyChars: fields.historyChars ?? 0,
    });
}
function logQueryRewriteHistory(fields) {
    logInfo('QUERY_REWRITE_HISTORY', {
        requestId: getRequestContext()?.requestId,
        historySent: fields.historySent || '(empty)',
        llmUserPrompt: fields.llmUserPrompt,
    });
    logTrace('QUERY_REWRITE_CONTEXT', {
        historySent: fields.historySent || null,
        llmUserPrompt: fields.llmUserPrompt,
    });
}
function logQueryDecomposition(fields) {
    logInfo('QUERY_DECOMPOSITION', {
        requestId: getRequestContext()?.requestId,
        originalQuery: fields.originalQuery,
        shouldDecompose: fields.shouldDecompose,
        subQueries: fields.subQueries.join(' | ') || 'none',
        reason: fields.reason,
    });
}
function logWebSearchQueryOptimization(fields) {
    logInfo('WEB_SEARCH_QUERY_OPTIMIZER', {
        requestId: getRequestContext()?.requestId,
        originalWebQuery: fields.originalWebQuery,
        optimizedWebQuery: fields.optimizedWebQuery,
        optimizationApplied: fields.optimizationApplied,
    });
}
function logSufficiency(fields) {
    recordTiming('sufficiencyMs', fields.latencyMs);
    setSufficiencyResult(fields.result);
    if (fields.guardrailTriggered) {
        markGuardrailTriggered();
    }
    logInfo('SUFFICIENCY', {
        requestId: getRequestContext()?.requestId,
        result: fields.result,
        topSimilarity: Number(fields.topSimilarity.toFixed(3)),
        chunkCount: fields.chunkCount,
        guardrailTriggered: fields.guardrailTriggered,
        latencyMs: fields.latencyMs,
        missingInfo: fields.missingInfo?.trim() || 'none',
    });
}
function logWebSearchInvocation(fields) {
    recordTiming('webSearchMs', fields.latencyMs);
    markWebSearchTriggered();
    logInfo('WEB_SEARCH', {
        requestId: getRequestContext()?.requestId,
        triggerReason: fields.triggerReason,
        queryMode: fields.queryMode,
        latencyMs: fields.latencyMs,
        model: fields.model ?? 'unknown',
        missingInfo: fields.missingInfo?.trim() || 'none',
        originalWebQuery: fields.originalWebQuery ?? 'n/a',
        optimizedWebQuery: fields.optimizedWebQuery ?? 'n/a',
        enhancedWebQuery: fields.enhancedWebQuery ?? 'n/a',
        optimizationApplied: fields.optimizationApplied ?? false,
        missingInfoUsed: fields.missingInfoUsed ?? false,
    });
}
function setSourceInfo(sourceInfo) {
    const ctx = getRequestContext();
    if (ctx) {
        ctx.sourceInfo = sourceInfo;
    }
}
function mapSourceInfoToFinalStrategy(sourceInfo) {
    switch (sourceInfo) {
        case 'vector_search_only':
            return 'document_only';
        case 'vector_search + web_search':
            return 'hybrid';
        case 'web_search_only':
            return 'web_only';
        case 'document_insufficient':
        case 'no_results':
            return 'document_insufficient';
        default:
            return sourceInfo ?? 'unknown';
    }
}
function mapExecutorStrategyToFinalStrategy(strategy) {
    switch (strategy) {
        case 'vector':
            return 'document_only';
        case 'vector + web_search':
            return 'hybrid';
        case 'web_search':
            return 'web_only';
        case 'metadata':
        case 'greeting':
            return 'document_only';
        case 'conservative':
            return 'document_insufficient';
        default:
            return strategy ?? 'unknown';
    }
}
//# sourceMappingURL=request-observability.js.map