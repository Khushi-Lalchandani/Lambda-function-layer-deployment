/**
 * Phase B planner rollout flags.
 * Planner always runs after rewrite/decompose.
 * When ENABLE_PLANNER=true: planner is ACTIVE in rollout status.
 * When ENABLE_PLANNER_SHADOW=true: planner remains observational (legacy drives answers).
 */
export declare const plannerConfig: {
    readonly enablePlanner: boolean;
    readonly enablePlannerShadow: boolean;
    model: string;
};
//# sourceMappingURL=planner-config.d.ts.map