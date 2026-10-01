import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentFirstExecutor } from '../../../services/executors/document.executor';
import { ExecutionNode } from '../../../types/execution.interface';

describe('DocumentFirstExecutor', () => {
  const node: ExecutionNode = {
    id: '1',
    capability: 'DOCUMENT_FIRST',
    query: 'What allegations are made in the notice?',
    dependencies: [],
  };

  const baseContext = {
    userId: 'user-1',
    webSearchEnabled: true,
    documentChats: [{ documentId: 'doc-1', Document: { originalName: 'notice.pdf' } }],
    caseName: 'Test Case',
    clientName: 'Test Client',
    caseId: 'case-1',
    clientId: 'client-1',
    history: [],
  };

  let vectorSearchService: any;
  let webSearchService: any;
  let conservativeResponseService: any;
  let metadataService: any;
  let executor: DocumentFirstExecutor;

  beforeEach(() => {
    vectorSearchService = {
      retrieveRankedChunks: vi.fn().mockResolvedValue([
        { id: 'chunk-1', content: 'Allegation details', documentId: 'doc-1' },
      ]),
      processVectorQuery: vi.fn().mockResolvedValue({
        answer: 'Vector answer',
        references: [],
        confidence: 0.8,
      }),
    };
    webSearchService = {
      checkSemanticSufficiency: vi.fn().mockResolvedValue({
        sufficiency: 'YES',
        reason: 'Sufficient evidence',
      }),
      generateHybridAnswer: vi.fn().mockResolvedValue({
        answer: 'Hybrid answer',
        source_info: 'vector_search + web_search',
      }),
      generateDocumentGroundedInsufficiencyAnswer: vi.fn().mockResolvedValue({
        answer: 'I could not find that in the uploaded document.',
        source_info: 'document_insufficient',
      }),
    };
    conservativeResponseService = {
      getConservativeResponse: vi.fn().mockReturnValue('Out of scope'),
    };
    metadataService = {
      getDocumentClassificationAnswer: vi.fn().mockResolvedValue(
        'Classification of all 2 document(s)',
      ),
    };
    executor = new DocumentFirstExecutor(
      vectorSearchService,
      webSearchService,
      conservativeResponseService,
      metadataService,
    );
  });

  it('uses metadata classification for classify-all-documents starter query', async () => {
    const classifyNode: ExecutionNode = {
      ...node,
      query: 'Classify each and every document.',
    };
    const documentChats = [
      { documentId: 'doc-1', Document: { originalName: 'notice.pdf' } },
      { documentId: 'doc-2', Document: { originalName: 'order.pdf' } },
    ];

    const result = await executor.execute(classifyNode, {
      ...baseContext,
      documentChats,
      caseId: 'case-1',
      clientId: 'client-1',
      webSearchEnabled: false,
    });

    expect(metadataService.getDocumentClassificationAnswer).toHaveBeenCalledWith(
      documentChats,
      undefined,
      undefined,
    );
    expect(vectorSearchService.retrieveRankedChunks).not.toHaveBeenCalled();
    expect(result.strategy).toBe('metadata');
    expect(result.trace?.finalStrategy).toBe('metadata');
    expect(result.references).toHaveLength(2);
  });

  it('retrieves chunks and evaluates sufficiency before answering', async () => {
    const result = await executor.execute(node, {
      ...baseContext,
      isLegal: true,
    });

    expect(vectorSearchService.retrieveRankedChunks).toHaveBeenCalled();
    expect(webSearchService.checkSemanticSufficiency).toHaveBeenCalledWith(
      expect.any(Array),
      node.query,
      { executor: 'DocumentFirstExecutor', capability: 'DOCUMENT_FIRST' },
    );
    expect(webSearchService.generateHybridAnswer).toHaveBeenCalled();
    expect(result.strategy).toBe('vector + web_search');
    expect(result.trace).toMatchObject({
      plannerDecision: 'DOCUMENT_FIRST',
      executor: 'DocumentFirstExecutor',
      sufficiency: 'YES',
      finalStrategy: 'vector + web_search',
    });
  });

  it('returns document-grounded insufficiency when web is disabled and retrieval is STRONG with NO sufficiency', async () => {
    webSearchService.checkSemanticSufficiency.mockResolvedValue({
      sufficiency: 'NO',
      reason: 'Insufficient',
    });
    vectorSearchService.retrieveRankedChunks.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Assessment order details only.',
        documentId: 'doc-1',
        similarity: 0.2,
      },
    ]);

    const result = await executor.execute(node, {
      ...baseContext,
      webSearchEnabled: false,
      isLegal: true,
    });

    expect(webSearchService.generateDocumentGroundedInsufficiencyAnswer).toHaveBeenCalled();
    expect(webSearchService.generateHybridAnswer).not.toHaveBeenCalled();
    expect(conservativeResponseService.getConservativeResponse).not.toHaveBeenCalled();
    expect(result.trace?.finalStrategy).toBe('document_insufficient');
  });

  it('returns conservative when documents are insufficient and web is not allowed', async () => {
    webSearchService.checkSemanticSufficiency.mockResolvedValue({
      sufficiency: 'NO',
      reason: 'Insufficient',
    });
    vectorSearchService.retrieveRankedChunks.mockResolvedValue([]);

    const result = await executor.execute(node, {
      ...baseContext,
      webSearchEnabled: false,
      isLegal: false,
    });

    expect(result.strategy).toBe('conservative');
    expect(conservativeResponseService.getConservativeResponse).toHaveBeenCalled();
    expect(result.trace?.finalStrategy).toBe('conservative');
  });

  it('returns document-grounded insufficiency when sufficiency is NO and retrieval is strong', async () => {
    webSearchService.checkSemanticSufficiency.mockResolvedValue({
      sufficiency: 'NO',
      reason: 'Insufficient',
    });
    vectorSearchService.retrieveRankedChunks.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Assessment order details only.',
        documentId: 'doc-1',
        similarity: 0.2,
      },
    ]);
    webSearchService.generateHybridAnswer.mockResolvedValue({
      answer: 'I found assessment records but no demand notice was present.',
      source_info: 'document_insufficient',
    });

    const result = await executor.execute(node, {
      ...baseContext,
      isLegal: true,
    });

    expect(result.strategy).toBe('vector');
    expect(result.trace?.finalStrategy).toBe('document_insufficient');
    expect(webSearchService.generateDocumentGroundedInsufficiencyAnswer).not.toHaveBeenCalled();
    expect(result.trace?.sufficiency).toBe('NO');
    expect(result.trace?.legalQuery).toBe(true);
  });

  it('uses web_search when sufficiency is NO, retrieval is weak, and query is legal', async () => {
    webSearchService.checkSemanticSufficiency.mockResolvedValue({
      sufficiency: 'NO',
      reason: 'Insufficient',
    });
    vectorSearchService.retrieveRankedChunks.mockResolvedValue([
      {
        id: 'chunk-1',
        content: 'Loosely related text.',
        documentId: 'doc-1',
        similarity: 0.9,
      },
    ]);
    webSearchService.generateHybridAnswer.mockResolvedValue({
      answer: 'Web answer',
      source_info: 'web_search_only',
    });

    const result = await executor.execute(node, {
      ...baseContext,
      isLegal: true,
    });

    expect(result.strategy).toBe('web_search');
    expect(webSearchService.generateDocumentGroundedInsufficiencyAnswer).not.toHaveBeenCalled();
    expect(result.trace?.sufficiency).toBe('NO');
    expect(result.trace?.legalQuery).toBe(true);
  });

  it('returns document-grounded insufficiency when document-scoped and sufficiency is NO', async () => {
    const documentScopedNode: ExecutionNode = {
      ...node,
      query: 'What is the demand notice in the document?',
    };
    webSearchService.checkSemanticSufficiency.mockResolvedValue({
      sufficiency: 'NO',
      reason: 'No demand notice found',
      missingInfo: 'demand notice',
    });

    const result = await executor.execute(documentScopedNode, {
      ...baseContext,
      isLegal: true,
    });

    expect(webSearchService.generateDocumentGroundedInsufficiencyAnswer).toHaveBeenCalled();
    expect(webSearchService.generateHybridAnswer).not.toHaveBeenCalled();
    expect(result.answer).toContain('uploaded document');
    expect(result.trace?.finalStrategy).toBe('document_insufficient');
  });

  it('skips document-scoped short-circuit when rewrite intent is accept_web_search_offer', async () => {
    const documentScopedNode: ExecutionNode = {
      ...node,
      query: 'Search outside the uploaded document for Section 80C',
    };
    webSearchService.checkSemanticSufficiency.mockResolvedValue({
      sufficiency: 'NO',
      reason: 'No Section 80C in documents',
    });
    webSearchService.generateHybridAnswer.mockResolvedValue({
      answer: 'Web answer about Section 80C',
      source_info: 'web_search_only',
    });

    const result = await executor.execute(documentScopedNode, {
      ...baseContext,
      isLegal: true,
      rewriteIntent: 'accept_web_search_offer',
    });

    expect(webSearchService.generateDocumentGroundedInsufficiencyAnswer).not.toHaveBeenCalled();
    expect(webSearchService.generateHybridAnswer).toHaveBeenCalledWith(
      documentScopedNode.query,
      expect.any(Array),
      'case-1',
      'client-1',
      'Test Case',
      'Test Client',
      undefined,
      true,
      baseContext.documentChats,
      expect.any(Object),
      { documentScoped: false },
    );
    expect(result.strategy).toBe('web_search');
  });

  it('passes documentScoped to hybrid answer when document-scoped and sufficiency is PARTIAL', async () => {
    const documentScopedNode: ExecutionNode = {
      ...node,
      query: 'What does the document say about penalties?',
    };
    webSearchService.checkSemanticSufficiency.mockResolvedValue({
      sufficiency: 'PARTIAL',
      reason: 'Partial coverage',
      missingInfo: 'penalty provisions',
    });

    await executor.execute(documentScopedNode, {
      ...baseContext,
      isLegal: true,
    });

    expect(webSearchService.generateHybridAnswer).toHaveBeenCalledWith(
      documentScopedNode.query,
      expect.any(Array),
      'case-1',
      'client-1',
      'Test Case',
      'Test Client',
      undefined,
      true,
      baseContext.documentChats,
      expect.objectContaining({ sufficiency: 'PARTIAL' }),
      { documentScoped: true },
    );
  });

  it('reuses preloaded chunks on vector-only path without second retrieval', async () => {
    const result = await executor.execute(node, {
      ...baseContext,
      webSearchEnabled: false,
      isLegal: false,
    });

    expect(vectorSearchService.retrieveRankedChunks).toHaveBeenCalledWith(
      node.query,
      ['doc-1'],
      undefined,
      expect.objectContaining({ executor: 'DocumentFirstExecutor' }),
    );
    expect(vectorSearchService.processVectorQuery).toHaveBeenCalledWith(
      node.query,
      ['doc-1'],
      baseContext.documentChats,
      undefined,
      expect.any(Function),
      undefined,
      expect.objectContaining({
        executor: 'DocumentFirstExecutor',
        preloadedChunks: expect.any(Array),
      }),
    );
    expect(result.strategy).toBe('vector');
  });
});
