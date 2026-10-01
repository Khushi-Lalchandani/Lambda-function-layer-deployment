/**
 * Production logging policy:
 * - INFO: operational observability only (REQUEST_*, PLANNER_DECISION, QUERY_REWRITE,
 *   QUERY_REWRITE_HISTORY, QUERY_DECOMPOSITION, RETRIEVAL, SUFFICIENCY, WEB_SEARCH_QUERY_OPTIMIZER, WEB_SEARCH, ERROR)
 * - DEBUG: developer diagnostics (gated by LOG_DEBUG)
 * - TRACE: prompts, chunk previews, history dumps (gated by LOG_TRACE; never enable in production)
 */
export declare function isDebugEnabled(): boolean;
export declare function isTraceEnabled(): boolean;
export declare const loggingConfig: {
    readonly debugEnabled: boolean;
    readonly traceEnabled: boolean;
};
//# sourceMappingURL=logging-config.d.ts.map