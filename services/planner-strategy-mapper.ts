import {
  ExistingStrategy,
  PlannerAction,
  PlannerComparisonResult,
  PlannerTool,
} from '../types/planner.interface';

const PLANNER_TO_STRATEGY: Record<PlannerTool, ExistingStrategy> = {
  GREETING: 'greeting',
  CASE_TIMELINE: 'metadata',
  CASE_SUMMARY: 'vector',
  DOCUMENT_FIRST: 'vector',
  WEB_FIRST: 'web_search',
  REFUSE: 'conservative',
};

export function mapPlannerToolToStrategy(tool: PlannerTool): ExistingStrategy {
  return PLANNER_TO_STRATEGY[tool];
}

export function mapPlannerActionsToStrategies(
  actions: PlannerAction[],
): string[] {
  return [...new Set(actions.map((action) => mapPlannerToolToStrategy(action.tool)))];
}

export function comparePlannerWithExisting(
  query: string,
  existingStrategy: string,
  actions: PlannerAction[],
): PlannerComparisonResult {
  const plannerActions = actions.map((action) => action.tool);
  const mappedStrategies = mapPlannerActionsToStrategies(actions);

  return {
    query,
    existingStrategy,
    plannerActions,
    mappedStrategies,
    matched: strategiesMatch(existingStrategy, mappedStrategies),
  };
}

export function strategiesMatch(
  existingStrategy: string,
  mappedStrategies: string[],
): boolean {
  if (mappedStrategies.length === 0) {
    return false;
  }

  if (existingStrategy === 'vector + web_search') {
    return (
      mappedStrategies.includes('vector') &&
      mappedStrategies.includes('web_search')
    );
  }

  return (
    mappedStrategies.length === 1 && mappedStrategies[0] === existingStrategy
  );
}
