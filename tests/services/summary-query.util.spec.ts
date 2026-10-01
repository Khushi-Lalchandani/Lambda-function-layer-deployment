import { describe, it, expect } from 'vitest';
import {
  hasMetadataSummary,
  isDocumentScopedSummaryQuery,
  isSummaryQuery,
  shouldUseMetadataSummaryPath,
} from '../../services/summary-query.util';

describe('summary-query.util', () => {
  const documentChatsWithSummary = [
    {
      Document: {
        documentMetaData: [{ summary: 'Case overview from metadata.' }],
      },
    },
  ];

  it('detects generic summary queries', () => {
    expect(isSummaryQuery('Summarize this case')).toBe(true);
    expect(isSummaryQuery('Case overview')).toBe(true);
    expect(isSummaryQuery('Brief summary of the notice')).toBe(true);
  });

  it('excludes detailed summary queries', () => {
    expect(isSummaryQuery('Summarize allegations in detail')).toBe(false);
    expect(isSummaryQuery('Detailed summary of evidence')).toBe(false);
  });

  it('excludes section-scoped summary queries from generic summaries', () => {
    const scopedQuery =
      "Summarize Section 8 under the 'Order under clause (d) of section 148A of the Income-tax Act, 1961' in the document.";

    expect(isDocumentScopedSummaryQuery(scopedQuery)).toBe(true);
    expect(isSummaryQuery(scopedQuery)).toBe(false);
    expect(isSummaryQuery('Summarize clause (d) in the order')).toBe(false);
    expect(isSummaryQuery('Give me an overview of paragraph 12')).toBe(false);
  });

  it('detects metadata summary availability', () => {
    expect(hasMetadataSummary(documentChatsWithSummary)).toBe(true);
    expect(hasMetadataSummary([])).toBe(false);
  });

  it('selects metadata summary path only for generic summaries with metadata', () => {
    expect(
      shouldUseMetadataSummaryPath(
        'Summarize this case',
        documentChatsWithSummary,
      ),
    ).toBe(true);
    expect(
      shouldUseMetadataSummaryPath(
        'Summarize allegations in detail',
        documentChatsWithSummary,
      ),
    ).toBe(false);
    expect(
      shouldUseMetadataSummaryPath(
        "Summarize Section 8 under the 'Order under clause (d) of section 148A of the Income-tax Act, 1961' in the document.",
        documentChatsWithSummary,
      ),
    ).toBe(false);
  });
});
