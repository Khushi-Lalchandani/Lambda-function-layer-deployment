import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import { createRequestId } from './gemini-observability';
import { isDebugEnabled, isTraceEnabled } from './logging-config';

const observabilityLogger = new Logger('Observability');

export type SufficiencyResult = 'YES' | 'PARTIAL' | 'NO';

export type FinalStrategyLabel =
  | 'document_only'
  | 'hybrid'
  | 'web_only'
  | 'document_insufficient'
  | string;

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

const storage = new AsyncLocalStorage<RequestObservabilityState>();

function emptyTiming(): RequestTiming {
  return {
    preprocessingMs: 0,
    retrievalMs: 0,
    sufficiencyMs: 0,
    webSearchMs: 0,
    answerGenerationMs: 0,
    refinementMs: 0,
  };
}

export function newRequestId(): string {
  return createRequestId();
}

export function getRequestContext(): RequestObservabilityState | undefined {
  return storage.getStore();
}

export async function runWithRequestObservability<T>(
  params: { requestId?: string; chatId: string; query: string },
  fn: () => Promise<T>,
): Promise<T> {
  const state: RequestObservabilityState = {
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

function formatFields(fields: object): string {
  return Object.entries(fields as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      const serialized =
        typeof value === 'string' &&
        (value.includes('\n') || value.includes('"'))
          ? JSON.stringify(value)
          : String(value);
      return `${key}=${serialized}`;
    })
    .join('\n');
}

export function logInfo(tag: string, fields: object): void {
  observabilityLogger.log(`[${tag}]\n${formatFields(fields)}`);
}

export function logDebug(tag: string, fields: object): void {
  if (!isDebugEnabled()) {
    return;
  }
  observabilityLogger.debug(`[${tag}]\n${formatFields(fields)}`);
}

export function logTrace(tag: string, payload: object | string): void {
  if (!isTraceEnabled()) {
    return;
  }
  const body = typeof payload === 'string' ? payload : formatFields(payload);
  observabilityLogger.verbose(`[${tag}]\n${body}`);
}

export function logObservabilityError(component: string, error: unknown): void {
  const ctx = getRequestContext();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  observabilityLogger.error(
    `[ERROR]\n${formatFields({
      requestId: ctx?.requestId ?? 'unknown',
      component,
      error: message,
      stack: stack ?? '',
    })}`,
  );
}

export function logRequestStart(): void {
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

export function logRequestEnd(overrides: RequestEndOverrides = {}): void {
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
  const finalStrategy =
    overrides.finalStrategy ??
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

export function recordTiming(
  phase: keyof RequestTiming,
  ms: number,
): void {
  const ctx = getRequestContext();
  if (!ctx || ms <= 0) {
    return;
  }
  ctx.timing[phase] += ms;
}

export function markWebSearchTriggered(): void {
  const ctx = getRequestContext();
  if (ctx) {
    ctx.webSearchTriggered = true;
  }
}

export function markGuardrailTriggered(): void {
  const ctx = getRequestContext();
  if (ctx) {
    ctx.guardrailTriggered = true;
  }
}

export function setPlannerDecision(
  plannerCapability: string,
  confidence: string,
): void {
  const ctx = getRequestContext();
  if (!ctx) {
    return;
  }
  ctx.plannerCapability = plannerCapability;
  ctx.plannerConfidence = confidence;
}

export function setSufficiencyResult(result: SufficiencyResult): void {
  const ctx = getRequestContext();
  if (ctx) {
    ctx.sufficiencyResult = result;
  }
}

export function logPlannerDecision(fields: {
  plannerCapability: string;
  confidence: string;
  executor?: string;
}): void {
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

export function logRetrievalSummary(fields: {
  intent: string;
  chunkCount: number;
  topSimilarity: number;
  retrievalMs: number;
  profile: string;
}): void {
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

export function logQueryRewrite(fields: {
  originalQuery: string;
  rewrittenQuery: string;
  wasRewritten: boolean;
  reason: string;
  historyMessageCount?: number;
  historyTurnCount?: number;
  historyUsed?: boolean;
  historyChars?: number;
}): void {
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

export function logQueryRewriteHistory(fields: {
  historySent: string;
  llmUserPrompt: string;
}): void {
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

export function logQueryDecomposition(fields: {
  originalQuery: string;
  shouldDecompose: boolean;
  subQueries: string[];
  reason: string;
}): void {
  logInfo('QUERY_DECOMPOSITION', {
    requestId: getRequestContext()?.requestId,
    originalQuery: fields.originalQuery,
    shouldDecompose: fields.shouldDecompose,
    subQueries: fields.subQueries.join(' | ') || 'none',
    reason: fields.reason,
  });
}

export function logWebSearchQueryOptimization(fields: {
  originalWebQuery: string;
  optimizedWebQuery: string;
  optimizationApplied: boolean;
}): void {
  logInfo('WEB_SEARCH_QUERY_OPTIMIZER', {
    requestId: getRequestContext()?.requestId,
    originalWebQuery: fields.originalWebQuery,
    optimizedWebQuery: fields.optimizedWebQuery,
    optimizationApplied: fields.optimizationApplied,
  });
}

export function logSufficiency(fields: {
  result: SufficiencyResult;
  topSimilarity: number;
  chunkCount: number;
  guardrailTriggered: boolean;
  latencyMs: number;
  missingInfo?: string;
}): void {
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

export function logWebSearchInvocation(fields: {
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
}): void {
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

export function setSourceInfo(sourceInfo: string): void {
  const ctx = getRequestContext();
  if (ctx) {
    ctx.sourceInfo = sourceInfo;
  }
}

export function mapSourceInfoToFinalStrategy(
  sourceInfo?: string,
): FinalStrategyLabel {
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

export function mapExecutorStrategyToFinalStrategy(
  strategy?: string,
): FinalStrategyLabel {
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
