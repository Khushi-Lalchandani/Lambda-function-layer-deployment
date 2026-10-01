import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('../../services/llm-gateway.service', () => ({
  getLlmGateway: () => ({
    generateContent: mockGenerateContent,
  }),
}));

import { WebSearchQueryOptimizerService } from '../../services/web-search-query-optimizer.service';

describe('WebSearchQueryOptimizerService', () => {
  const promptTemplateService = {
    renderTemplate: vi.fn((_file: string, vars: Record<string, unknown>) =>
      JSON.stringify(vars),
    ),
  };
  const service = new WebSearchQueryOptimizerService(
    promptTemplateService as any,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the original query when optimization is not applied', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        optimized_query: 'What is demand notice?',
        optimization_applied: false,
      }),
    });

    const result = await service.optimizeWebSearchQuery('What is demand notice?');

    expect(result).toEqual({
      originalWebQuery: 'What is demand notice?',
      optimizedQuery: 'What is demand notice?',
      optimizationApplied: false,
    });
    expect(promptTemplateService.renderTemplate).toHaveBeenCalledWith(
      'web-search-query-optimizer.txt',
      { query: 'What is demand notice?' },
    );
  });

  it('returns an optimized query when the model applies search-intent optimization', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        optimized_query: 'What is an income tax demand notice?',
        optimization_applied: true,
      }),
    });

    const result = await service.optimizeWebSearchQuery('What is demand notice?');

    expect(result).toEqual({
      originalWebQuery: 'What is demand notice?',
      optimizedQuery: 'What is an income tax demand notice?',
      optimizationApplied: true,
    });
  });

  it('falls back to the original query when the model response is invalid', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'not json' });

    const result = await service.optimizeWebSearchQuery('What is section 148?');

    expect(result).toEqual({
      originalWebQuery: 'What is section 148?',
      optimizedQuery: 'What is section 148?',
      optimizationApplied: false,
    });
  });

  it('falls back to the original query when optimization fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('LLM unavailable'));

    const result = await service.optimizeWebSearchQuery('Can I appeal after 30 days?');

    expect(result).toEqual({
      originalWebQuery: 'Can I appeal after 30 days?',
      optimizedQuery: 'Can I appeal after 30 days?',
      optimizationApplied: false,
    });
  });
});
