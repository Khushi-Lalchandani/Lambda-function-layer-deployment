import { describe, it, expect } from 'vitest';
import {
  isClassifyAllDocumentsQuery,
  isPlatformStarterQuery,
  normalizeClassifyAllDocumentsQuery,
  normalizePlatformStarterQuery,
} from '../../services/platform-starter-query.util';

describe('platform-starter-query.util', () => {
  it('normalizes trailing punctuation and whitespace', () => {
    expect(normalizePlatformStarterQuery('  Classify each and every document.  ')).toBe(
      'classify each and every document',
    );
  });

  it.each([
    'Classify each and every document',
    'Classify each and every document.',
    'Pull out key information',
    'Pull out key information.',
  ])('detects platform starter query "%s"', (query) => {
    expect(isPlatformStarterQuery(query)).toBe(true);
  });

  it('normalizes polite classify-all paraphrases', () => {
    expect(
      normalizeClassifyAllDocumentsQuery('Can you classify every document?'),
    ).toBe('classify every document');
    expect(
      normalizeClassifyAllDocumentsQuery('classify each and every document please'),
    ).toBe('classify each and every document');
  });

  it.each([
    'Classify each and every document.',
    'Classify each and every document',
    'Classify all documents in this case',
    'Can you classify every document?',
    'classify each and every document please',
    'Please categorize all files in this case',
    'Classify the documents',
    'Classify these documents',
    'I need you to classify every file',
  ])('detects classify-all-documents intent for "%s"', (query) => {
    expect(isClassifyAllDocumentsQuery(query)).toBe(true);
  });

  it.each([
    'Pull out key information',
    'Classify the notice',
    'Classify this document',
    'Classify the assessment order',
    'What is Section 148A?',
    'Give me a quick overview of this case',
    'Summarize this case in detail',
  ])('rejects non classify-all queries for "%s"', (query) => {
    expect(isClassifyAllDocumentsQuery(query)).toBe(false);
  });

  it('rejects non-starter queries', () => {
    expect(isPlatformStarterQuery('Give me a quick overview of this case')).toBe(false);
    expect(isPlatformStarterQuery('Summarize this case in detail')).toBe(false);
    expect(isPlatformStarterQuery('What is Section 148A?')).toBe(false);
    expect(isPlatformStarterQuery('Classify the notice')).toBe(false);
  });
});
