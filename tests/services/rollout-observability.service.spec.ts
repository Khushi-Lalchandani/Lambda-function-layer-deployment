import { describe, it, expect, vi, afterEach } from 'vitest';
import { RolloutObservabilityService } from '../../services/rollout-observability.service';
import { PlannerResult } from '../../types/planner.interface';

describe('RolloutObservabilityService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records planner distribution and execution graph outcomes', () => {
    const service = new RolloutObservabilityService();
    const plannerResults: PlannerResult[] = [
      {
        originalQuery: 'Summarize the notice',
        subQuery: 'Summarize the notice',
        actions: [{ tool: 'DOCUMENT_FIRST', query: 'Summarize the notice' }],
        confidence: 'high',
      },
    ];

    service.observeExecutionOutcome(
      'Summarize the notice',
      plannerResults,
      'vector',
      'DocumentFirstExecutor',
    );

    const metrics = service.getMetricsSnapshot();
    expect(metrics.plannerDistribution.DOCUMENT_FIRST).toBe(1);
    expect(metrics.totalRequests).toBe(1);
  });

  it('tracks planner capability distribution across requests', () => {
    const service = new RolloutObservabilityService();
    const webPlannerResults: PlannerResult[] = [
      {
        originalQuery: 'Explain Section 148A',
        subQuery: 'Explain Section 148A',
        actions: [{ tool: 'WEB_FIRST', query: 'Explain Section 148A' }],
        confidence: 'high',
      },
    ];

    service.observeExecutionOutcome(
      'Explain Section 148A',
      webPlannerResults,
      'web_search',
      'WebFirstExecutor',
    );

    const metrics = service.getMetricsSnapshot();
    expect(metrics.plannerDistribution.WEB_FIRST).toBe(1);
    expect(metrics.totalRequests).toBe(1);
  });
});
