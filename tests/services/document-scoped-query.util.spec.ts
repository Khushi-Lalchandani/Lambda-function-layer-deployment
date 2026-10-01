import { describe, it, expect } from 'vitest';
import { isDocumentScopedQuery } from '../../services/document-scoped-query.util';

describe('isDocumentScopedQuery', () => {
  it('detects explicit document-scoped phrases', () => {
    expect(
      isDocumentScopedQuery('What is the demand notice in the document?'),
    ).toBe(true);
    expect(
      isDocumentScopedQuery('What does the document say about penalties?'),
    ).toBe(true);
    expect(
      isDocumentScopedQuery('According to the uploaded document, who is the assessee?'),
    ).toBe(true);
    expect(isDocumentScopedQuery('From this case file, list the parties.')).toBe(
      true,
    );
    expect(isDocumentScopedQuery('In these records, what was the tax amount?')).toBe(
      true,
    );
    expect(isDocumentScopedQuery('From these papers, summarize the notice.')).toBe(
      true,
    );
    expect(
      isDocumentScopedQuery(
        'How to secure Form 4 under the Vivad Se Vishwas Scheme, based on the provided document?',
      ),
    ).toBe(true);
    expect(
      isDocumentScopedQuery('give me details form the document'),
    ).toBe(true);
  });

  it('does not flag general legal or case questions without document scope', () => {
    expect(isDocumentScopedQuery('What is a demand notice in Indian tax law?')).toBe(
      false,
    );
    expect(isDocumentScopedQuery('Explain Section 148A')).toBe(false);
    expect(isDocumentScopedQuery('What allegations were made in the notice?')).toBe(
      false,
    );
  });

  it('returns false for empty queries', () => {
    expect(isDocumentScopedQuery('')).toBe(false);
    expect(isDocumentScopedQuery('   ')).toBe(false);
  });
});
