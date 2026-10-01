import { describe, it, expect } from 'vitest';
import {
  comparePlannerWithExisting,
  mapPlannerToolToStrategy,
  strategiesMatch,
} from '../../services/planner-strategy-mapper';

describe('planner-strategy-mapper', () => {
  it('maps planner tools to existing strategies', () => {
    expect(mapPlannerToolToStrategy('GREETING')).toBe('greeting');
    expect(mapPlannerToolToStrategy('CASE_TIMELINE')).toBe('metadata');
    expect(mapPlannerToolToStrategy('DOCUMENT_FIRST')).toBe('vector');
    expect(mapPlannerToolToStrategy('CASE_SUMMARY')).toBe('vector');
    expect(mapPlannerToolToStrategy('WEB_FIRST')).toBe('web_search');
    expect(mapPlannerToolToStrategy('REFUSE')).toBe('conservative');
  });

  it('matches a single planner action to existing strategy', () => {
    const comparison = comparePlannerWithExisting(
      'Show chronology of the case.',
      'metadata',
      [{ tool: 'CASE_TIMELINE', query: 'Show chronology of the case.' }],
    );

    expect(comparison.matched).toBe(true);
    expect(comparison.mappedStrategies).toEqual(['metadata']);
  });

  it('detects mismatch when planner suggests additional strategies', () => {
    const comparison = comparePlannerWithExisting(
      'Explain allegations and latest law.',
      'vector',
      [
        { tool: 'DOCUMENT_FIRST', query: 'Explain allegations.' },
        { tool: 'WEB_FIRST', query: 'Explain latest law.' },
      ],
    );

    expect(comparison.matched).toBe(false);
    expect(comparison.plannerActions).toEqual([
      'DOCUMENT_FIRST',
      'WEB_FIRST',
    ]);
    expect(comparison.mappedStrategies).toEqual(['vector', 'web_search']);
  });

  it('matches hybrid vector + web_search strategies', () => {
    expect(
      strategiesMatch('vector + web_search', ['vector', 'web_search']),
    ).toBe(true);
    expect(strategiesMatch('vector', ['vector', 'web_search'])).toBe(false);
  });
});
