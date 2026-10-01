import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnswerRefinementService } from '../../services/answer-refinement.service';
import { PromptTemplateService } from '../../services/prompt-template.service';

const mockGenerateContentOpenAiFirst = vi.fn();

vi.mock('../../services/llm-gateway.service', () => ({
  getLlmGateway: () => ({
    generateContentOpenAiFirst: mockGenerateContentOpenAiFirst,
  }),
}));

describe('AnswerRefinementService', () => {
  let service: AnswerRefinementService;
  let mockRenderTemplate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRenderTemplate = vi.fn(
      (_name: string, vars: { query: string; answer: string }) =>
        `Original Query: ${vars.query}\n### [RAW_ANSWER] TO REFINE: ###\n${vars.answer}\nPreserve <<<PRESERVED_TABLE_N>>> placeholders exactly.`,
    );
    service = new AnswerRefinementService({
      renderTemplate: mockRenderTemplate,
    } as unknown as PromptTemplateService);
  });

  describe('extractPopulatedMarkdownTables', () => {
    it('extracts chronology tables with data rows', () => {
      const answer = `Section 148 was issued by Rakesh Kumar.

| Date | Event Description |
|------|-------------------|
| 03-05-2024 | Notice issued [Source: notice.pdf] |
| 10-06-2024 | Hearing scheduled [Source: order.pdf] |

Each event includes an inline source.`;

      const tables = service.extractPopulatedMarkdownTables(answer);

      expect(tables).toHaveLength(1);
      expect(tables[0].dataRowCount).toBe(2);
      expect(tables[0].content).toContain('| 03-05-2024 | Notice issued');
      expect(tables[0].content).toContain('| 10-06-2024 | Hearing scheduled');
    });

    it('ignores header-only tables without data rows', () => {
      const answer = `Chronology of Key Events
| Date | Event Description |`;

      const tables = service.extractPopulatedMarkdownTables(answer);

      expect(tables).toHaveLength(0);
    });

    it('extracts payment breakdown tables with alignment-style separators', () => {
      const answer = `Month-wise Breakdown of Credit Card Payments
| Month | Date | Payment Details | Source Document |
| :---------------- | :--------- | :--------- | :--------- |
| January 2024 | 15-01-2024 | Payment of Rs. 5000 [Source: stmt.pdf] | stmt.pdf |
| February 2024 | 20-02-2024 | Payment of Rs. 3000 [Source: stmt2.pdf] | stmt2.pdf |`;

      const tables = service.extractPopulatedMarkdownTables(answer);

      expect(tables).toHaveLength(1);
      expect(tables[0].dataRowCount).toBe(2);
      expect(tables[0].content).toContain('| Month | Date | Payment Details | Source Document |');
      expect(tables[0].content).toContain('| --- | --- | --- | --- |');
      expect(tables[0].content).not.toMatch(/-{10,}/);
    });

    it('extracts tables without a separator row', () => {
      const answer = `| Account | Amount |
| Savings | Rs. 10,000 |
| Current | Rs. 5,000 |`;

      const tables = service.extractPopulatedMarkdownTables(answer);

      expect(tables).toHaveLength(1);
      expect(tables[0].dataRowCount).toBe(2);
    });

    it('normalizes malformed separator rows with excessive dashes', () => {
      const answer = `| Month | Date | Payment Details | Source Document |
| :---------------- | :--------- | :------------------------------------------------------------------- |
| January | 15-01-2024 | Payment [Source: stmt.pdf] | stmt.pdf |`;

      const tables = service.extractPopulatedMarkdownTables(answer);

      expect(tables).toHaveLength(1);
      expect(tables[0].content).toContain('| --- | --- | --- | --- |');
      expect(tables[0].content).not.toMatch(/-{10,}/);
    });
  });

  describe('refineAnswerForDisplay', () => {
    it('preserves populated chronology tables through LLM refinement', async () => {
      const chronologyTable = `| Date | Event Description |
|------|-------------------|
| 03-05-2024 | Notice issued [Source: notice.pdf] |
| 10-06-2024 | Hearing scheduled [Source: order.pdf] |`;

      const rawAnswer = `Rakesh Kumar issued the Section 148 notice.

${chronologyTable}`;

      mockGenerateContentOpenAiFirst.mockResolvedValue({
        text: 'Merged answer with placeholder <<<PRESERVED_TABLE_0>>>',
      });

      const refined = await service.refineAnswerForDisplay(
        rawAnswer,
        'Who issued section 148 and give me the chronology of this entire case',
      );

      expect(mockRenderTemplate).toHaveBeenCalledWith('answer-refinement.txt', {
        query: 'Who issued section 148 and give me the chronology of this entire case',
        answer: expect.stringContaining('<<<PRESERVED_TABLE_0>>>'),
      });
      expect(mockGenerateContentOpenAiFirst).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContentOpenAiFirst.mock.calls[0];
      expect(callArgs[1]).toEqual({
        openAiModel: 'gpt-5-mini',
        geminiFallbackModel: 'gemini-3.5-flash-lite',
      });
      expect(callArgs[0].config).toEqual({ reasoning_effort: 'low' });
      const promptText = callArgs[0].contents[0].parts[0].text as string;
      expect(promptText).toContain('<<<PRESERVED_TABLE_0>>>');
      expect(promptText).not.toContain('| 03-05-2024 | Notice issued');

      expect(refined).toContain('| 03-05-2024 | Notice issued');
      expect(refined).toContain('| 10-06-2024 | Hearing scheduled');
      expect(refined).not.toContain('<<<PRESERVED_TABLE_0>>>');
    });

    it('appends preserved table when LLM drops the placeholder', async () => {
      const chronologyTable = `| Date | Event Description |
|------|-------------------|
| 03-05-2024 | Notice issued [Source: notice.pdf] |`;

      mockGenerateContentOpenAiFirst.mockResolvedValue({
        text: 'Merged answer without the table placeholder.',
      });

      const refined = await service.refineAnswerForDisplay(
        `Document answer.\n\n${chronologyTable}`,
        'Give chronology and section 148 details',
      );

      expect(refined).toContain('Merged answer without the table placeholder.');
      expect(refined).toContain('| 03-05-2024 | Notice issued');
    });

    it('removes hallucinated chronology tables before restoring preserved table', async () => {
      const chronologyTable = `| Date | Event Description |
| :--- | :--- |
| 03-09-2018 | The assessee filed the Income Tax Return for A.Y. 2018-19 [Source: itr.pdf] |
| 09-03-2021 | Assessment Order u/s 143(3) passed [Source: order.pdf] |`;

      mockGenerateContentOpenAiFirst.mockResolvedValue({
        text: `## Chronology of the Case

Below is the detailed chronological sequence of key events.

| Date | Event Description | Source |
| --- | --- | --- |
| 12-03-2020 | Initial complaint filed with the court. | 1 |
| 05-06-2020 | Preliminary hearing conducted. | 1 |

<<<PRESERVED_TABLE_0>>>`,
      });

      const refined = await service.refineAnswerForDisplay(
        `Below is the chronological sequence of events.\n\n${chronologyTable}`,
        'Give me the chronology and also who issued section 148',
      );

      expect(refined).toContain('03-09-2018');
      expect(refined).toContain('09-03-2021');
      expect(refined).not.toContain('Initial complaint filed with the court');
      expect(refined).not.toContain('| Source |');
    });

    it('skips LLM refinement for metadata chronology-only answers', async () => {
      const rawAnswer = `Below is the chronological sequence of events extracted from the document, arranged from the earliest to the most recent. Each entry includes a source citation for your reference.

| Date | Event Description |
| :--- | :--- |
| 03-09-2018 | The assessee filed the ITR [Source: itr.pdf] |

Please let me know if you need further details or assistance with this case chronology.`;

      const refined = await service.refineAnswerForDisplay(
        rawAnswer,
        'Give me the chronology of this entire case',
      );

      expect(mockGenerateContentOpenAiFirst).not.toHaveBeenCalled();
      expect(refined).toContain('03-09-2018');
      expect(refined).toContain('[Source: itr.pdf]');
    });

    it('rejects refined answer with hallucinated source citations and returns original', async () => {
      const rawAnswer =
        'Section 148 notice issued by Rakesh Kumar [Source: notice.pdf].';

      mockGenerateContentOpenAiFirst.mockResolvedValue({
        text: 'The notice was issued by Rakesh Kumar under Section 148 [Source: fabricated_doc.pdf].',
      });

      const refined = await service.refineAnswerForDisplay(
        rawAnswer,
        'Who issued section 148',
      );

      expect(refined).toContain('notice.pdf');
      expect(refined).not.toContain('fabricated_doc.pdf');
      expect(refined).toContain('Rakesh Kumar');
    });

    it('accepts refined answer that merges multiple source citations into one block', async () => {
      const rawAnswer =
        'Event A [Source: 9281a0a8-51fc-40f3-aecd-1ad9a99c61b4.pdf]. Event B [Source: 93b7efbe-37d4-428e-aa3c-e9ed3fbd8ea7.pdf]. Event C [Source: 2941e6ad-c66d-481c-b429-ec160a620325.pdf].';

      mockGenerateContentOpenAiFirst.mockResolvedValue({
        text: 'Summary of events [Source: 9281a0a8-51fc-40f3-aecd-1ad9a99c61b4.pdf, 93b7efbe-37d4-428e-aa3c-e9ed3fbd8ea7.pdf, 2941e6ad-c66d-481c-b429-ec160a620325.pdf].',
      });

      const refined = await service.refineAnswerForDisplay(
        rawAnswer,
        'Summarize the case events',
      );

      expect(refined).toContain('Summary of events');
      expect(refined).toContain('9281a0a8-51fc-40f3-aecd-1ad9a99c61b4.pdf');
      expect(refined).toContain('93b7efbe-37d4-428e-aa3c-e9ed3fbd8ea7.pdf');
      expect(refined).toContain('2941e6ad-c66d-481c-b429-ec160a620325.pdf');
    });

    it('preserves payment tables and removes broken LLM-generated empty tables', async () => {
      const paymentTable = `| Month | Date | Payment Details | Source Document |
| :---------------- | :--------- | :--------- | :--------- |
| January 2024 | 15-01-2024 | Payment of Rs. 5000 [Source: stmt.pdf] | stmt.pdf |`;

      mockGenerateContentOpenAiFirst.mockResolvedValue({
        text: `Here is the payment breakdown.

| Month | Date | Payment Details | Source Document |
| :---------------- | :--------- | :------------------------------------------------------------------- |

<<<PRESERVED_TABLE_0>>>`,
      });

      const refined = await service.refineAnswerForDisplay(
        `Payments summary.\n\n${paymentTable}`,
        'Show month-wise credit card payments for Ashiq Ahmed',
      );

      expect(refined).toContain('| January 2024 | 15-01-2024 | Payment of Rs. 5000');
      expect(refined).toContain('| --- | --- | --- | --- |');
      expect(refined).not.toMatch(/\| :-{10,}/);
    });

    it('applies structural markdown when web dump refinement is rejected', async () => {
      const rawAnswer = `Relevant Judicial Precedents:

1. Ashish Agarwal vs. Union of India (Supreme Court): This judgment mandates Section 148A procedure.
2. Keenara Industries Pvt. Ltd. vs. ITO (Gujarat High Court): Approval must show application of mind.

Key Considerations for Your Case:

*  Application of Mind: The approval dated 02-05-2024 must show review of the response.`;

      mockGenerateContentOpenAiFirst.mockResolvedValue({
        text: `## Relevant Judicial Precedents

1. **Ashish Agarwal vs. Union of India (Supreme Court):** This judgment mandates Section 148A procedure.
2. **Keenara Industries Pvt. Ltd. vs. ITO (Gujarat High Court):** Approval must show application of mind.

## Key Considerations for Your Case

- **Application of Mind:** The approval dated 02-05-2024 must show review of the response.

Also note Section 270A penalties.`,
      });

      const refined = await service.refineAnswerForDisplay(
        rawAnswer,
        'can you find relevant judgements on the web that support my case?',
      );

      // Hallucinated Section 270A forces fallback to original — still structured
      expect(refined).not.toContain('Section 270A');
      expect(refined).toContain('## Relevant Judicial Precedents');
      expect(refined).toContain('## Key Considerations for Your Case');
      expect(refined).toContain(
        '1. **Ashish Agarwal vs. Union of India (Supreme Court):**',
      );
      expect(refined).toContain('- **Application of Mind:**');
    });

    it('keeps refined markdown when section parentheticals are normalized', async () => {
      const rawAnswer =
        'Order under Section 148A(d) dated 03-05-2024 after approval on 02/05/2024.';

      mockGenerateContentOpenAiFirst.mockResolvedValue({
        text: '## Outcome\n\nThe **Section 148A** order dated **03-05-2024** followed approval on **02-05-2024**.',
      });

      const refined = await service.refineAnswerForDisplay(
        rawAnswer,
        'what is the current position',
      );

      expect(refined).toContain('## Outcome');
      expect(refined).toContain('**Section 148A**');
      expect(refined).toContain('03-05-2024');
    });
  });

  describe('ensureStructuralMarkdown', () => {
    it('converts plain section titles and case lines into markdown', () => {
      const plain = `Prerequisites and Important Notes:
Some intro text.

Relevant Judicial Precedents:

1. Ashish Agarwal vs. Union of India (Supreme Court): Landmark holding on procedure.
2. Keenara Industries Pvt. Ltd. vs. ITO (Gujarat High Court): Approval must be independent.

Key Considerations for Your Case:

*  Application of Mind: Review the approval carefully.`;

      const structured = service.ensureStructuralMarkdown(plain);

      expect(structured).toContain('## Prerequisites and Important Notes');
      expect(structured).toContain('## Relevant Judicial Precedents');
      expect(structured).toContain(
        '1. **Ashish Agarwal vs. Union of India (Supreme Court):** Landmark holding on procedure.',
      );
      expect(structured).toContain('## Key Considerations for Your Case');
      expect(structured).toContain(
        '- **Application of Mind:** Review the approval carefully.',
      );
    });

    it('leaves existing markdown headings untouched', () => {
      const alreadyFormatted = `## Summary

- **Date:** 24-01-2023`;

      expect(service.ensureStructuralMarkdown(alreadyFormatted)).toBe(
        alreadyFormatted,
      );
    });
  });

  describe('stripAwkwardMetaHeadings', () => {
    it('removes Brief introduction / Brief answer style headings and keeps body', () => {
      const withMeta = `## Brief introduction

Below is a structured presentation of the judicial principles.

## Scope of Section 148A(d) orders

- The Supreme Court requires a speaking order.

## Brief answer

I could not find judgments in the uploaded documents.

## Relevant document excerpt

- RMS information was cited.`;

      const cleaned = service.stripAwkwardMetaHeadings(withMeta);

      expect(cleaned).not.toMatch(/Brief introduction/i);
      expect(cleaned).not.toMatch(/Brief answer/i);
      expect(cleaned).not.toMatch(/Relevant document excerpt/i);
      expect(cleaned).toContain('## Scope of Section 148A(d) orders');
      expect(cleaned).toContain('Below is a structured presentation');
      expect(cleaned).toContain('I could not find judgments');
      expect(cleaned).toContain('RMS information was cited');
    });
  });
});
