import { describe, it, expect } from 'vitest';
import {
  classifyRetrievalStrength,
  isGeneralKnowledgeScenarioAllowed,
  normalizeChunkSimilarity,
  resolveHybridAnswerRoute,
  resolveNoSufficiencyFallback,
} from '../../services/retrieval-strength';

describe('retrieval-strength', () => {
  it('normalizes raw vector distance to a 0-1 relevance score', () => {
    expect(normalizeChunkSimilarity(0.2)).toBeCloseTo(0.9);
    expect(normalizeChunkSimilarity(1.3)).toBeCloseTo(0.35);
  });

  it('classifies empty retrieval as NONE', () => {
    expect(classifyRetrievalStrength([])).toMatchObject({
      strength: 'NONE',
      chunkCount: 0,
      maxSimilarity: 0,
    });
  });

  it('classifies low-similarity chunks as NONE', () => {
    const metrics = classifyRetrievalStrength([
      { similarity: 1.3 },
      { similarity: 1.4 },
    ]);

    expect(metrics.strength).toBe('NONE');
    expect(metrics.maxSimilarity).toBeLessThan(0.4);
  });

  it('classifies moderate-similarity chunks as WEAK', () => {
    const metrics = classifyRetrievalStrength([
      { similarity: 0.9 },
      { similarity: 1.0 },
    ]);

    expect(metrics.strength).toBe('WEAK');
    expect(metrics.maxSimilarity).toBeGreaterThanOrEqual(0.4);
    expect(metrics.maxSimilarity).toBeLessThan(0.6);
  });

  it('classifies high-similarity chunks as STRONG', () => {
    const metrics = classifyRetrievalStrength([
      { similarity: 0.2 },
      { similarity: 0.5 },
    ]);

    expect(metrics.strength).toBe('STRONG');
    expect(metrics.maxSimilarity).toBeGreaterThanOrEqual(0.6);
    expect(metrics.relevantChunkCount).toBeGreaterThanOrEqual(1);
  });

  it('disallows Scenario C when retrieval strength is NONE', () => {
    expect(isGeneralKnowledgeScenarioAllowed([])).toBe(false);
    expect(isGeneralKnowledgeScenarioAllowed([{ similarity: 1.3 }])).toBe(
      false,
    );
    expect(isGeneralKnowledgeScenarioAllowed([{ similarity: 0.2 }])).toBe(true);
  });
});

describe('resolveHybridAnswerRoute', () => {
  const base = { documentScoped: false, webSearchEnabled: true };

  it('routes NONE retrieval to web regardless of sufficiency', () => {
    expect(
      resolveHybridAnswerRoute('NONE', 'YES', base),
    ).toBe('web_search_only');
    expect(
      resolveHybridAnswerRoute('NONE', 'PARTIAL', base),
    ).toBe('web_search_only');
    expect(resolveHybridAnswerRoute('NONE', 'NO', base)).toBe('web_search_only');
  });

  it('routes WEAK retrieval by sufficiency', () => {
    expect(resolveHybridAnswerRoute('WEAK', 'NO', base)).toBe('web_search_only');
    expect(resolveHybridAnswerRoute('WEAK', 'PARTIAL', base)).toBe('hybrid');
    expect(resolveHybridAnswerRoute('WEAK', 'YES', base)).toBe('document_answer');
  });

  it('routes STRONG retrieval: NO to document insufficiency, never web', () => {
    expect(
      resolveHybridAnswerRoute('STRONG', 'NO', base),
    ).toBe('document_insufficient');
    expect(resolveHybridAnswerRoute('STRONG', 'PARTIAL', base)).toBe('hybrid');
    expect(resolveHybridAnswerRoute('STRONG', 'YES', base)).toBe('document_answer');
    expect(resolveHybridAnswerRoute('STRONG', 'NO', base)).not.toBe('web_search_only');
  });

  it('routes document-scoped NO to document insufficiency regardless of strength', () => {
    expect(
      resolveHybridAnswerRoute('STRONG', 'NO', {
        documentScoped: true,
        webSearchEnabled: true,
      }),
    ).toBe('document_insufficient');
    expect(
      resolveHybridAnswerRoute('NONE', 'NO', {
        documentScoped: true,
        webSearchEnabled: true,
      }),
    ).toBe('document_insufficient');
  });

  it('routes explicit web search to web even when retrieval is strong', () => {
    expect(
      resolveHybridAnswerRoute('STRONG', 'YES', {
        ...base,
        explicitWebSearch: true,
      }),
    ).toBe('web_search_only');
  });

  it('falls back to no_topic_coverage when web is disabled for NONE', () => {
    expect(
      resolveHybridAnswerRoute('NONE', 'YES', {
        documentScoped: false,
        webSearchEnabled: false,
      }),
    ).toBe('no_topic_coverage');
    expect(
      resolveHybridAnswerRoute('NONE', 'NO', {
        documentScoped: false,
        webSearchEnabled: false,
      }),
    ).toBe('no_topic_coverage');
  });

  it('falls back to vector when web is disabled for WEAK NO', () => {
    expect(
      resolveHybridAnswerRoute('NONE', 'YES', {
        documentScoped: false,
        webSearchEnabled: false,
      }),
    ).toBe('no_topic_coverage');
    expect(
      resolveHybridAnswerRoute('WEAK', 'NO', {
        documentScoped: false,
        webSearchEnabled: false,
      }),
    ).toBe('vector_search_only');
  });
});

describe('resolveNoSufficiencyFallback', () => {
  it('routes document-scoped NO to document insufficiency regardless of retrieval strength', () => {
    expect(
      resolveNoSufficiencyFallback('STRONG', {
        documentScoped: true,
        webSearchEnabled: true,
      }),
    ).toBe('document_insufficient');
    expect(
      resolveNoSufficiencyFallback('NONE', {
        documentScoped: true,
        webSearchEnabled: true,
      }),
    ).toBe('document_insufficient');
  });

  it('routes STRONG non-scoped NO to document insufficiency', () => {
    expect(
      resolveNoSufficiencyFallback('STRONG', {
        documentScoped: false,
        webSearchEnabled: true,
      }),
    ).toBe('document_insufficient');
  });

  it('routes NONE and WEAK non-scoped NO to web when enabled', () => {
    expect(
      resolveNoSufficiencyFallback('NONE', {
        documentScoped: false,
        webSearchEnabled: true,
      }),
    ).toBe('web_search_only');
    expect(
      resolveNoSufficiencyFallback('WEAK', {
        documentScoped: false,
        webSearchEnabled: true,
      }),
    ).toBe('web_search_only');
  });

  it('falls back to vector when web is disabled for NONE or WEAK', () => {
    expect(
      resolveNoSufficiencyFallback('NONE', {
        documentScoped: false,
        webSearchEnabled: false,
      }),
    ).toBe('vector_search_only');
    expect(
      resolveNoSufficiencyFallback('WEAK', {
        documentScoped: false,
        webSearchEnabled: false,
      }),
    ).toBe('vector_search_only');
  });

  it('routes explicit web search requests to web even when retrieval is strong or document-scoped', () => {
    expect(
      resolveNoSufficiencyFallback('STRONG', {
        documentScoped: false,
        webSearchEnabled: true,
        explicitWebSearch: true,
      }),
    ).toBe('web_search_only');
    expect(
      resolveNoSufficiencyFallback('STRONG', {
        documentScoped: true,
        webSearchEnabled: true,
        explicitWebSearch: true,
      }),
    ).toBe('web_search_only');
  });
});
