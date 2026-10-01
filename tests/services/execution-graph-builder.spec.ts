import { describe, it, expect } from 'vitest';
import { ExecutionGraphBuilder } from '../../services/execution-graph-builder';
import { PlannerResult } from '../../types/planner.interface';

describe('ExecutionGraphBuilder', () => {
  const builder = new ExecutionGraphBuilder();

  it('builds a single CASE_TIMELINE node for chronology query', () => {
    const plannerResults: PlannerResult[] = [
      {
        originalQuery: 'Show chronology',
        subQuery: 'Show chronology',
        actions: [
          { tool: 'CASE_TIMELINE', query: 'Show chronology of the case.' },
        ],
        confidence: 'high',
      },
    ];

    const graph = builder.build(plannerResults);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({
      id: '1',
      capability: 'CASE_TIMELINE',
      query: 'Show chronology of the case.',
      dependencies: [],
    });
  });

  it('builds CASE_SUMMARY and WEB_FIRST nodes for mixed query', () => {
    const plannerResults: PlannerResult[] = [
      {
        originalQuery: 'Summarize notice and explain Section 148A',
        subQuery: 'Summarize notice and explain Section 148A',
        actions: [
          { tool: 'CASE_SUMMARY', query: 'Summarize the notice' },
          { tool: 'WEB_FIRST', query: 'Explain Section 148A' },
        ],
        confidence: 'medium',
      },
    ];

    const graph = builder.build(plannerResults);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]).toMatchObject({
      id: '1',
      capability: 'CASE_SUMMARY',
      query: 'Summarize the notice',
      dependencies: [],
    });
    expect(graph.nodes[1]).toMatchObject({
      id: '2',
      capability: 'WEB_FIRST',
      query: 'Explain Section 148A',
      dependencies: [],
    });
  });

  it('flattens actions across multiple planner results', () => {
    const plannerResults: PlannerResult[] = [
      {
        originalQuery: 'Summarize notice and explain Section 148A',
        subQuery: 'Summarize the notice',
        actions: [
          { tool: 'CASE_SUMMARY', query: 'Summarize the notice' },
        ],
        confidence: 'high',
      },
      {
        originalQuery: 'Summarize notice and explain Section 148A',
        subQuery: 'Explain Section 148A',
        actions: [
          { tool: 'WEB_FIRST', query: 'Explain Section 148A' },
        ],
        confidence: 'high',
      },
    ];

    const graph = builder.build(plannerResults, {
      originalQuery: 'Summarize notice and explain Section 148A',
      shouldDecompose: true,
      subQueries: ['Summarize the notice', 'Explain Section 148A'],
    });

    expect(graph.decomposed).toBe(true);
    expect(graph.nodes.map((node) => node.capability)).toEqual([
      'CASE_SUMMARY',
      'WEB_FIRST',
    ]);
  });
});
