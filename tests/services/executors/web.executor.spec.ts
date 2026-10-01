import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebFirstExecutor } from '../../../services/executors/web.executor';
import { DocumentFirstExecutor } from '../../../services/executors/document.executor';
import { ExecutionNode } from '../../../types/execution.interface';

describe('WebFirstExecutor', () => {
  const node: ExecutionNode = {
    id: '1',
    capability: 'WEB_FIRST',
    query: 'Explain Section 148A',
    dependencies: [],
  };

  const baseContext = {
    userId: 'user-1',
    webSearchEnabled: true,
    documentChats: [{ documentId: 'doc-1', Document: { originalName: 'notice.pdf' } }],
    history: [],
  };

  let webSearchService: any;
  let hybridRetrievalService: any;
  let documentFirstExecutor: DocumentFirstExecutor;
  let executor: WebFirstExecutor;

  beforeEach(() => {
    webSearchService = {
      searchWithGrounding: vi.fn().mockResolvedValue('Web answer'),
    };
    hybridRetrievalService = {
      retrieveRankedChunks: vi.fn().mockResolvedValue([
        { id: '1', content: 'weak', documentId: 'doc-1', similarity: 1.8 },
      ]),
    };
    documentFirstExecutor = new DocumentFirstExecutor(
      {
        retrieveRankedChunks: vi.fn().mockResolvedValue([]),
        processVectorQuery: vi.fn().mockResolvedValue({
          answer: 'Document answer',
          references: [],
          confidence: 0.8,
        }),
      } as any,
      {
        checkSemanticSufficiency: vi.fn().mockResolvedValue({
          sufficiency: 'YES',
          reason: 'Sufficient',
        }),
        generateHybridAnswer: vi.fn().mockResolvedValue({
          answer: 'Hybrid answer',
          source_info: 'vector_search',
        }),
      } as any,
      { getConservativeResponse: () => 'Out of scope' } as any,
      { getDocumentClassificationAnswer: async () => '' } as any,
    );
    executor = new WebFirstExecutor(
      webSearchService,
      hybridRetrievalService,
      documentFirstExecutor,
    );
  });

  it('runs web search when probe evidence is weak', async () => {
    const result = await executor.execute(node, baseContext);

    expect(webSearchService.searchWithGrounding).toHaveBeenCalled();
    expect(result.answer).toBe('Web answer');
    expect(result.trace).toMatchObject({
      plannerDecision: 'WEB_FIRST',
      executor: 'WebFirstExecutor',
      finalStrategy: 'web_search',
    });
  });

  it('redirects into DocumentFirstExecutor when probe finds strong evidence', async () => {
    hybridRetrievalService.retrieveRankedChunks.mockResolvedValue([
      { id: '1', content: 'strong', documentId: 'doc-1', similarity: 0.1 },
      { id: '2', content: 'also strong', documentId: 'doc-1', similarity: 0.2 },
    ]);

    const vectorSearchService = {
      retrieveRankedChunks: vi.fn().mockResolvedValue([
        { id: '1', content: 'strong', documentId: 'doc-1', similarity: 0.1 },
        { id: '2', content: 'also strong', documentId: 'doc-1', similarity: 0.2 },
      ]),
      processVectorQuery: vi.fn(),
    };
    const webSearchServiceForDoc = {
      checkSemanticSufficiency: vi.fn().mockResolvedValue({
        sufficiency: 'YES',
        reason: 'Sufficient',
      }),
      generateHybridAnswer: vi.fn().mockResolvedValue({
        answer: 'Hybrid answer',
        source_info: 'vector_search',
      }),
    };
    documentFirstExecutor = new DocumentFirstExecutor(
      vectorSearchService as any,
      webSearchServiceForDoc as any,
      { getConservativeResponse: () => 'Out of scope' } as any,
      { getDocumentClassificationAnswer: async () => '' } as any,
    );
    executor = new WebFirstExecutor(
      webSearchService,
      hybridRetrievalService,
      documentFirstExecutor,
    );

    const executeSpy = vi.spyOn(documentFirstExecutor, 'execute');
    const result = await executor.execute(node, {
      ...baseContext,
      isLegal: true,
    });

    expect(webSearchService.searchWithGrounding).not.toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalledWith(
      node,
      expect.objectContaining({ hybridOrigin: 'probe_redirect' }),
    );
    expect(result.trace?.executor).toBe('DocumentFirstExecutor');
    expect(result.trace?.sufficiency).toBe('YES');
  });

  it('skips document probe redirect when the user explicitly requests web search', async () => {
    hybridRetrievalService.retrieveRankedChunks.mockResolvedValue([
      { id: '1', content: 'strong', documentId: 'doc-1', similarity: 0.1 },
      { id: '2', content: 'also strong', documentId: 'doc-1', similarity: 0.2 },
    ]);

    const executeSpy = vi.spyOn(documentFirstExecutor, 'execute');
    const result = await executor.execute(
      {
        ...node,
        query:
          'web search about the latest judicial precedents regarding Section 148A(b)',
      },
      baseContext,
    );

    expect(webSearchService.searchWithGrounding).toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.trace?.executor).toBe('WebFirstExecutor');
  });
});
