import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('../../services/llm-gateway.service', () => ({
  getLlmGateway: vi.fn(() => ({
    generateContent: mockGenerateContent,
  })),
}));

import { MetadataService } from '../../services/metadata.service';

function buildDocumentChats(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    documentId: `doc-${index + 1}`,
    Document: {
      originalName: `file-${index + 1}.pdf`,
      documentMetaData: [
        {
          document_type: `Type ${index + 1}`,
          document_category: `Category ${index + 1}`,
          document_date: '01-01-2024',
          parties: [`Party ${index + 1}`],
          summary: `Summary for file ${index + 1}`,
        },
      ],
    },
  }));
}

describe('MetadataService document classification', () => {
  let metadataService: MetadataService;

  beforeEach(() => {
    mockGenerateContent.mockReset();
    metadataService = new MetadataService(
      {} as any,
      {} as any,
      {
        renderTemplate: vi.fn().mockReturnValue('classification prompt'),
      } as any,
    );
  });

  it('buildDeterministicDocumentClassification lists every document', () => {
    const documentChats = buildDocumentChats(17);
    const answer =
      metadataService.buildDeterministicDocumentClassification(documentChats);

    expect(answer).toContain('Classification of all 17 document(s)');
    for (let index = 1; index <= 17; index += 1) {
      expect(answer).toContain(`file-${index}.pdf`);
      expect(answer).toContain(`Type ${index}`);
    }
  });

  it('strips backticks from source citations in LLM output', async () => {
    const documentChats = buildDocumentChats(1);
    mockGenerateContent.mockResolvedValue({
      text: '* **Notice** — Test classification. [Source: `file-1.pdf`]',
    });

    const answer = await metadataService.getDocumentClassificationAnswer(
      documentChats,
    );

    expect(answer).toContain('[Source: file-1.pdf]');
    expect(answer).not.toContain('[Source: `file-1.pdf`]');
  });

  it('falls back to deterministic output when LLM omits files', async () => {
    const documentChats = buildDocumentChats(17);
    mockGenerateContent.mockResolvedValue({
      text: 'Only file-1.pdf and file-2.pdf are listed here.',
    });

    const answer = await metadataService.getDocumentClassificationAnswer(
      documentChats,
    );

    expect(answer).toContain('Classification of all 17 document(s)');
    expect(answer).toContain('file-17.pdf');
  });
});
