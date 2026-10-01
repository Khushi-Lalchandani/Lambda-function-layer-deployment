"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryRewriteConfig = void 0;
/**
 * Phase 1 query rewrite feature flag.
 * Default true in Phase 1 rollout. Set ENABLE_QUERY_REWRITE=false to disable.
 */
exports.queryRewriteConfig = {
    get enableQueryRewrite() {
        return ((process.env.ENABLE_QUERY_REWRITE ?? 'true').toLowerCase() === 'true');
    },
    model: process.env.QUERY_REWRITE_MODEL ?? 'gemini-3-flash-preview',
};
//# sourceMappingURL=query-rewrite-config.js.map