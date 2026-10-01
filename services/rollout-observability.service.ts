import { Injectable, Logger } from '@nestjs/common';
import { PlannerResult, PlannerTool } from '../types/planner.interface';
import {
  ActivePipelineLog,
  PlannerDecisionLog,
  RolloutMetricsSnapshot,
} from '../types/rollout-observability.interface';
import { logDebug } from './request-observability';

const PLANNER_CAPABILITIES: Array<PlannerTool | 'none'> = [
  'DOCUMENT_FIRST',
  'WEB_FIRST',
  'CASE_SUMMARY',
  'CASE_TIMELINE',
  'REFUSE',
  'none',
];

@Injectable()
export class RolloutObservabilityService {
  private readonly logger = new Logger(RolloutObservabilityService.name);
  private readonly plannerDistribution = new Map<PlannerTool | 'none', number>();
  private totalRequests = 0;

  recordPlannerDecision(payload: PlannerDecisionLog): void {
    this.incrementPlannerDistribution(payload.plannerCapability);
    logDebug('ROLLOUT_PLANNER_DECISION', payload);
  }

  buildPlannerDecision(
    query: string,
    plannerResults: PlannerResult[],
  ): PlannerDecisionLog {
    const primaryAction = plannerResults.flatMap((result) => result.actions)[0];
    const primaryResult =
      plannerResults.find((result) => result.actions.length > 0) ??
      plannerResults[0];

    return {
      query,
      plannerCapability: primaryAction?.tool ?? 'none',
      confidence: primaryResult?.confidence ?? 'low',
    };
  }

  observeExecutionOutcome(
    query: string,
    plannerResults: PlannerResult[],
    executionGraphStrategy: string,
    executor: string,
  ): void {
    const plannerDecision = this.buildPlannerDecision(query, plannerResults);
    this.recordPlannerDecision(plannerDecision);

    const activePipeline: ActivePipelineLog = {
      pipeline: 'execution_graph',
      plannerCapability: plannerDecision.plannerCapability,
      executor,
      finalStrategy: executionGraphStrategy,
    };
    logDebug('ROLLOUT_ACTIVE_PIPELINE', activePipeline);

    this.totalRequests += 1;
    logDebug('ROLLOUT_METRICS_SUMMARY', this.getMetricsSnapshot());
  }

  getMetricsSnapshot(): RolloutMetricsSnapshot {
    const plannerDistribution = Object.fromEntries(
      PLANNER_CAPABILITIES.map((capability) => [
        capability,
        this.plannerDistribution.get(capability) ?? 0,
      ]),
    ) as RolloutMetricsSnapshot['plannerDistribution'];

    return {
      plannerDistribution,
      totalRequests: this.totalRequests,
    };
  }

  private incrementPlannerDistribution(capability: PlannerTool | 'none'): void {
    this.plannerDistribution.set(
      capability,
      (this.plannerDistribution.get(capability) ?? 0) + 1,
    );
  }
}
