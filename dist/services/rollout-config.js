"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rolloutModeLabel = rolloutModeLabel;
exports.legacyFeatureLabel = legacyFeatureLabel;
exports.plannerRolloutLabel = plannerRolloutLabel;
exports.executionGraphRolloutLabel = executionGraphRolloutLabel;
exports.logRolloutStatus = logRolloutStatus;
const query_rewrite_config_1 = require("./query-rewrite-config");
const query_decomposition_config_1 = require("./query-decomposition-config");
const planner_config_1 = require("./planner-config");
const execution_config_1 = require("./execution-config");
function rolloutModeLabel(enabled) {
    return enabled ? 'ACTIVE' : 'SHADOW';
}
function legacyFeatureLabel(active) {
    if (!active) {
        return 'DISABLED';
    }
    return execution_config_1.executionConfig.useLegacyRouting ? 'ACTIVE' : 'SHADOW';
}
function plannerRolloutLabel() {
    return rolloutModeLabel(planner_config_1.plannerConfig.enablePlanner && !planner_config_1.plannerConfig.enablePlannerShadow);
}
function executionGraphRolloutLabel() {
    return rolloutModeLabel(execution_config_1.executionConfig.enableExecutionGraph &&
        !execution_config_1.executionConfig.enableExecutionGraphShadow);
}
function logRolloutStatus(logger = console) {
    const lines = [
        '[RAG_ROLLOUT]',
        `QUERY_REWRITE: ${rolloutModeLabel(query_rewrite_config_1.queryRewriteConfig.enableQueryRewrite)}`,
        `DECOMPOSITION: ${rolloutModeLabel(query_decomposition_config_1.queryDecompositionConfig.enableQueryDecomposition)}`,
        `PLANNER: ${plannerRolloutLabel()}`,
        `EXECUTION_GRAPH: ${executionGraphRolloutLabel()}`,
        `LEGACY_ROUTING: ${legacyFeatureLabel(execution_config_1.executionConfig.useLegacyRouting)}`,
        `LEGACY_SHADOW: ${legacyFeatureLabel(execution_config_1.executionConfig.enableLegacyShadow)}`,
    ];
    for (const line of lines) {
        logger.log(line);
    }
}
//# sourceMappingURL=rollout-config.js.map