import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  getProfileParameters,
  logRetrievalProfile,
  logRetrievalSkipped,
  resolveRetrievalProfile,
  RETRIEVAL_SKIP_REASONS,
} from '../../services/retrieval-profile';

vi.mock('../../services/query-intent-classifier', () => ({
  classifyQueryIntent: vi.fn(async (query: string) =>
    query.includes('statement date') ? 'FACT_LOOKUP' : 'REASONING',
  ),
}));

describe('retrieval-profile', () => {
  it('maps fast profile parameters from config defaults', () => {
    const params = getProfileParameters('fast');

    expect(params).toMatchObject({
      profile: 'fast',
      queryIntent: 'FACT_LOOKUP',
      poolSize: 12,
      denseCandidateK: 12,
      bm25CandidateK: 8,
      finalTopK: 5,
      geminiRerank: false,
    });
  });

  it('maps deep profile parameters with finalTopK 8', () => {
    const params = getProfileParameters('deep');

    expect(params).toMatchObject({
      profile: 'deep',
      queryIntent: 'REASONING',
      poolSize: 20,
      denseCandidateK: 20,
      bm25CandidateK: 12,
      finalTopK: 8,
      geminiRerank: true,
    });
  });

  it('resolves profile from query intent when not explicit', async () => {
    await expect(
      resolveRetrievalProfile('What is the statement date?'),
    ).resolves.toBe('fast');
    await expect(
      resolveRetrievalProfile('Explain the allegations in detail'),
    ).resolves.toBe('deep');
  });

  it('logs skipped retrieval decisions in debug mode', () => {
    const previousDebug = process.env.LOG_DEBUG;
    process.env.LOG_DEBUG = 'true';
    const debugSpy = vi
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const logger = new Logger('test');

    logRetrievalSkipped(
      logger,
      'TimelineExecutor',
      RETRIEVAL_SKIP_REASONS.METADATA_ONLY,
    );

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[RETRIEVAL_DECISION]'),
    );
    debugSpy.mockRestore();
    process.env.LOG_DEBUG = previousDebug;
  });

  it('logs active retrieval profile decisions in debug mode', () => {
    const previousDebug = process.env.LOG_DEBUG;
    process.env.LOG_DEBUG = 'true';
    const debugSpy = vi
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const logger = new Logger('test');
    const params = getProfileParameters('deep');

    logRetrievalProfile(logger, 'DocumentFirstExecutor', params);

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[RETRIEVAL_DECISION]'),
    );
    debugSpy.mockRestore();
    process.env.LOG_DEBUG = previousDebug;
  });
});
