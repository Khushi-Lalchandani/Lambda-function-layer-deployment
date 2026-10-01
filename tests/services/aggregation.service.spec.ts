import { describe, it, expect, beforeEach } from 'vitest';
import { AggregationService } from '../../services/aggregation.service';
import { ExecutorResult } from '../../types/execution.interface';

describe('AggregationService', () => {
  let service: AggregationService;

  beforeEach(() => {
    service = new AggregationService();
  });

  it('returns single result unchanged', () => {
    const results: ExecutorResult[] = [
      {
        executor: 'DocumentFirstExecutor',
        strategy: 'vector',
        answer: 'Single answer text.',
      },
    ];

    const aggregated = service.aggregateDecomposedResults(results);

    expect(aggregated.answer).toBe('Single answer text.');
    expect(aggregated.segments).toEqual([]);
  });

  it('returns greeting immediately when present', () => {
    const results: ExecutorResult[] = [
      {
        executor: 'GreetingExecutor',
        strategy: 'greeting',
        answer: 'Hello! How can I help?',
      },
      {
        executor: 'DocumentFirstExecutor',
        strategy: 'vector',
        answer: 'Should be ignored.',
      },
    ];

    const aggregated = service.aggregateDecomposedResults(results);

    expect(aggregated.answer).toBe('Hello! How can I help?');
  });

  it('builds segments when multiple sub-query answers exist', () => {
    const results: ExecutorResult[] = [
      {
        executor: 'DecomposedQuery',
        strategy: 'vector',
        answer: 'Rakesh Kumar is an Income Tax Officer.',
        purpose: 'Who is Rakesh Kumar?',
      },
      {
        executor: 'DecomposedQuery',
        strategy: 'metadata',
        answer: 'Notice issued on 03-05-2024.',
        purpose: 'Show the chronology of the case.',
      },
    ];

    const aggregated = service.aggregateDecomposedResults(results);

    expect(aggregated.segments).toHaveLength(2);
    expect(aggregated.answer).toContain('Rakesh Kumar is an Income Tax Officer.');
    expect(aggregated.answer).toContain('Notice issued on 03-05-2024.');
  });

  it('removes duplicate segment bodies before merge', () => {
    const results: ExecutorResult[] = [
      {
        executor: 'DecomposedQuery',
        strategy: 'vector',
        answer: 'Rakesh Kumar is an Income Tax Officer.',
        purpose: 'Who is Rakesh Kumar?',
      },
      {
        executor: 'DecomposedQuery',
        strategy: 'vector',
        answer: 'Rakesh Kumar is an Income Tax Officer.',
        purpose: 'Tell me about Rakesh Kumar.',
      },
    ];

    const aggregated = service.aggregateDecomposedResults(results);

    expect(aggregated.segments).toHaveLength(1);
    expect(aggregated.duplicatesRemoved).toBe(1);
  });
});
