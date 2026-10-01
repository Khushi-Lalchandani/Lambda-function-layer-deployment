/**
 * Production logging policy:
 * - INFO: operational observability only (REQUEST_*, PLANNER_DECISION, QUERY_REWRITE,
 *   QUERY_REWRITE_HISTORY, QUERY_DECOMPOSITION, RETRIEVAL, SUFFICIENCY, WEB_SEARCH_QUERY_OPTIMIZER, WEB_SEARCH, ERROR)
 * - DEBUG: developer diagnostics (gated by LOG_DEBUG)
 * - TRACE: prompts, chunk previews, history dumps (gated by LOG_TRACE; never enable in production)
 */

export function isDebugEnabled(): boolean {
  return (process.env.LOG_DEBUG ?? 'false').toLowerCase() === 'true';
}

export function isTraceEnabled(): boolean {
  return (process.env.LOG_TRACE ?? 'false').toLowerCase() === 'true';
}

export const loggingConfig = {
  get debugEnabled(): boolean {
    return isDebugEnabled();
  },
  get traceEnabled(): boolean {
    return isTraceEnabled();
  },
};
