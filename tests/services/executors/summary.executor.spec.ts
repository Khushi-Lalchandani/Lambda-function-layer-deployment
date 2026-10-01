import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummaryExecutor } from '../../../services/executors/summary.executor';
import { ExecutionContext, ExecutionNode } from '../../../types/execution.interface';

describe('SummaryExecutor', () => {
  const metadataService = {
    getMetadataSearchAnswer: vi.fn(),
  };
  const vectorSearchService = {
    retrieveRankedChunks: vi.fn(),
    processVectorQuery: vi.fn(),
  };
  const webSearchService = {
    checkSemanticSufficiency: vi.fn(),
  };
  const executor = new SummaryExecutor(
    metadataService as any,
    vectorSearchService as any,
    webSearchService as any,
  );

  const baseContext: ExecutionContext = {
    userId: 'user-1',
    caseId: 'case-1',
    clientId: 'client-1',
    history: [],
    webSearchEnabled: true,
    documentChats: [
      {
        documentId: 'doc-1',
        Document: {
          originalName: 'notice.pdf',
          documentMetaData: [{ summary: 'Pre-generated case summary text.' }],
        },
      },
    ],
  };

  const node: ExecutionNode = {
    id: '1',
    capability: 'CASE_SUMMARY',
    query: 'Summarize this case',
    dependencies: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    metadataService.getMetadataSearchAnswer.mockResolvedValue(
      'Metadata summary answer',
    );
    vectorSearchService.retrieveRankedChunks.mockResolvedValue([
      { id: 'chunk-1', content: 'Detailed case content', documentId: 'doc-1' },
    ]);
    vectorSearchService.processVectorQuery.mockResolvedValue({
      answer: 'Vector summary answer',
      references: [],
      confidence: 0.9,
    });
    webSearchService.checkSemanticSufficiency.mockResolvedValue({
      sufficiency: 'YES',
      reason: 'Sufficient evidence',
    });
  });

  it('uses metadata path for generic summary when metadata summary exists', async () => {
    const result = await executor.execute(node, baseContext);

    expect(metadataService.getMetadataSearchAnswer).toHaveBeenCalledWith(
      'Summarize this case',
      'case-1',
      'client-1',
      baseContext.documentChats,
      undefined,
      'analytical',
      undefined,
      undefined,
    );
    expect(vectorSearchService.retrieveRankedChunks).not.toHaveBeenCalled();
    expect(webSearchService.checkSemanticSufficiency).not.toHaveBeenCalled();
    expect(vectorSearchService.processVectorQuery).not.toHaveBeenCalled();
    expect(result.strategy).toBe('metadata');
    expect(result.answer).toBe('Metadata summary answer');
  });

  it('uses vector path for detailed summary queries', async () => {
    const detailedNode: ExecutionNode = {
      ...node,
      query: 'Summarize allegations in detail',
    };

    const result = await executor.execute(detailedNode, baseContext);

    expect(vectorSearchService.retrieveRankedChunks).toHaveBeenCalled();
    expect(webSearchService.checkSemanticSufficiency).toHaveBeenCalledWith(
      expect.any(Array),
      detailedNode.query,
      { executor: 'SummaryExecutor', capability: 'CASE_SUMMARY' },
    );
    expect(vectorSearchService.processVectorQuery).toHaveBeenCalled();
    expect(metadataService.getMetadataSearchAnswer).not.toHaveBeenCalled();
    expect(result.strategy).toBe('vector');
    expect(result.answer).toBe('Vector summary answer');
    expect(result.trace).toMatchObject({
      plannerDecision: 'CASE_SUMMARY',
      executor: 'SummaryExecutor',
      sufficiency: 'YES',
      finalStrategy: 'vector',
    });
  });

  it('evaluates sufficiency on vector fallback when metadata summary is missing', async () => {
    const contextWithoutMetadata: ExecutionContext = {
      ...baseContext,
      documentChats: [
        {
          documentId: 'doc-1',
          Document: { originalName: 'notice.pdf', documentMetaData: [] },
        },
      ],
    };

    const result = await executor.execute(node, contextWithoutMetadata);

    expect(metadataService.getMetadataSearchAnswer).not.toHaveBeenCalled();
    expect(vectorSearchService.retrieveRankedChunks).toHaveBeenCalled();
    expect(webSearchService.checkSemanticSufficiency).toHaveBeenCalledWith(
      expect.any(Array),
      node.query,
      { executor: 'SummaryExecutor', capability: 'CASE_SUMMARY' },
    );
    expect(result.strategy).toBe('vector');
    expect(result.trace?.sufficiency).toBe('YES');
  });
});
