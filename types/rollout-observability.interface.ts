import { PlannerTool } from './planner.interface';

export interface PlannerDecisionLog {
  query: string;
  plannerCapability: PlannerTool | 'none';
  confidence: 'high' | 'medium' | 'low';
}

export interface RolloutMetricsSnapshot {
  plannerDistribution: Record<PlannerTool | 'none', number>;
  totalRequests: number;
}

export interface ActivePipelineLog {
  pipeline: 'execution_graph';
  plannerCapability: PlannerTool | 'none';
  executor: string;
  finalStrategy: string;
}
