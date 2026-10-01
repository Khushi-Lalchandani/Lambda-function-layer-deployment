import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryDecompositionService } from '../../services/query-decomposition.service';
import { PromptTemplateService } from '../../services/prompt-template.service';

const mockGenerateContent = vi.fn();

vi.mock('../../services/llm-gateway.service', () => ({
  getLlmGateway: () => ({
    generateContent: mockGenerateContent,
  }),
}));

describe('QueryDecompositionService', () => {
  let service: QueryDecompositionService;

  beforeEach(() => {
    mockGenerateContent.mockReset();
    service = new QueryDecompositionService(new PromptTemplateService());
  });

  describe('should decompose', () => {
    it('decomposes chronology and allegations query', async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    should_decompose: true,
                    sub_queries: [
                      'Show the chronology of the case.',
                      'Explain the allegations made against the assessee.',
                    ],
                    decomposition_reason: 'multiple_independent_tasks',
                  }),
                },
              ],
            },
          },
        ],
      });

      const result = await service.decompose(
        'Show the chronology of the case and explain the allegations made against the assessee.',
      );

      expect(result.shouldDecompose).toBe(true);
      expect(result.subQueries).toHaveLength(2);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('decomposes summarize and provisions query', async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    should_decompose: true,
                    sub_queries: [
                      'Summarize the notice.',
                      'Have the relevant provisions changed recently?',
                    ],
                    decomposition_reason: 'multiple_independent_tasks',
                  }),
                },
              ],
            },
          },
        ],
      });

      const result = await service.decompose(
        'Summarize the notice and tell me whether provisions changed recently.',
      );

      expect(result.shouldDecompose).toBe(true);
      expect(result.subQueries).toEqual([
        'Summarize the notice.',
        'Have the relevant provisions changed recently?',
      ]);
    });

    it('decomposes list transactions and relevance query', async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    should_decompose: true,
                    sub_queries: [
                      'List the transactions.',
                      'Explain their relevance.',
                    ],
                    decomposition_reason: 'multiple_independent_tasks',
                  }),
                },
              ],
            },
          },
        ],
      });

      const result = await service.decompose(
        'List transactions and explain their relevance.',
      );

      expect(result.shouldDecompose).toBe(true);
      expect(result.subQueries).toHaveLength(2);
    });
  });

  describe('should NOT decompose', () => {
    it('does not decompose single summarize query', async () => {
      const result = await service.decompose('Summarize the notice.');

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual([]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('does not decompose single factual query', async () => {
      const result = await service.decompose('What are the allegations?');

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual([]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('does not decompose complex single analytical query', async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    should_decompose: false,
                    sub_queries: [],
                    decomposition_reason: 'single_intent',
                  }),
                },
              ],
            },
          },
        ],
      });

      const result = await service.decompose(
        'Explain why the Assessing Officer rejected the explanation.',
      );

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual([]);
    });
  });

  describe('dependency resolution', () => {
    it('resolves references between dependent sub-queries', async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    should_decompose: true,
                    sub_queries: [
                      'What transactions are mentioned in the bank statement?',
                      'What do the notices say about the transactions mentioned in the bank statement?',
                    ],
                    decomposition_reason: 'multiple_independent_tasks',
                  }),
                },
              ],
            },
          },
        ],
      });

      const result = await service.decompose(
        'What transactions are mentioned in the bank statement and what do the notices say about them?',
      );

      expect(result.shouldDecompose).toBe(true);
      expect(result.subQueries[1]).toContain(
        'transactions mentioned in the bank statement',
      );
    });
  });
});
