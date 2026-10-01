import { describe, it, expect } from 'vitest';
import { ExecutorRegistry } from '../../services/executor-registry';
import { GreetingExecutor } from '../../services/executors/greeting.executor';
import { TimelineExecutor } from '../../services/executors/timeline.executor';
import { SummaryExecutor } from '../../services/executors/summary.executor';
import { DocumentFirstExecutor } from '../../services/executors/document.executor';
import { WebFirstExecutor } from '../../services/executors/web.executor';
import { RefuseExecutor } from '../../services/executors/refuse.executor';
import { ExecutionCapability } from '../../types/execution.interface';

function createRegistry(): ExecutorRegistry {
  return new ExecutorRegistry(
    new GreetingExecutor({ getGreetingResponse: () => '' } as any),
    new TimelineExecutor({ getChronologicalTimelineAnswer: async () => '' } as any),
    new SummaryExecutor(
      { getMetadataSearchAnswer: async () => '' } as any,
      {
        retrieveRankedChunks: async () => [],
        processVectorQuery: async () => ({ answer: '', references: [], confidence: 0 }),
      } as any,
      { checkSemanticSufficiency: async () => ({ sufficiency: 'YES', reason: '' }) } as any,
    ),
    new DocumentFirstExecutor(
      {
        retrieveRankedChunks: async () => [],
        processVectorQuery: async () => ({ answer: '', references: [], confidence: 0 }),
      } as any,
      {
        checkSemanticSufficiency: async () => ({ sufficiency: 'YES', reason: '' }),
        generateHybridAnswer: async () => ({ answer: '', source_info: 'vector_search' }),
      } as any,
      { getConservativeResponse: () => '' } as any,
      { getDocumentClassificationAnswer: async () => '' } as any,
    ),
    new WebFirstExecutor(
      { searchWithGrounding: async () => '' } as any,
      { retrieveRankedChunks: async () => [] } as any,
      new DocumentFirstExecutor(
        {
          retrieveRankedChunks: async () => [],
          processVectorQuery: async () => ({ answer: '', references: [], confidence: 0 }),
        } as any,
        {
          checkSemanticSufficiency: async () => ({ sufficiency: 'YES', reason: '' }),
          generateHybridAnswer: async () => ({ answer: '', source_info: 'vector_search' }),
        } as any,
        { getConservativeResponse: () => '' } as any,
        { getDocumentClassificationAnswer: async () => '' } as any,
      ),
    ),
    new RefuseExecutor({ getConservativeResponse: () => '' } as any),
  );
}

describe('ExecutorRegistry', () => {
  const registry = createRegistry();

  it.each<[ExecutionCapability, string]>([
    ['GREETING', 'GreetingExecutor'],
    ['CASE_TIMELINE', 'TimelineExecutor'],
    ['CASE_SUMMARY', 'SummaryExecutor'],
    ['DOCUMENT_FIRST', 'DocumentFirstExecutor'],
    ['WEB_FIRST', 'WebFirstExecutor'],
    ['REFUSE', 'RefuseExecutor'],
  ])('resolves %s to %s', (capability, expectedName) => {
    const executor = registry.getExecutor(capability);
    expect(executor?.name).toBe(expectedName);
    expect(registry.getExecutorName(capability)).toBe(expectedName);
  });
});
