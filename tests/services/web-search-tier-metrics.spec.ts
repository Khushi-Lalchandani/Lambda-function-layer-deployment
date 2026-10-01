import { describe, it, expect } from 'vitest';
import {
  computeCitationPreservationRate,
  computeTablePreservationRate,
  extractMarkdownTables,
  extractSourceCitations,
  measureHybridAnswerQuality,
} from '../../services/web-search-tier-metrics';

describe('web-search-tier-metrics', () => {
  it('extracts unique source citations from document context', () => {
    const text = `[Source: notice.pdf]\nBody\n\n---\n\n[Source: order.pdf]\nMore`;
    expect(extractSourceCitations(text)).toEqual(['notice.pdf', 'order.pdf']);
  });

  it('computes citation preservation rate', () => {
    const context = '[Source: notice.pdf]\n[Source: order.pdf]';
    const answer = 'Per notice.pdf the date was set. order.pdf confirms.';
    const result = computeCitationPreservationRate(
      extractSourceCitations(context),
      answer,
    );
    expect(result.citationsExpected).toBe(2);
    expect(result.citationsPreserved).toBe(2);
    expect(result.citationPreservationRate).toBe(1);
  });

  it('detects markdown tables and preservation in synthesized answer', () => {
    const input = `Summary\n| Month | Amount |\n| --- | --- |\n| Jan | 100 |`;
    const preserved = `| Month | Amount |\n| --- | --- |\n| Jan | 100 |`;
    const tables = extractMarkdownTables(input);
    expect(tables).toHaveLength(1);
    const result = computeTablePreservationRate(input, preserved);
    expect(result.tablesExpected).toBe(1);
    expect(result.tablesPreserved).toBe(1);
    expect(result.tablePreservationRate).toBe(1);
  });

  it('aggregates hybrid quality metrics', () => {
    const metrics = measureHybridAnswerQuality(
      '[Source: doc.pdf]\n| Col | Val |\n| --- | --- |\n| A | 1 |',
      'Answer citing doc.pdf with | Col | Val | and A',
    );
    expect(metrics.citationsExpected).toBe(1);
    expect(metrics.tablesExpected).toBe(1);
    expect(metrics.answerLength).toBeGreaterThan(0);
  });
});
