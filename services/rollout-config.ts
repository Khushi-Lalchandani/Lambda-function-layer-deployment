import { queryRewriteConfig } from './query-rewrite-config';
import { queryDecompositionConfig } from './query-decomposition-config';
import { plannerConfig } from './planner-config';
import { executionConfig } from './execution-config';

export function rolloutModeLabel(enabled: boolean): 'ACTIVE' | 'SHADOW' {
  return enabled ? 'ACTIVE' : 'SHADOW';
}

export function legacyFeatureLabel(
  active: boolean,
): 'DISABLED' | 'ACTIVE' | 'SHADOW' {
  if (!active) {
    return 'DISABLED';
  }
  return executionConfig.useLegacyRouting ? 'ACTIVE' : 'SHADOW';
}

export function plannerRolloutLabel(): 'ACTIVE' | 'SHADOW' {
  return rolloutModeLabel(
    plannerConfig.enablePlanner && !plannerConfig.enablePlannerShadow,
  );
}

export function executionGraphRolloutLabel(): 'ACTIVE' | 'SHADOW' {
  return rolloutModeLabel(
    executionConfig.enableExecutionGraph &&
      !executionConfig.enableExecutionGraphShadow,
  );
}

export function logRolloutStatus(
  logger: Pick<Console, 'log'> = console,
): void {
  const lines = [
    '[RAG_ROLLOUT]',
    `QUERY_REWRITE: ${rolloutModeLabel(queryRewriteConfig.enableQueryRewrite)}`,
    `DECOMPOSITION: ${rolloutModeLabel(queryDecompositionConfig.enableQueryDecomposition)}`,
    `PLANNER: ${plannerRolloutLabel()}`,
    `EXECUTION_GRAPH: ${executionGraphRolloutLabel()}`,
    `LEGACY_ROUTING: ${legacyFeatureLabel(executionConfig.useLegacyRouting)}`,
    `LEGACY_SHADOW: ${legacyFeatureLabel(executionConfig.enableLegacyShadow)}`,
  ];

  for (const line of lines) {
    logger.log(line);
  }
}
