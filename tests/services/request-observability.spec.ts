import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  logInfo,
  logRequestEnd,
  logRequestStart,
  runWithRequestObservability,
} from '../../services/request-observability';
import { Logger } from '@nestjs/common';

describe('request-observability', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('emits REQUEST_START and REQUEST_END for a wrapped request', async () => {
    await runWithRequestObservability(
      { chatId: 'chat-1', query: 'What is the PAN?' },
      async () => {
        logRequestStart();
        logRequestEnd({
          finalStrategy: 'document_only',
          executor: 'DocumentFirstExecutor',
          sourceInfo: 'vector_search_only',
        });
      },
    );

    expect(
      logSpy.mock.calls.some((call) =>
        String(call[0]).includes('[REQUEST_START]'),
      ),
    ).toBe(true);
    expect(
      logSpy.mock.calls.some(
        (call) =>
          String(call[0]).includes('[REQUEST_END]') &&
          String(call[0]).includes('totalLatencyMs='),
      ),
    ).toBe(true);
  });

  it('formats structured info logs', () => {
    logInfo('RETRIEVAL', {
      intent: 'FACT_LOOKUP',
      chunkCount: 3,
      retrievalMs: 120,
    });

    const message = String(logSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('[RETRIEVAL]');
    expect(message).toContain('intent=FACT_LOOKUP');
    expect(message).toContain('chunkCount=3');
  });
});
