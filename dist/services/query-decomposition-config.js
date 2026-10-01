"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryDecompositionConfig = void 0;
/**
 * Phase 1 query decomposition feature flag.
 * Default true in Phase 1 rollout. Set ENABLE_QUERY_DECOMPOSITION=false to disable.
 */
exports.queryDecompositionConfig = {
    get enableQueryDecomposition() {
        return ((process.env.ENABLE_QUERY_DECOMPOSITION ?? 'true').toLowerCase() ===
            'true');
    },
};
//# sourceMappingURL=query-decomposition-config.js.map