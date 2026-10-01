import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';

const mockGenerateContent = vi.fn();

vi.mock('../../services/llm-gateway.service', () => ({
  getLlmGateway: () => ({
    generateContent: mockGenerateContent,
  }),
}));

import { WebSearchService } from '../../services/web-search.service';
import { webSearchConfig } from '../../services/web-search-config';

const passthroughWebSearchQueryOptimizer = {
  optimizeWebSearchQuery: vi.fn(async (query: string) => ({
    originalWebQuery: query,
    optimizedQuery: query,
    optimizationApplied: false,
  })),
};

describe('WebSearchService.checkSemanticSufficiency', () => {
  const promptTemplateService = {
    renderTemplate: vi.fn((_file: string, vars: Record<string, unknown>) =>
      JSON.stringify(vars),
    ),
  };
  const service = new WebSearchService(
    {} as any,
    {} as any,
    promptTemplateService as any,
    passthroughWebSearchQueryOptimizer as any,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns NO when no chunks are retrieved', async () => {
    const result = await service.checkSemanticSufficiency([], 'List all allegations');

    expect(result.sufficiency).toBe('NO');
  });

  it('does not force PARTIAL for enumeration queries with strong similarity', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        sufficiency: 'YES',
        reason: 'All allegations are listed in the chunks',
      }),
    });

    const chunks = [
      {
        content:
          'Allegation 1: breach of contract. Allegation 2: fraud. Allegation 3: negligence.',
        similarity: 0.2,
      },
    ];

    const result = await service.checkSemanticSufficiency(
      chunks,
      'List all allegations in the notice',
      { executor: 'DocumentFirstExecutor', capability: 'DOCUMENT_FIRST' },
    );

    expect(result.sufficiency).toBe('YES');
    expect(mockGenerateContent).toHaveBeenCalled();
    expect(promptTemplateService.renderTemplate).toHaveBeenCalledWith(
      'semantic-sufficiency-check.txt',
      expect.objectContaining({
        executorName: 'DocumentFirstExecutor',
        executorCapability: 'DOCUMENT_FIRST',
        queryRequirementHints: expect.stringContaining('enumerated'),
      }),
    );
  });

  it('uses completeness similarity threshold for step-by-step queries', async () => {
    const result = await service.checkSemanticSufficiency(
      [{ content: 'Some procedural text', similarity: 1.2 }],
      'What are the steps to file a claim?',
    );

    expect(result.sufficiency).toBe('NO');
    expect(result.reason).toBe(
      'Retrieved chunks did not satisfy semantic sufficiency requirements',
    );
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('uses normal similarity threshold for standard queries', async () => {
    const result = await service.checkSemanticSufficiency(
      [{ content: 'Some relevant text', similarity: 1.3 }],
      'What is the contract date?',
    );

    expect(result.sufficiency).toBe('NO');
    expect(result.reason).toBe(
      'Retrieved chunks did not satisfy semantic sufficiency requirements',
    );
  });

  it('upgrades vague PARTIAL to YES when similarity and chunk count are strong', async () => {
    const previousDebug = process.env.LOG_DEBUG;
    process.env.LOG_DEBUG = 'true';
    const logSpy = vi.spyOn(Logger.prototype, 'debug');
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        sufficiency: 'PARTIAL',
        reason: 'Chunks mention the notice but lack broader context',
        missing_information: 'additional context',
      }),
    });

    const chunks = [
      { content: 'Notice issued by ABC Corp on 12 Jan 2024.', similarity: 0.2 },
      { content: 'The assessing officer signed the notice.', similarity: 0.25 },
    ];

    const result = await service.checkSemanticSufficiency(
      chunks,
      'Who issued the notice?',
    );

    expect(result.sufficiency).toBe('YES');
    expect(result.reason).toContain('Guardrail upgrade');
    expect(
      logSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('SUFFICIENCY_GUARDRAIL') &&
          String(call[0]).includes('upgrade_partial_to_yes'),
      ),
    ).toBe(true);
    expect(
      logSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('[SUFFICIENCY]'),
      ),
    ).toBe(false);

    logSpy.mockRestore();
    process.env.LOG_DEBUG = previousDebug;
  });

  it('keeps concrete PARTIAL and logs sufficiency audit', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log');
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        sufficiency: 'PARTIAL',
        reason: 'Case facts are present but statutory definition is absent',
        missing_information: 'definition of Section 69C',
      }),
    });

    const chunks = [
      { content: 'Section 69C was invoked in this assessment.', similarity: 0.2 },
      { content: 'The addition relates to unexplained cash credits.', similarity: 0.3 },
    ];

    const result = await service.checkSemanticSufficiency(
      chunks,
      'What is Section 69C and how was it applied in this case?',
    );

    expect(result.sufficiency).toBe('PARTIAL');
    expect(result.missingInfo).toBe('definition of Section 69C');
    expect(
      logSpy.mock.calls.some((call) => {
        if (typeof call[0] !== 'string' || !call[0].includes('[SUFFICIENCY]')) {
          return false;
        }
        return (
          call[0].includes('result=PARTIAL') &&
          call[0].includes('chunkCount=2') &&
          call[0].includes('topSimilarity=')
        );
      }),
    ).toBe(true);

    logSpy.mockRestore();
  });

  it('logs sufficiency audit for NO results', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log');

    const result = await service.checkSemanticSufficiency(
      [],
      'What is the limitation period under Section 149?',
    );

    expect(result.sufficiency).toBe('NO');
    expect(
      logSpy.mock.calls.some((call) => {
        if (typeof call[0] !== 'string' || !call[0].includes('[SUFFICIENCY]')) {
          return false;
        }
        return (
          call[0].includes('result=NO') && call[0].includes('chunkCount=0')
        );
      }),
    ).toBe(true);

    logSpy.mockRestore();
  });

  it('uses 2000-char preview when top similarity is at or above extended-preview threshold', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        sufficiency: 'YES',
        reason: 'Revenue figure is present in the chunk',
      }),
    });

    const padding = 'x'.repeat(900);
    const revenueTail = 'Total Revenue from operations | 1D | 37054058';
    const chunks = [{ content: `${padding}${revenueTail}`, similarity: 0.2 }];

    await service.checkSemanticSufficiency(
      chunks,
      'What was the total business revenue reported?',
    );

    const renderCall = promptTemplateService.renderTemplate.mock.calls[0];
    const vars = renderCall?.[1] as { retrievedChunksText?: string };
    expect(vars.retrievedChunksText).toContain(revenueTail);
    expect(vars.retrievedChunksText).not.toContain('...');
  });

  it('uses 800-char preview when top similarity is below extended-preview threshold', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        sufficiency: 'YES',
        reason: 'Enough context in preview',
      }),
    });

    const padding = 'y'.repeat(900);
    const hiddenTail = 'Total Revenue from operations | 1D | 37054058';
    const chunks = [{ content: `${padding}${hiddenTail}`, similarity: 0.75 }];

    await service.checkSemanticSufficiency(
      chunks,
      'What was the total business revenue reported?',
    );

    const renderCall = promptTemplateService.renderTemplate.mock.calls[0];
    const vars = renderCall?.[1] as { retrievedChunksText?: string };
    expect(vars.retrievedChunksText).not.toContain(hiddenTail);
    expect(vars.retrievedChunksText).toContain('...');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('reruns sufficiency with full top chunks when initial NO passed similarity gate', async () => {
    const previousDebug = process.env.LOG_DEBUG;
    process.env.LOG_DEBUG = 'true';
    const logSpy = vi.spyOn(Logger.prototype, 'debug');
    mockGenerateContent
      .mockResolvedValueOnce({
        text: JSON.stringify({
          sufficiency: 'NO',
          reason: 'Figures cut off in preview',
          missing_information: 'total business revenue amount',
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          sufficiency: 'YES',
          reason: 'Full chunk contains total revenue from operations',
        }),
      });

    const padding = 'z'.repeat(2100);
    const revenueTail = 'Total Revenue from operations | 1D | 37054058';
    const chunks = [{ content: `${padding}${revenueTail}`, similarity: 0.2 }];

    const result = await service.checkSemanticSufficiency(
      chunks,
      'What was the total business revenue reported?',
    );

    expect(result.sufficiency).toBe('YES');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);

    const recheckRenderCall = promptTemplateService.renderTemplate.mock.calls[1];
    const recheckVars = recheckRenderCall?.[1] as {
      retrievedChunksCount?: number;
      retrievedChunksText?: string;
    };
    expect(recheckVars.retrievedChunksCount).toBe(1);
    expect(recheckVars.retrievedChunksText).toContain(revenueTail);
    expect(recheckVars.retrievedChunksText).not.toContain('...');

    expect(
      logSpy.mock.calls.some((call) => {
        const message = String(call[0] ?? '');
        return (
          message.includes('SUFFICIENCY_GUARDRAIL') &&
          message.includes('full_chunk_recheck') &&
          message.includes('originalSufficiency=NO') &&
          message.includes('newSufficiency=YES')
        );
      }),
    ).toBe(true);

    logSpy.mockRestore();
    process.env.LOG_DEBUG = previousDebug;
  });

  it('keeps NO when full-chunk recheck also returns NO', async () => {
    const previousDebug = process.env.LOG_DEBUG;
    process.env.LOG_DEBUG = 'true';
    const logSpy = vi.spyOn(Logger.prototype, 'debug');
    mockGenerateContent
      .mockResolvedValueOnce({
        text: JSON.stringify({
          sufficiency: 'NO',
          reason: 'No revenue in preview',
          missing_information: 'total business revenue amount',
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          sufficiency: 'NO',
          reason: 'Revenue not in full chunk either',
          missing_information: 'total business revenue amount',
        }),
      });

    const chunks = [
      { content: 'Balance sheet only with no P&L figures.', similarity: 0.2 },
    ];

    const result = await service.checkSemanticSufficiency(
      chunks,
      'What was the total business revenue reported?',
    );

    expect(result.sufficiency).toBe('NO');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(
      logSpy.mock.calls.some((call) => {
        const message = String(call[0] ?? '');
        return (
          message.includes('SUFFICIENCY_GUARDRAIL') &&
          message.includes('full_chunk_recheck') &&
          message.includes('newSufficiency=NO')
        );
      }),
    ).toBe(true);

    logSpy.mockRestore();
    process.env.LOG_DEBUG = previousDebug;
  });

  it('rechecks moderate-similarity FACT_LOOKUP NO and upgrades when full chunk has the date', async () => {
    const previousDebug = process.env.LOG_DEBUG;
    process.env.LOG_DEBUG = 'true';
    const logSpy = vi.spyOn(Logger.prototype, 'debug');
    mockGenerateContent
      .mockResolvedValueOnce({
        text: JSON.stringify({
          sufficiency: 'NO',
          reason: 'Date not visible in preview',
          missing_information: 'The date the audit report was furnished.',
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          sufficiency: 'YES',
          reason: 'Audit report furnished date is stated in the full chunk',
        }),
      });

    const padding = 'a'.repeat(2100);
    const dateTail = 'Date of furnishing audit report: 28-09-2018';
    const chunks = [{ content: `${padding}${dateTail}`, similarity: 0.624 }];

    const result = await service.checkSemanticSufficiency(
      chunks,
      'What was the date the audit report was furnished?',
    );

    expect(result.sufficiency).toBe('YES');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(
      logSpy.mock.calls.some((call) => {
        const message = String(call[0] ?? '');
        return (
          message.includes('SUFFICIENCY_GUARDRAIL') &&
          message.includes('full_chunk_recheck') &&
          message.includes('topSimilarity=')
        );
      }),
    ).toBe(true);

    logSpy.mockRestore();
    process.env.LOG_DEBUG = previousDebug;
  });

  it('does not rerun full-chunk recheck when similarity fails the early gate', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        sufficiency: 'NO',
        reason: 'Insufficient preview',
        missing_information: 'total business revenue amount',
      }),
    });

    const chunks = [{ content: 'Some unrelated content.', similarity: 1.3 }];

    const result = await service.checkSemanticSufficiency(
      chunks,
      'What was the total business revenue reported?',
    );

    expect(result.sufficiency).toBe('NO');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});

describe('WebSearchService.hasContextualReferences', () => {
  const promptTemplateService = {
    renderTemplate: vi.fn((_file: string, vars: Record<string, unknown>) =>
      JSON.stringify(vars),
    ),
  };
  const service = new WebSearchService(
    {} as any,
    {} as any,
    promptTemplateService as any,
    passthroughWebSearchQueryOptimizer as any,
  );

  const hasRefs = (query: string) =>
    (service as any).hasContextualReferences(query) as boolean;

  it('(a) does not match a self-contained payments/inquiry query', () => {
    const query =
      "Identify if the payments received into the credit card account align with the income sources or unexplained cash deposits identified in the department's inquiry.";

    expect(hasRefs(query)).toBe(false);
  });

  it('(c) does not match incidental "this" without a real conversational reference', () => {
    const query =
      'What happens if this notice is not responded to within 30 days?';

    expect(hasRefs(query)).toBe(false);
  });

  it('(b) matches genuine ordinal and follow-up reference queries', () => {
    expect(hasRefs('Tell me more about the 4th point')).toBe(true);
  });
});

describe('WebSearchService.resolveContextualReferences', () => {
  const promptTemplateService = {
    renderTemplate: vi.fn((_file: string, vars: Record<string, unknown>) =>
      `PROMPT:${JSON.stringify(vars)}`,
    ),
  };
  const service = new WebSearchService(
    {} as any,
    {} as any,
    promptTemplateService as any,
    passthroughWebSearchQueryOptimizer as any,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(b) resolves a genuine 4th-point reference using chat history', async () => {
    const chatHistory = `Assistant: Here are your options:
1. Filing complaint
2. Ombudsman
3. Mediation
4. Filing writ of mandamus petition`;

    mockGenerateContent.mockResolvedValue({
      text: 'Tell me more about filing writ of mandamus petition',
    });

    const resolved = await (service as any).resolveContextualReferences(
      'Tell me more about the 4th point',
      chatHistory,
      'searchWithGrounding',
    );

    expect(resolved).toBe(
      'Tell me more about filing writ of mandamus petition',
    );
    expect(promptTemplateService.renderTemplate).toHaveBeenCalledWith(
      'context-resolution.txt',
      expect.objectContaining({
        query: 'Tell me more about the 4th point',
        chatHistory,
      }),
    );
    expect(mockGenerateContent).toHaveBeenCalled();
  });

  it('(a) returns query unchanged when LLM applies Step 0 self-containment', async () => {
    const query =
      "Identify if the payments received into the credit card account align with the income sources or unexplained cash deposits identified in the department's inquiry.";

    mockGenerateContent.mockResolvedValue({ text: query });

    const resolved = await (service as any).resolveContextualReferences(
      query,
      'Assistant: prior discussion about credit cards',
      'generateHybridAnswer',
    );

    expect(resolved).toBe(query);
  });

  it('returns query unchanged when regex matches but Step 0 finds no genuine reference in history', async () => {
    // Matches "I want/choose + number" pattern, but "3rd method" is a statutory
    // self-contained phrase — not an ordinal pointing at a prior assistant list.
    const query =
      'I want the 3rd method of depreciation under section 32 of the Income Tax Act.';

    expect((service as any).hasContextualReferences(query)).toBe(true);

    const chatHistory =
      'User: What is the applicable tax rate for AY 2024-25?\n' +
      'Assistant: The basic exemption limit and slab rates depend on the regime chosen.';

    mockGenerateContent.mockResolvedValue({ text: query });

    const resolved = await (service as any).resolveContextualReferences(
      query,
      chatHistory,
      'generateHybridAnswer',
    );

    expect(resolved).toBe(query);
    expect(promptTemplateService.renderTemplate).toHaveBeenCalledWith(
      'context-resolution.txt',
      expect.objectContaining({ query, chatHistory }),
    );
    expect(mockGenerateContent).toHaveBeenCalled();
  });
});

describe('WebSearchService.generateHybridAnswer PARTIAL branch', () => {
  const promptBuilderService = {
    buildPrompt: vi.fn().mockResolvedValue('vector-prompt'),
  };
  const promptTemplateService = {
    renderTemplate: vi.fn((_file: string, vars: Record<string, unknown>) =>
      JSON.stringify(vars),
    ),
  };
  const service = new WebSearchService(
    promptBuilderService as any,
    {} as any,
    promptTemplateService as any,
    passthroughWebSearchQueryOptimizer as any,
  );

  const documentChats = [
    {
      documentId: 'doc-1',
      Document: { originalName: 'contract.pdf' },
    },
  ];

  const chunks = [
    {
      id: 'chunk-1',
      content: 'The notice period is 30 days.',
      documentId: 'doc-1',
      similarity: 0.4,
    },
  ];

  const partialSufficiency = {
    sufficiency: 'PARTIAL' as const,
    reason: 'Documents cover notice period but not penalties',
    missingInfo: 'penalty provisions',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(service, 'searchWithGrounding').mockResolvedValue(
      'Web penalty info [Source: example.com]',
    );
    vi.spyOn(service as any, 'removeCitations').mockImplementation(
      (text: string) => text.replace(/\[Source:[^\]]+\]/gi, '').trim(),
    );
  });

  it('returns vector_search + web_search without a vector-answer LLM call', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Combined answer [Source: Chunk 1] with doc [Source: contract.pdf]',
    });

    const result = await service.generateHybridAnswer(
      'What is the notice period and penalty?',
      chunks,
      'case-1',
      'client-1',
      'Case A',
      'Client B',
      undefined,
      true,
      documentChats,
      partialSufficiency,
    );

    expect(result.source_info).toBe('vector_search + web_search');
    expect(promptBuilderService.buildPrompt).not.toHaveBeenCalled();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(service.searchWithGrounding).toHaveBeenCalledWith(
      'What is the notice period and penalty?',
      'Case A',
      'Client B',
      'penalty provisions',
      undefined,
      { documentScoped: false, triggerReason: 'PARTIAL' },
    );
  });

  it('passes chunk citations and cleaned web text into synthesis', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'Synthesized answer' });

    await service.generateHybridAnswer(
      'What is the notice period and penalty?',
      chunks,
      'case-1',
      'client-1',
      undefined,
      undefined,
      undefined,
      true,
      documentChats,
      partialSufficiency,
    );

    expect(promptTemplateService.renderTemplate).toHaveBeenCalledWith(
      'hybrid-synthesis.txt',
      expect.objectContaining({
        query: 'What is the notice period and penalty?',
        documentChunksText: expect.stringContaining('[Source: contract.pdf]'),
        webSearchResults: 'Web penalty info',
      }),
    );
  });

  it('cleans chunk-number citations from the synthesized answer', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Answer [Source: Chunk 1]\n\nDocument Sources: [Chunk 1, 2]',
    });

    const result = await service.generateHybridAnswer(
      'What is the notice period and penalty?',
      chunks,
      'case-1',
      'client-1',
      undefined,
      undefined,
      undefined,
      true,
      documentChats,
      partialSufficiency,
    );

    expect(result.answer).toBe('Answer');
    expect(result.answer).not.toMatch(/Chunk\s+\d+/i);
  });

  it('falls back to web result text when synthesis returns empty', async () => {
    mockGenerateContent.mockResolvedValue({ text: '' });

    const result = await service.generateHybridAnswer(
      'What is the notice period and penalty?',
      chunks,
      'case-1',
      'client-1',
      undefined,
      undefined,
      undefined,
      true,
      documentChats,
      partialSufficiency,
    );

    expect(result.answer).toBe('Web penalty info [Source: example.com]');
    expect(result.source_info).toBe('vector_search + web_search');
  });
});

describe('WebSearchService.generateHybridAnswer NO branch', () => {
  const promptBuilderService = {
    buildPrompt: vi.fn().mockResolvedValue('vector-prompt'),
  };
  const promptTemplateService = {
    renderTemplate: vi.fn((_file: string, vars: Record<string, unknown>) =>
      JSON.stringify(vars),
    ),
  };
  const service = new WebSearchService(
    promptBuilderService as any,
    {} as any,
    promptTemplateService as any,
    passthroughWebSearchQueryOptimizer as any,
  );

  const documentChats = [
    {
      documentId: 'doc-1',
      Document: { originalName: 'notice.pdf' },
    },
  ];

  const chunks = [
    {
      id: 'chunk-1',
      content: 'Assessment order details only.',
      documentId: 'doc-1',
      similarity: 0.2,
    },
  ];

  const noSufficiency = {
    sufficiency: 'NO' as const,
    reason: 'Chunks are not relevant',
    missingInfo: 'demand notice issuance procedure',
  };

  const originalGroundingOptions = {
    useOriginalQueryOnly: true,
    skipContextualResolution: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(service, 'searchWithGrounding').mockResolvedValue('Web answer');
    vi.spyOn(service, 'generateDocumentGroundedInsufficiencyAnswer').mockResolvedValue({
      answer: 'I could not find that in the uploaded document.',
      source_info: 'document_insufficient',
    });
    vi.spyOn(service as any, 'removeCitations').mockImplementation(
      (text: string) => text,
    );
    mockGenerateContent.mockResolvedValue({ text: 'Vector answer' });
  });

  it('uses web search when sufficiency is NO and retrieval is NONE', async () => {
    const noneChunks = [
      {
        id: 'chunk-1',
        content: 'Unrelated GST appeal text.',
        documentId: 'doc-1',
        similarity: 1.3,
      },
    ];

    const result = await service.generateHybridAnswer(
      'What is GST registration?',
      noneChunks,
      'case-1',
      'client-1',
      'Case A',
      'Client B',
      undefined,
      true,
      documentChats,
      noSufficiency,
    );

    expect(result.source_info).toBe('web_search_only');
    expect(service.searchWithGrounding).toHaveBeenCalled();
    expect(service.generateDocumentGroundedInsufficiencyAnswer).not.toHaveBeenCalled();
  });

  it('uses web search when retrieval is NONE even if sufficiency is YES', async () => {
    const noneChunks = [
      {
        id: 'chunk-1',
        content: 'Unrelated GST appeal text.',
        documentId: 'doc-1',
        similarity: 1.3,
      },
    ];

    const result = await service.generateHybridAnswer(
      'What is Section 80C?',
      noneChunks,
      'case-1',
      'client-1',
      'Case A',
      'Client B',
      undefined,
      true,
      documentChats,
      {
        sufficiency: 'YES',
        reason: 'LLM judged sufficient',
      },
    );

    expect(result.source_info).toBe('web_search_only');
    expect(service.searchWithGrounding).toHaveBeenCalled();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('returns honest no-topic message when retrieval is NONE, sufficiency is YES, and web is disabled', async () => {
    const noneChunks = [
      {
        id: 'chunk-1',
        content: 'Unrelated GST appeal text.',
        documentId: 'doc-1',
        similarity: 1.3,
      },
    ];

    const result = await service.generateHybridAnswer(
      'What is Section 80C?',
      noneChunks,
      'case-1',
      'client-1',
      'Case A',
      'Client B',
      undefined,
      false,
      documentChats,
      {
        sufficiency: 'YES',
        reason: 'LLM judged sufficient',
      },
    );

    expect(result.source_info).toBe('no_results');
    expect(result.answer).toContain('do not appear to cover this topic');
    expect(result.answer).toContain('web search is currently disabled');
    expect(service.searchWithGrounding).not.toHaveBeenCalled();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('uses original query only for web grounding when sufficiency is NO and retrieval is weak', async () => {
    const weakChunks = [
      {
        id: 'chunk-1',
        content: 'Unrelated procedural text.',
        documentId: 'doc-1',
        similarity: 0.9,
      },
    ];

    const result = await service.generateHybridAnswer(
      'What is a demand notice?',
      weakChunks,
      'case-1',
      'client-1',
      'Case A',
      'Client B',
      undefined,
      true,
      documentChats,
      noSufficiency,
    );

    expect(result.source_info).toBe('web_search_only');
    expect(service.searchWithGrounding).toHaveBeenCalledWith(
      'What is a demand notice?',
      'Case A',
      'Client B',
      undefined,
      undefined,
      {
        ...originalGroundingOptions,
        triggerReason: 'NO',
      },
    );
    expect(service.generateDocumentGroundedInsufficiencyAnswer).not.toHaveBeenCalled();
  });

  it('returns document insufficiency when sufficiency is NO but retrieval is strong', async () => {
    const result = await service.generateHybridAnswer(
      'What is a demand notice?',
      chunks,
      'case-1',
      'client-1',
      'Case A',
      'Client B',
      undefined,
      true,
      documentChats,
      noSufficiency,
    );

    expect(result.source_info).toBe('document_insufficient');
    expect(service.generateDocumentGroundedInsufficiencyAnswer).toHaveBeenCalledWith(
      'What is a demand notice?',
      expect.any(Array),
      {
        reason: noSufficiency.reason,
        missingInfo: noSufficiency.missingInfo,
      },
      documentChats,
      undefined,
    );
    expect(service.searchWithGrounding).not.toHaveBeenCalled();
  });

  it('uses web search when user explicitly requests web search despite strong retrieval', async () => {
    const result = await service.generateHybridAnswer(
      'web search about the latest judicial precedents regarding Section 148A(b)',
      chunks,
      'case-1',
      'client-1',
      'Case A',
      'Client B',
      undefined,
      true,
      documentChats,
      noSufficiency,
    );

    expect(result.source_info).toBe('web_search_only');
    expect(service.searchWithGrounding).toHaveBeenCalled();
    expect(service.generateDocumentGroundedInsufficiencyAnswer).not.toHaveBeenCalled();
  });

  it('returns document insufficiency without web search when sufficiency is NO and document-scoped', async () => {
    const result = await service.generateHybridAnswer(
      'What is the demand notice in the document?',
      chunks,
      'case-1',
      'client-1',
      'Case A',
      'Client B',
      undefined,
      true,
      documentChats,
      noSufficiency,
      { documentScoped: true },
    );

    expect(result.source_info).toBe('document_insufficient');
    expect(service.generateDocumentGroundedInsufficiencyAnswer).toHaveBeenCalledWith(
      'What is the demand notice in the document?',
      expect.any(Array),
      {
        reason: noSufficiency.reason,
        missingInfo: noSufficiency.missingInfo,
      },
      documentChats,
      undefined,
    );
    expect(service.searchWithGrounding).not.toHaveBeenCalled();
  });
});

describe('WebSearchService web search query construction', () => {
  const promptTemplateService = {
    renderTemplate: vi.fn((_file: string, vars: Record<string, unknown>) =>
      JSON.stringify(vars),
    ),
  };
  const service = new WebSearchService(
    {} as any,
    {} as any,
    promptTemplateService as any,
    passthroughWebSearchQueryOptimizer as any,
  );
  const originalCacheEnabled = webSearchConfig.cache_enabled;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContent.mockResolvedValue({ text: 'Web result' });
    webSearchConfig.enabled = true;
    webSearchConfig.cache_enabled = false;
  });

  afterEach(() => {
    webSearchConfig.cache_enabled = originalCacheEnabled;
  });

  const getGroundingVars = (): Record<string, string> => {
    const call = promptTemplateService.renderTemplate.mock.calls.find(
      (entry) => entry[0] === 'web-search-grounding.txt',
    );
    return (call?.[1] ?? {}) as Record<string, string>;
  };

  it('strips instruction framing into a search-shaped enhanced query for document-scoped paths', async () => {
    await service.searchWithGrounding(
      'Draft a writ petition for Vastimal Deepchand Jain against the Deputy Commissioner of Income Tax based on the case documents and facts provided for Assessment Year 2018-19.',
      'Vastimal Jain',
      'Visaj Extraction Test',
      'legal grounds for assessment order dated 09.03.2021',
      undefined,
      { documentScoped: true },
    );

    const { enhancedQuery, missingInformationLine } = getGroundingVars();
    expect(enhancedQuery).toContain(
      'writ petition against the Deputy Commissioner of Income Tax Assessment Year 2018-19',
    );
    expect(enhancedQuery).toContain(
      'Specifically need information about: legal grounds for assessment order dated 09.03.2021',
    );
    expect(enhancedQuery).toContain('Legal query for case Vastimal Jain, client Visaj Extraction Test:');
    expect(enhancedQuery).not.toMatch(/Draft a/i);
    expect(enhancedQuery).not.toContain('Vastimal Deepchand Jain');
    expect(missingInformationLine).toContain('legal grounds for assessment order');
  });

  it('drops vague missingInfo from the enhanced query and grounding prompt', async () => {
    await service.searchWithGrounding(
      'Draft a writ petition against the Deputy Commissioner for Assessment Year 2018-19.',
      'Case A',
      'Client B',
      'more detail about the assessment',
    );

    const { enhancedQuery, missingInformationLine } = getGroundingVars();
    expect(enhancedQuery).not.toContain('Specifically need information about:');
    expect(missingInformationLine).toBe('');
  });

  it('applies search-intent optimization before web grounding on non-document-scoped paths', async () => {
    const optimizingService = new WebSearchService(
      {} as any,
      {} as any,
      promptTemplateService as any,
      {
        optimizeWebSearchQuery: vi.fn(async (query: string) => ({
          originalWebQuery: query,
          optimizedQuery: 'What is an income tax demand notice?',
          optimizationApplied: true,
        })),
      } as any,
    );

    mockGenerateContent.mockResolvedValue({ text: 'Web result' });
    webSearchConfig.enabled = true;
    webSearchConfig.cache_enabled = false;

    await optimizingService.searchWithGrounding(
      'What is demand notice?',
      'Case A',
      'Client B',
      undefined,
      undefined,
      {
        useOriginalQueryOnly: true,
        skipContextualResolution: true,
      },
    );

    const call = promptTemplateService.renderTemplate.mock.calls.find(
      (entry) => entry[0] === 'web-search-grounding.txt',
    );
    const { enhancedQuery } = (call?.[1] ?? {}) as Record<string, string>;
    expect(enhancedQuery).toBe('What is an income tax demand notice?');
  });

  it('truncates long case and client names in the legal query prefix', async () => {
    const longCaseName = `Case ${'X'.repeat(80)}`;
    const longClientName = `Client ${'Y'.repeat(80)}`;

    await service.searchWithGrounding(
      'Section 148 notice validity Assessment Year 2018-19',
      longCaseName,
      longClientName,
      undefined,
      undefined,
      { documentScoped: true },
    );

    const { enhancedQuery } = getGroundingVars();
    const prefix = enhancedQuery.split(':')[0];
    expect(prefix.length).toBeLessThanOrEqual(
      'Legal query for case '.length + 60 + ', client '.length + 60,
    );
    expect(enhancedQuery).toContain('…');
  });
});
