import { describe, it, expect, vi } from 'vitest';
import {
  computeTopSimilarity,
  hasStrongDocumentEvidence,
  normalizeChunkSimilarity,
  resolveWebFirstStrategy,
} from '../../services/web-first-probe';
import {
  WEB_FIRST_PROBE_MIN_CHUNKS,
  WEB_FIRST_PROBE_SIMILARITY_THRESHOLD,
  WEB_FIRST_PROBE_TOP_K,
} from '../../services/web-first-probe.config';

describe('web-first-probe', () => {
  it('normalizes cosine distance to similarity', () => {
    expect(normalizeChunkSimilarity(0)).toBe(1);
    expect(normalizeChunkSimilarity(0.4)).toBe(0.8);
    expect(normalizeChunkSimilarity(2)).toBe(0);
  });

  it('detects strong evidence when similarity and chunk count meet thresholds', () => {
    const chunks = [
      { id: '1', content: 'a', documentId: 'doc-1', similarity: 0.2 },
      { id: '2', content: 'b', documentId: 'doc-1', similarity: 0.4 },
    ];

    expect(computeTopSimilarity(chunks)).toBeGreaterThanOrEqual(
      WEB_FIRST_PROBE_SIMILARITY_THRESHOLD,
    );
    expect(hasStrongDocumentEvidence(chunks)).toBe(
      chunks.length >= WEB_FIRST_PROBE_MIN_CHUNKS,
    );
  });

  it('returns web_only when no documents are available', async () => {
    const hybridRetrievalService = {
      retrieveRankedChunks: vi.fn(),
    };

    const resolution = await resolveWebFirstStrategy(
      'Explain Section 148A',
      [],
      undefined,
      hybridRetrievalService as any,
    );

    expect(resolution.action).toBe('web_only');
    expect(resolution.probe).toEqual({
      probeTriggered: true,
      topSimilarity: 0,
      chunkCount: 0,
      redirected: false,
    });
    expect(hybridRetrievalService.retrieveRankedChunks).not.toHaveBeenCalled();
  });

  it('redirects when probe retrieval finds strong evidence', async () => {
    const hybridRetrievalService = {
      retrieveRankedChunks: vi.fn().mockResolvedValue([
        { id: '1', content: 'a', documentId: 'doc-1', similarity: 0.1 },
        { id: '2', content: 'b', documentId: 'doc-1', similarity: 0.2 },
      ]),
    };

    const resolution = await resolveWebFirstStrategy(
      'What allegations are in the notice?',
      ['doc-1'],
      undefined,
      hybridRetrievalService as any,
    );

    expect(hybridRetrievalService.retrieveRankedChunks).toHaveBeenCalledWith(
      'What allegations are in the notice?',
      ['doc-1'],
      undefined,
      {
        executor: 'WebFirstExecutor',
        profile: 'fast',
        finalTopK: WEB_FIRST_PROBE_TOP_K,
      },
    );
    expect(resolution.action).toBe('redirect_document_first');
    expect(resolution.probe.redirected).toBe(true);
    expect(resolution.probe.chunkCount).toBe(2);
  });

  it('continues to web when probe evidence is weak', async () => {
    const hybridRetrievalService = {
      retrieveRankedChunks: vi.fn().mockResolvedValue([
        { id: '1', content: 'a', documentId: 'doc-1', similarity: 1.8 },
      ]),
    };

    const resolution = await resolveWebFirstStrategy(
      'Explain Section 148A',
      ['doc-1'],
      undefined,
      hybridRetrievalService as any,
    );

    expect(resolution.action).toBe('web_only');
    expect(resolution.probe.redirected).toBe(false);
    expect(resolution.probe.chunkCount).toBe(1);
  });
});
