import { describe, it, expect } from 'vitest';
import {
  isExplicitWebSearchQuery,
  stripExplicitWebSearchFraming,
} from '../../services/explicit-web-search-query.util';

describe('isExplicitWebSearchQuery', () => {
  it('detects explicit web search requests', () => {
    expect(
      isExplicitWebSearchQuery(
        'web search about the latest judicial precedents regarding Section 148A(b)',
      ),
    ).toBe(true);
    expect(isExplicitWebSearchQuery('please search the web for GST notices')).toBe(
      true,
    );
    expect(isExplicitWebSearchQuery('search online for limitation period')).toBe(
      true,
    );
    expect(
      isExplicitWebSearchQuery('look it up on the internet for writ petitions'),
    ).toBe(true);
  });

  it('does not flag general legal questions without web search intent', () => {
    expect(
      isExplicitWebSearchQuery(
        'What are the latest judicial precedents regarding Section 148A(b)?',
      ),
    ).toBe(false);
    expect(isExplicitWebSearchQuery('Explain Section 148A')).toBe(false);
  });

  it('returns false for empty queries', () => {
    expect(isExplicitWebSearchQuery('')).toBe(false);
    expect(isExplicitWebSearchQuery('   ')).toBe(false);
  });
});

describe('stripExplicitWebSearchFraming', () => {
  it('removes web search instruction framing', () => {
    expect(
      stripExplicitWebSearchFraming(
        'web search about the latest judicial precedents regarding Section 148A(b)',
      ),
    ).toBe(
      'the latest judicial precedents regarding Section 148A(b)',
    );
    expect(
      stripExplicitWebSearchFraming('please search the web for GST notices'),
    ).toBe('GST notices');
  });

  it('returns the original query when stripping would leave too little text', () => {
    expect(stripExplicitWebSearchFraming('web search')).toBe('web search');
  });
});
