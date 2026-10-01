import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { ExecutionGraphService } from '../../services/execution-graph.service';
import { ExecutionGraphBuilder } from '../../services/execution-graph-builder';
import { ExecutorRegistry } from '../../services/executor-registry';
import { PlannerResult } from '../../types/planner.interface';

describe('ExecutionGraphService', () => {
  const graphBuilder = new ExecutionGraphBuilder();
  const executorRegistry = {
    getExecutorName: vi.fn((capability: string) => {
      const names: Record<string, string> = {
        CASE_SUMMARY: 'SummaryExecutor',
        WEB_FIRST: 'WebFirstExecutor',
      };
      return names[capability] ?? `${capability}Executor`;
    }),
  } as unknown as ExecutorRegistry;
  const service = new ExecutionGraphService(graphBuilder, executorRegistry);
  let loggerSpy: ReturnType<typeof vi.spyOn>;
  let previousDebug: string | undefined;

  beforeEach(() => {
    previousDebug = process.env.LOG_DEBUG;
    process.env.LOG_DEBUG = 'true';
    loggerSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerSpy.mockRestore();
    process.env.LOG_DEBUG = previousDebug;
  });

  it('emits structured execution logs in debug mode', () => {
    const plannerResults: PlannerResult[] = [
      {
        originalQuery: 'Summarize the notice and explain Section 148A',
        subQuery: 'Summarize the notice and explain Section 148A',
        actions: [
          { tool: 'CASE_SUMMARY', query: 'Summarize the notice' },
          { tool: 'WEB_FIRST', query: 'Explain Section 148A' },
        ],
        confidence: 'medium',
      },
    ];

    service.logShadowExecution(
      'Summarize the notice and explain Section 148A',
      plannerResults,
      {
        originalQuery: 'Summarize the notice and explain Section 148A',
        shouldDecompose: false,
        subQueries: [],
      },
    );

    const shadowLog = service.buildShadowLog(
      'Summarize the notice and explain Section 148A',
      plannerResults,
      {
        originalQuery: 'Summarize the notice and explain Section 148A',
        shouldDecompose: false,
        subQueries: [],
      },
    );

    expect(shadowLog).toEqual({
      query: 'Summarize the notice and explain Section 148A',
      planner_actions: ['CASE_SUMMARY', 'WEB_FIRST'],
      execution_graph: [
        { capability: 'CASE_SUMMARY', query: 'Summarize the notice' },
        { capability: 'WEB_FIRST', query: 'Explain Section 148A' },
      ],
      executor_mapping: ['SummaryExecutor', 'WebFirstExecutor'],
    });

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('[EXECUTION_GRAPH]'),
    );
  });
});
