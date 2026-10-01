import { PlannerResult } from '../types/planner.interface';
import { PlannerDecisionLog, RolloutMetricsSnapshot } from '../types/rollout-observability.interface';
export declare class RolloutObservabilityService {
    private readonly logger;
    private readonly plannerDistribution;
    private totalRequests;
    recordPlannerDecision(payload: PlannerDecisionLog): void;
    buildPlannerDecision(query: string, plannerResults: PlannerResult[]): PlannerDecisionLog;
    observeExecutionOutcome(query: string, plannerResults: PlannerResult[], executionGraphStrategy: string, executor: string): void;
    getMetricsSnapshot(): RolloutMetricsSnapshot;
    private incrementPlannerDistribution;
}
//# sourceMappingURL=rollout-observability.service.d.ts.map