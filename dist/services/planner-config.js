"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plannerConfig = void 0;
const llm_model_constants_1 = require("./llm-model.constants");
/**
 * Phase B planner rollout flags.
 * Planner always runs after rewrite/decompose.
 * When ENABLE_PLANNER=true: planner is ACTIVE in rollout status.
 * When ENABLE_PLANNER_SHADOW=true: planner remains observational (legacy drives answers).
 */
exports.plannerConfig = {
    get enablePlanner() {
        return (process.env.ENABLE_PLANNER ?? 'false').toLowerCase() === 'true';
    },
    get enablePlannerShadow() {
        const envValue = process.env.ENABLE_PLANNER_SHADOW;
        if (envValue !== undefined) {
            return envValue.toLowerCase() === 'true';
        }
        return !this.enablePlanner;
    },
    model: process.env.PLANNER_MODEL ?? llm_model_constants_1.GPT_5_MINI,
};
//# sourceMappingURL=planner-config.js.map