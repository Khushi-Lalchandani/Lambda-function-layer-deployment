import { GPT_5_MINI } from './llm-model.constants';

/**
 * Phase B planner rollout flags.
 * Planner always runs after rewrite/decompose.
 * When ENABLE_PLANNER=true: planner is ACTIVE in rollout status.
 * When ENABLE_PLANNER_SHADOW=true: planner remains observational (legacy drives answers).
 */
export const plannerConfig = {
  get enablePlanner(): boolean {
    return (process.env.ENABLE_PLANNER ?? 'false').toLowerCase() === 'true';
  },
  get enablePlannerShadow(): boolean {
    const envValue = process.env.ENABLE_PLANNER_SHADOW;
    if (envValue !== undefined) {
      return envValue.toLowerCase() === 'true';
    }
    return !this.enablePlanner;
  },
  model: process.env.PLANNER_MODEL ?? GPT_5_MINI,
};
