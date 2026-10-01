import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionOrchestratorService } from '../../services/execution-orchestrator.service';
import { AggregationService } from '../../services/aggregation.service';
import { AnswerRefinementService } from '../../services/answer-refinement.service';
import { ExecutorRegistry } from '../../services/executor-registry';
import { ExecutionGraph } from '../../types/execution.interface';

describe('ExecutionOrchestratorService', () => {
  const mockExecutor = {
    name: 'TimelineExecutor',
    canHandle: () => true,
    execute: vi.fn().mockResolvedValue({
      answer: 'Timeline answer',
      strategy: 'metadata',
    }),
  };

  const registry = {
    getExecutor: vi.fn(() => mockExecutor),
  } as unknown as ExecutorRegistry;

  const aggregationService = new AggregationService();
  const answerRefinementService = {
    refineAnswerForDisplay: vi
      .fn()
      .mockResolvedValue('Refined timeline answer'),
  } as unknown as AnswerRefinementService;

  let orchestrator: ExecutionOrchestratorService;

  beforeEach(() => {
    vi.clearAllMocks();
    registry.getExecutor = vi.fn(() => mockExecutor) as unknown as ExecutorRegistry['getExecutor'];
    mockExecutor.execute.mockResolvedValue({
      answer: 'Timeline answer',
      strategy: 'metadata',
    });
    orchestrator = new ExecutionOrchestratorService(
      registry,
      aggregationService,
      answerRefinementService,
    );
  });

  it('executes graph nodes and refines a single executor result', async () => {
    const graph: ExecutionGraph = {
      originalQuery: 'Show chronology',
      decomposed: false,
      nodes: [
        {
          id: '1',
          capability: 'CASE_TIMELINE',
          query: 'Show chronology',
          dependencies: [],
        },
      ],
    };

    const result = await orchestrator.executeGraph(graph, {
      userId: 'user-1',
      webSearchEnabled: true,
      history: [],
    });

    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
    expect(result.finalAnswer).toBe('Refined timeline answer');
    expect(answerRefinementService.refineAnswerForDisplay).toHaveBeenCalledWith(
      'Timeline answer',
      'Show chronology',
    );
  });

  it('skips refinement when the executor returns an empty answer', async () => {
    mockExecutor.execute.mockResolvedValueOnce({
      answer: '',
      strategy: 'metadata',
    });

    const graph: ExecutionGraph = {
      originalQuery: 'Show chronology',
      decomposed: false,
      nodes: [
        {
          id: '1',
          capability: 'CASE_TIMELINE',
          query: 'Show chronology',
          dependencies: [],
        },
      ],
    };

    const result = await orchestrator.executeGraph(graph, {
      userId: 'user-1',
      webSearchEnabled: true,
      history: [],
    });

    expect(result.finalAnswer).toBe('');
    expect(answerRefinementService.refineAnswerForDisplay).not.toHaveBeenCalled();
  });

  it('refines when multiple executor results are returned', async () => {
    const secondExecutor = {
      name: 'SummaryExecutor',
      canHandle: () => true,
      execute: vi.fn().mockResolvedValue({
        answer: 'Summary answer',
        strategy: 'vector',
      }),
    };

    registry.getExecutor = vi
      .fn()
      .mockReturnValueOnce(mockExecutor)
      .mockReturnValueOnce(secondExecutor) as unknown as ExecutorRegistry['getExecutor'];

    const graph: ExecutionGraph = {
      originalQuery: 'Show chronology and summarize',
      decomposed: true,
      nodes: [
        {
          id: '1',
          capability: 'CASE_TIMELINE',
          query: 'Show chronology',
          dependencies: [],
        },
        {
          id: '2',
          capability: 'CASE_SUMMARY',
          query: 'Summarize the case',
          dependencies: [],
        },
      ],
    };

    const result = await orchestrator.executeGraph(graph, {
      userId: 'user-1',
      webSearchEnabled: true,
      history: [],
    });

    expect(result.finalAnswer).toBe('Refined timeline answer');
    expect(answerRefinementService.refineAnswerForDisplay).toHaveBeenCalledWith(
      expect.stringContaining('Timeline answer'),
      'Show chronology and summarize',
    );
  });

  it('runs independent decomposed nodes in parallel', async () => {
    const secondExecutor = {
      name: 'SummaryExecutor',
      canHandle: () => true,
      execute: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return {
          answer: 'Summary answer',
          strategy: 'vector',
        };
      }),
    };

    mockExecutor.execute = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return {
        answer: 'Timeline answer',
        strategy: 'metadata',
      };
    });

    registry.getExecutor = vi
      .fn()
      .mockReturnValueOnce(mockExecutor)
      .mockReturnValueOnce(secondExecutor) as unknown as ExecutorRegistry['getExecutor'];

    const graph: ExecutionGraph = {
      originalQuery: 'Show chronology and summarize',
      decomposed: true,
      nodes: [
        {
          id: '1',
          capability: 'CASE_TIMELINE',
          query: 'Show chronology',
          dependencies: [],
        },
        {
          id: '2',
          capability: 'CASE_SUMMARY',
          query: 'Summarize the case',
          dependencies: [],
        },
      ],
    };

    const startedAt = Date.now();
    await orchestrator.executeGraph(graph, {
      userId: 'user-1',
      webSearchEnabled: true,
      history: [],
    });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(100);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
    expect(secondExecutor.execute).toHaveBeenCalledTimes(1);
  });
});
