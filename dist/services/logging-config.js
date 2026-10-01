"use strict";
/**
 * Production logging policy:
 * - INFO: operational observability only (REQUEST_*, PLANNER_DECISION, QUERY_REWRITE,
 *   QUERY_REWRITE_HISTORY, QUERY_DECOMPOSITION, RETRIEVAL, SUFFICIENCY, WEB_SEARCH_QUERY_OPTIMIZER, WEB_SEARCH, ERROR)
 * - DEBUG: developer diagnostics (gated by LOG_DEBUG)
 * - TRACE: prompts, chunk previews, history dumps (gated by LOG_TRACE; never enable in production)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loggingConfig = void 0;
exports.isDebugEnabled = isDebugEnabled;
exports.isTraceEnabled = isTraceEnabled;
function isDebugEnabled() {
    return (process.env.LOG_DEBUG ?? 'false').toLowerCase() === 'true';
}
function isTraceEnabled() {
    return (process.env.LOG_TRACE ?? 'false').toLowerCase() === 'true';
}
exports.loggingConfig = {
    get debugEnabled() {
        return isDebugEnabled();
    },
    get traceEnabled() {
        return isTraceEnabled();
    },
};
//# sourceMappingURL=logging-config.js.map