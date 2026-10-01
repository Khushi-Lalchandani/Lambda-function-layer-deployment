"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executionConfig = void 0;
/**
 * Execution graph rollout flags.
 *
 * Production defaults: graph active, legacy disabled.
 * Set USE_LEGACY_ROUTING=true for emergency rollback only.
 */
exports.executionConfig = {
    get enableExecutionGraph() {
        const envValue = process.env.ENABLE_EXECUTION_GRAPH;
        if (envValue !== undefined) {
            return envValue.toLowerCase() === 'true';
        }
        return true;
    },
    get enableExecutionGraphShadow() {
        const envValue = process.env.ENABLE_EXECUTION_GRAPH_SHADOW;
        if (envValue !== undefined) {
            return envValue.toLowerCase() === 'true';
        }
        return false;
    },
    get useLegacyRouting() {
        const envValue = process.env.USE_LEGACY_ROUTING;
        if (envValue !== undefined) {
            return envValue.toLowerCase() === 'true';
        }
        return false;
    },
    /** Legacy shadow comparison — disabled in production; enable only for rollback validation. */
    get enableLegacyShadow() {
        const envValue = process.env.ENABLE_LEGACY_SHADOW;
        if (envValue !== undefined) {
            return envValue.toLowerCase() === 'true';
        }
        return false;
    },
};
//# sourceMappingURL=execution-config.js.map