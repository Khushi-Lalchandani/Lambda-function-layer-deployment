import { Logger } from '@nestjs/common';
import { retrievalConfig } from './retrieval-config';

export type RetrievalRankRow = {
  id: string;
  documentId?: string;
  denseScore?: number;
  bm25Score?: number;
  rerankScore?: number;
  similarity?: number;
  content?: string;
};

const shortId = (id: string): string =>
  id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;

const excerpt = (text: string | undefined, max = 72): string => {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > max
    ? `${normalized.slice(0, max)}…`
    : normalized;
};

export function logRetrievalRankTable(
  logger: Logger,
  stage: string,
  query: string,
  rows: RetrievalRankRow[],
  options?: { limit?: number },
): void {
  if (!retrievalConfig.debugRetrievalLogs) {
    return;
  }

  const limit = options?.limit ?? rows.length;
  const queryPreview =
    query.length > 120 ? `${query.slice(0, 120)}…` : query;

  logger.log(
    `[RETRIEVAL][${stage}] query="${queryPreview}" count=${rows.length}`,
  );

  rows.slice(0, limit).forEach((row, index) => {
    const dense =
      row.denseScore != null ? row.denseScore.toFixed(3) : '—';
    const bm25 = row.bm25Score != null ? row.bm25Score.toFixed(3) : '—';
    const fusion =
      row.rerankScore != null ? row.rerankScore.toFixed(3) : '—';
    const dist =
      row.similarity != null ? row.similarity.toFixed(4) : '—';
    const preview = excerpt(row.content);

    logger.log(
      `[RETRIEVAL][${stage}] #${index + 1} id=${shortId(row.id)} doc=${row.documentId ?? '—'} dist=${dist} dense=${dense} bm25=${bm25} fusion=${fusion}${preview ? ` | "${preview}"` : ''}`,
    );
  });
}

export function logRerankOrderChange(
  logger: Logger,
  before: RetrievalRankRow[],
  after: RetrievalRankRow[],
): void {
  if (!retrievalConfig.debugRetrievalLogs) {
    return;
  }

  const beforeRank = new Map(before.map((row, index) => [row.id, index + 1]));
  const changes: string[] = [];

  after.forEach((row, index) => {
    const prev = beforeRank.get(row.id);
    const next = index + 1;
    if (prev == null) {
      changes.push(`${shortId(row.id)}: new→#${next}`);
      return;
    }
    if (prev !== next) {
      const delta = prev - next;
      const arrow = delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`;
      changes.push(`${shortId(row.id)}: #${prev}→#${next} (${arrow})`);
    }
  });

  if (!changes.length) {
    logger.log('[RERANK] Gemini order matches fusion order (no rank changes)');
    return;
  }

  logger.log(`[RERANK] Order changes (${changes.length}): ${changes.join('; ')}`);
}
