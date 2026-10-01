import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChunkRerankService } from '../../services/chunk-rerank.service';
import { PromptTemplateService } from '../../services/prompt-template.service';

const mockGenerateContent = vi.fn();

vi.mock('../../services/llm-gateway.service', () => ({
  getLlmGateway: () => ({
    generateContent: mockGenerateContent,
  }),
}));

describe('ChunkRerankService', () => {
  let service: ChunkRerankService;

  const candidates = [
    {
      id: 'chunk-a',
      content: 'Section 148A notice details',
      documentId: 'doc-1',
      similarity: 0.2,
      denseScore: 0.8,
      bm25Score: 0.5,
      rerankScore: 0.7,
    },
    {
      id: 'chunk-b',
      content: 'Unrelated boilerplate header',
      documentId: 'doc-1',
      similarity: 0.5,
      denseScore: 0.4,
      bm25Score: 0.2,
      rerankScore: 0.3,
    },
    {
      id: 'chunk-c',
      content: 'Assessment year and party names',
      documentId: 'doc-1',
      similarity: 0.3,
      denseScore: 0.6,
      bm25Score: 0.4,
      rerankScore: 0.5,
    },
  ];

  beforeEach(() => {
    mockGenerateContent.mockReset();
    service = new ChunkRerankService(new PromptTemplateService());
  });

  it('parses chunk IDs from Gemini candidates[].content.parts responses', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: '["chunk-a","chunk-c"]' }],
          },
        },
      ],
    });

    const result = await service.rerank('Section 148A notice', candidates, 2);

    expect(result.map((chunk) => chunk.id)).toEqual(['chunk-a', 'chunk-c']);
  });

  it('falls back to fusion order when the model returns an empty array', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: '[]' }],
          },
        },
      ],
    });

    const result = await service.rerank('Section 148A notice', candidates, 2);

    expect(result.map((chunk) => chunk.id)).toEqual(['chunk-a', 'chunk-b']);
  });
});
