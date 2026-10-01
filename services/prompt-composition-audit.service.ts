import { Injectable } from '@nestjs/common';
import { PromptBreakdownInput } from './gemini-prompt-breakdown';

export type PromptComponent = 'system_prompt' | 'history' | 'retrieval' | 'query';

export interface RetrievalChunkAudit {
  source_document?: string;
  characters: number;
  tokens_estimated: number;
  content_preview: string;
  content_hash: string;
}

export interface PromptCompositionAnalysis {
  request_id: string;
  conversation_id?: string;
  model: string;
  system_prompt: {
    characters: number;
    tokens_estimated: number;
  };
  history: {
    messages_count: number;
    characters: number;
    tokens_estimated: number;
  };
  retrieval: {
    retrieved_documents_count: number;
    retrieved_chunks_count: number;
    characters: number;
    tokens_estimated: number;
    average_chunk_tokens: number;
    largest_chunk_tokens: number;
    duplicate_chunks_count: number;
    top_contributing_chunks: Array<{
      source_document?: string;
      tokens_estimated: number;
      characters: number;
      content_preview: string;
      is_duplicate: boolean;
    }>;
  };
  query: {
    characters: number;
    tokens_estimated: number;
  };
  totals: {
    total_estimated_tokens: number;
    actual_input_tokens_from_vertex?: number;
    estimation_error_percent?: number;
  };
  composition_percentages: {
    system_prompt_percentage: number;
    retrieval_percentage: number;
    history_percentage: number;
    query_percentage: number;
  };
  largest_component: PromptComponent;
  largest_component_tokens: number;
}

export interface PromptCompositionAuditLogPayload {
  event: 'prompt_composition_audit';
  timestamp: string;
  request_id: string;
  conversation_id?: string;
  model: string;
  system_prompt_characters: number;
  system_prompt_tokens_estimated: number;
  history_messages_count: number;
  history_characters: number;
  history_tokens_estimated: number;
  retrieved_documents_count: number;
  retrieved_chunks_count: number;
  retrieval_characters: number;
  retrieval_tokens_estimated: number;
  average_chunk_tokens: number;
  largest_chunk_tokens: number;
  duplicate_chunks_count: number;
  query_characters: number;
  query_tokens_estimated: number;
  total_estimated_tokens: number;
  actual_input_tokens_from_vertex?: number;
  estimation_error_percent?: number;
  system_prompt_percentage: number;
  retrieval_percentage: number;
  history_percentage: number;
  query_percentage: number;
  largest_component: PromptComponent;
  largest_component_tokens: number;
  top_contributing_chunks: PromptCompositionAnalysis['retrieval']['top_contributing_chunks'];
}

export interface PromptCompositionSnapshotPayload {
  event: 'prompt_composition_snapshot';
  timestamp: string;
  request_id: string;
  conversation_id?: string;
  model: string;
  largest_component: PromptComponent;
  largest_component_tokens: number;
  token_percentages: PromptCompositionAnalysis['composition_percentages'];
  actual_input_tokens_from_vertex: number;
  top_contributing_chunks: PromptCompositionAnalysis['retrieval']['top_contributing_chunks'];
}

export interface PromptTokenSourceReport {
  request_count: number;
  system_prompt_percentage: number;
  retrieval_percentage: number;
  history_percentage: number;
  query_percentage: number;
  where_are_tokens_coming_from: string;
}

export interface PromptCompositionAuditReport {
  generated_at: string;
  request_count: number;
  token_source_report: PromptTokenSourceReport;
  high_token_requests: Array<{
    request_id: string;
    model: string;
    actual_input_tokens_from_vertex: number;
    largest_component: PromptComponent;
    retrieval_percentage: number;
    system_prompt_percentage: number;
    duplicate_chunks_count: number;
  }>;
  retrieval_misclassification_signals: Array<{
    request_id: string;
    signal: string;
    actual_input_tokens_from_vertex: number;
    system_prompt_percentage: number;
    retrieval_percentage: number;
  }>;
}

const SOURCE_BLOCK_PATTERN =
  /\[Source:\s*([^\]]+)\]\s*\n?([\s\S]*?)(?=\n\n---\n\n|\n\[Source:|\n\n(?:(?:Previous conversation|Question:|User Query:|Query:|Input Query:|Current question:|Context from|Answer:|Respond with|EVALUATION CRITERIA))|(?:\n(?:Previous conversation|Question:|User Query:|Query:|Current question:|Answer:))|$)/gi;

const HISTORY_SECTION_PATTERN =
  /previous conversation context:\s*([\s\S]*?)(?=\n\n(?:critical|question:|user query:|query:|input query:|current question:|context from|answer:|candidates:|respond with)|$)/gi;

const RETRIEVED_CHUNKS_SECTION_PATTERN =
  /retrieved chunks[^:]*:\s*([\s\S]*?)(?=\n\nEVALUATION CRITERIA|\n\nRespond|\n\nUser Query:|$)/gi;

const CONTEXT_SECTION_PATTERN =
  /context from legal documents:\s*([\s\S]*?)(?=\n(?:Previous conversation|Question:|User Query:|Current question:|Answer:)|$)/gi;

const CANDIDATES_SECTION_PATTERN =
  /candidates:\s*([\s\S]*?)(?=\n\nRespond with|$)/gi;

const QUERY_SECTION_PATTERNS = [
  /(?:^|\n)question:\s*(.+?)(?:\n\n|\nanswer:|\ncontext|$)/is,
  /user query:\s*"([^"]+)"/i,
  /(?:^|\n)query:\s*"([^"]+)"/i,
  /input query:\s*"([^"]+)"/i,
  /current question:\s*(.+?)(?:\n|$)/is,
  /(?:^|\n)query:\s*(.+?)(?:\n\n|\ncandidates:|$)/is,
];

const MAX_STORED_AUDITS = 5000;
const MAX_DEBUG_SNAPSHOTS = 25;
const HIGH_TOKEN_THRESHOLD = 10000;

let auditServiceInstance: PromptCompositionAuditService | null = null;

export function getPromptCompositionAuditService(): PromptCompositionAuditService {
  if (!auditServiceInstance) {
    auditServiceInstance = new PromptCompositionAuditService();
  }
  return auditServiceInstance;
}

export function resetPromptCompositionAuditService(): void {
  auditServiceInstance = null;
}

export function isPromptAuditEnabled(): boolean {
  return (process.env.PROMPT_AUDIT_ENABLED ?? '').trim().toLowerCase() === 'true';
}

@Injectable()
export class PromptCompositionAuditService {
  private readonly audits: PromptCompositionAnalysis[] = [];
  private readonly debugSnapshots: PromptCompositionSnapshotPayload[] = [];

  analyzeRequest(input: {
    requestId: string;
    conversationId?: string;
    model: string;
    params: PromptBreakdownInput;
  }): PromptCompositionAnalysis {
    const systemInstruction = input.params.config?.systemInstruction ?? '';
    const { modelHistoryText, userTexts, historyMessageCount } =
      splitContentsForAudit(input.params.contents);

    let historyText = modelHistoryText;
    let retrievalChunks: RetrievalChunkAudit[] = [];
    let queryText = '';
    let templateText = '';

    for (const userText of userTexts) {
      let remaining = userText;

      const historyMatches = collectPatternMatches(remaining, HISTORY_SECTION_PATTERN);
      historyText = [historyText, ...historyMatches].filter(Boolean).join('\n\n');
      remaining = removeMatches(remaining, historyMatches);

      const chunksFromUser = extractRetrievalChunks(remaining);
      retrievalChunks = [...retrievalChunks, ...chunksFromUser.chunks];
      remaining = chunksFromUser.remainingText;

      const queryMatches = collectQueryMatches(remaining);
      queryText = [queryText, ...queryMatches].filter(Boolean).join('\n\n');
      remaining = removeMatches(remaining, queryMatches);

      templateText = [templateText, remaining.trim()].filter(Boolean).join('\n\n');
    }

    if (!queryText && userTexts.length > 0) {
      const lastUserText = userTexts[userTexts.length - 1]?.trim() ?? '';
      const shortQueryMatch = lastUserText.match(
        /^(?:Query|Question|User Query|Input Query):\s*(.+)$/is,
      );
      if (shortQueryMatch?.[1]) {
        queryText = shortQueryMatch[1].trim();
        templateText = templateText.replace(shortQueryMatch[0], '').trim();
      }
    }

    const duplicateStats = analyzeDuplicateChunks(retrievalChunks);
    const systemPromptText = [systemInstruction, templateText].filter(Boolean).join('\n\n');
    const historyCharacters = historyText.length;
    const retrievalCharacters = retrievalChunks.reduce(
      (sum, chunk) => sum + chunk.characters,
      0,
    );
    const queryCharacters = queryText.length;
    const systemPromptCharacters = systemPromptText.length;

    const systemPromptTokens = estimateTokenCount(systemPromptCharacters);
    const historyTokens = estimateTokenCount(historyCharacters);
    const retrievalTokens = estimateTokenCount(retrievalCharacters);
    const queryTokens = estimateTokenCount(queryCharacters);
    const totalEstimatedTokens =
      systemPromptTokens + historyTokens + retrievalTokens + queryTokens;

    const compositionPercentages = buildPercentages({
      system_prompt: systemPromptTokens,
      history: historyTokens,
      retrieval: retrievalTokens,
      query: queryTokens,
    });

    const largest = resolveLargestComponent({
      system_prompt: systemPromptTokens,
      history: historyTokens,
      retrieval: retrievalTokens,
      query: queryTokens,
    });

    const topContributingChunks = buildTopContributingChunks(
      retrievalChunks,
      duplicateStats.duplicateHashes,
    );

    return {
      request_id: input.requestId,
      conversation_id: input.conversationId,
      model: input.model,
      system_prompt: {
        characters: systemPromptCharacters,
        tokens_estimated: systemPromptTokens,
      },
      history: {
        messages_count: countHistoryMessages(historyText, historyMessageCount),
        characters: historyCharacters,
        tokens_estimated: historyTokens,
      },
      retrieval: {
        retrieved_documents_count: countUniqueDocuments(retrievalChunks),
        retrieved_chunks_count: retrievalChunks.length,
        characters: retrievalCharacters,
        tokens_estimated: retrievalTokens,
        average_chunk_tokens:
          retrievalChunks.length > 0
            ? round(retrievalTokens / retrievalChunks.length, 2)
            : 0,
        largest_chunk_tokens: retrievalChunks.reduce(
          (max, chunk) => Math.max(max, chunk.tokens_estimated),
          0,
        ),
        duplicate_chunks_count: duplicateStats.duplicateCount,
        top_contributing_chunks: topContributingChunks,
      },
      query: {
        characters: queryCharacters,
        tokens_estimated: queryTokens,
      },
      totals: {
        total_estimated_tokens: totalEstimatedTokens,
      },
      composition_percentages: compositionPercentages,
      largest_component: largest.component,
      largest_component_tokens: largest.tokens,
    };
  }

  recordAudit(
    analysis: PromptCompositionAnalysis,
    actualInputTokens?: number,
  ): void {
    const finalized = finalizeAnalysis(analysis, actualInputTokens);
    this.storeAudit(finalized);
    this.logCompositionAudit(finalized);

    if (isPromptAuditEnabled()) {
      this.maybeCaptureDebugSnapshot(finalized);
    }
  }

  logCompositionAudit(analysis: PromptCompositionAnalysis): void {
    const payload: PromptCompositionAuditLogPayload = {
      event: 'prompt_composition_audit',
      timestamp: new Date().toISOString(),
      request_id: analysis.request_id,
      conversation_id: analysis.conversation_id,
      model: analysis.model,
      system_prompt_characters: analysis.system_prompt.characters,
      system_prompt_tokens_estimated: analysis.system_prompt.tokens_estimated,
      history_messages_count: analysis.history.messages_count,
      history_characters: analysis.history.characters,
      history_tokens_estimated: analysis.history.tokens_estimated,
      retrieved_documents_count: analysis.retrieval.retrieved_documents_count,
      retrieved_chunks_count: analysis.retrieval.retrieved_chunks_count,
      retrieval_characters: analysis.retrieval.characters,
      retrieval_tokens_estimated: analysis.retrieval.tokens_estimated,
      average_chunk_tokens: analysis.retrieval.average_chunk_tokens,
      largest_chunk_tokens: analysis.retrieval.largest_chunk_tokens,
      duplicate_chunks_count: analysis.retrieval.duplicate_chunks_count,
      query_characters: analysis.query.characters,
      query_tokens_estimated: analysis.query.tokens_estimated,
      total_estimated_tokens: analysis.totals.total_estimated_tokens,
      actual_input_tokens_from_vertex: analysis.totals.actual_input_tokens_from_vertex,
      estimation_error_percent: analysis.totals.estimation_error_percent,
      system_prompt_percentage: analysis.composition_percentages.system_prompt_percentage,
      retrieval_percentage: analysis.composition_percentages.retrieval_percentage,
      history_percentage: analysis.composition_percentages.history_percentage,
      query_percentage: analysis.composition_percentages.query_percentage,
      largest_component: analysis.largest_component,
      largest_component_tokens: analysis.largest_component_tokens,
      top_contributing_chunks: analysis.retrieval.top_contributing_chunks,
    };

    console.log(JSON.stringify(payload));
  }

  getTokenSourceReport(): PromptTokenSourceReport {
    if (this.audits.length === 0) {
      return {
        request_count: 0,
        system_prompt_percentage: 0,
        retrieval_percentage: 0,
        history_percentage: 0,
        query_percentage: 0,
        where_are_tokens_coming_from:
          'No prompt composition audits recorded yet.',
      };
    }

    const averages = averagePercentages(this.audits);
    return {
      request_count: this.audits.length,
      ...averages,
      where_are_tokens_coming_from: describeTokenSources(averages),
    };
  }

  buildAuditReport(): PromptCompositionAuditReport {
    const tokenSourceReport = this.getTokenSourceReport();
    const highTokenRequests = [...this.audits]
      .filter(
        (audit) =>
          (audit.totals.actual_input_tokens_from_vertex ?? 0) >=
          HIGH_TOKEN_THRESHOLD,
      )
      .sort(
        (left, right) =>
          (right.totals.actual_input_tokens_from_vertex ?? 0) -
          (left.totals.actual_input_tokens_from_vertex ?? 0),
      )
      .slice(0, 20)
      .map((audit) => ({
        request_id: audit.request_id,
        model: audit.model,
        actual_input_tokens_from_vertex:
          audit.totals.actual_input_tokens_from_vertex ?? 0,
        largest_component: audit.largest_component,
        retrieval_percentage: audit.composition_percentages.retrieval_percentage,
        system_prompt_percentage:
          audit.composition_percentages.system_prompt_percentage,
        duplicate_chunks_count: audit.retrieval.duplicate_chunks_count,
      }));

    const retrievalMisclassificationSignals = this.audits
      .map((audit) => detectMisclassificationSignal(audit))
      .filter((signal): signal is NonNullable<typeof signal> => signal != null);

    return {
      generated_at: new Date().toISOString(),
      request_count: this.audits.length,
      token_source_report: tokenSourceReport,
      high_token_requests: highTokenRequests,
      retrieval_misclassification_signals: retrievalMisclassificationSignals,
    };
  }

  getLargestRequestSnapshots(): PromptCompositionSnapshotPayload[] {
    return [...this.debugSnapshots];
  }

  private storeAudit(analysis: PromptCompositionAnalysis): void {
    this.audits.push(analysis);
    if (this.audits.length > MAX_STORED_AUDITS) {
      this.audits.splice(0, this.audits.length - MAX_STORED_AUDITS);
    }
  }

  private maybeCaptureDebugSnapshot(analysis: PromptCompositionAnalysis): void {
    const actualTokens = analysis.totals.actual_input_tokens_from_vertex ?? 0;
    if (actualTokens < HIGH_TOKEN_THRESHOLD) {
      return;
    }

    const snapshot: PromptCompositionSnapshotPayload = {
      event: 'prompt_composition_snapshot',
      timestamp: new Date().toISOString(),
      request_id: analysis.request_id,
      conversation_id: analysis.conversation_id,
      model: analysis.model,
      largest_component: analysis.largest_component,
      largest_component_tokens: analysis.largest_component_tokens,
      token_percentages: analysis.composition_percentages,
      actual_input_tokens_from_vertex: actualTokens,
      top_contributing_chunks: analysis.retrieval.top_contributing_chunks,
    };

    this.debugSnapshots.push(snapshot);
    this.debugSnapshots.sort(
      (left, right) =>
        right.actual_input_tokens_from_vertex -
        left.actual_input_tokens_from_vertex,
    );
    if (this.debugSnapshots.length > MAX_DEBUG_SNAPSHOTS) {
      this.debugSnapshots.length = MAX_DEBUG_SNAPSHOTS;
    }

    console.log(JSON.stringify(snapshot));
  }
}

function extractRetrievalChunks(text: string): {
  chunks: RetrievalChunkAudit[];
  remainingText: string;
} {
  const chunks: RetrievalChunkAudit[] = [];
  let remaining = text;

  for (const match of remaining.matchAll(SOURCE_BLOCK_PATTERN)) {
    const sourceDocument = match[1]?.trim();
    const content = (match[2] ?? '').trim();
    if (!content) {
      continue;
    }
    chunks.push(createChunkAudit(sourceDocument, content));
  }
  remaining = remaining.replace(SOURCE_BLOCK_PATTERN, '');

  const sectionPatterns = [
    RETRIEVED_CHUNKS_SECTION_PATTERN,
    CONTEXT_SECTION_PATTERN,
    CANDIDATES_SECTION_PATTERN,
  ];

  for (const pattern of sectionPatterns) {
    for (const match of remaining.matchAll(pattern)) {
      const section = (match[1] ?? '').trim();
      if (!section) {
        continue;
      }

      const sectionChunks = splitSectionIntoChunks(section);
      chunks.push(...sectionChunks);
      remaining = remaining.replace(match[0], '');
    }
  }

  return { chunks, remainingText: remaining };
}

function splitSectionIntoChunks(section: string): RetrievalChunkAudit[] {
  if (/\[Source:/i.test(section)) {
    const nested = extractRetrievalChunks(section);
    return nested.chunks;
  }

  const delimiterChunks = section
    .split(/\n\n---\n\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (delimiterChunks.length > 1) {
    return delimiterChunks.map((content) => createChunkAudit(undefined, content));
  }

  const numberedCandidates = section
    .split(/\n\n(?=\d+\.\s)/)
    .map((part) => part.trim())
    .filter((part) => /^\d+\.\s/.test(part));

  if (numberedCandidates.length > 1) {
    return numberedCandidates.map((content) => createChunkAudit(undefined, content));
  }

  return section ? [createChunkAudit(undefined, section)] : [];
}

function createChunkAudit(
  sourceDocument: string | undefined,
  content: string,
): RetrievalChunkAudit {
  const normalized = normalizeContent(content);
  return {
    source_document: sourceDocument,
    characters: content.length,
    tokens_estimated: estimateTokenCount(content.length),
    content_preview: content.slice(0, 120).replace(/\s+/g, ' '),
    content_hash: hashContent(normalized),
  };
}

function analyzeDuplicateChunks(chunks: RetrievalChunkAudit[]): {
  duplicateCount: number;
  duplicateHashes: Set<string>;
} {
  const seen = new Map<string, number>();
  const duplicateHashes = new Set<string>();

  for (const chunk of chunks) {
    const count = (seen.get(chunk.content_hash) ?? 0) + 1;
    seen.set(chunk.content_hash, count);
    if (count > 1) {
      duplicateHashes.add(chunk.content_hash);
    }
  }

  const duplicateCount = [...seen.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );

  return { duplicateCount, duplicateHashes };
}

function buildTopContributingChunks(
  chunks: RetrievalChunkAudit[],
  duplicateHashes: Set<string>,
): PromptCompositionAnalysis['retrieval']['top_contributing_chunks'] {
  return [...chunks]
    .sort((left, right) => right.tokens_estimated - left.tokens_estimated)
    .slice(0, 5)
    .map((chunk) => ({
      source_document: chunk.source_document,
      tokens_estimated: chunk.tokens_estimated,
      characters: chunk.characters,
      content_preview: chunk.content_preview,
      is_duplicate: duplicateHashes.has(chunk.content_hash),
    }));
}

function splitContentsForAudit(
  contents: PromptBreakdownInput['contents'],
): {
  modelHistoryText: string;
  userTexts: string[];
  historyMessageCount: number;
} {
  if (typeof contents === 'string') {
    return { modelHistoryText: '', userTexts: [contents], historyMessageCount: 0 };
  }

  const modelParts: string[] = [];
  const userTexts: string[] = [];
  let historyMessageCount = 0;

  for (const entry of contents ?? []) {
    const text = extractEntryText(entry);
    if (!text) {
      continue;
    }

    if (entry.role === 'model') {
      modelParts.push(text);
      historyMessageCount += 1;
      continue;
    }

    userTexts.push(text);
    if (entry.role === 'user') {
      historyMessageCount += 1;
    }
  }

  return {
    modelHistoryText: modelParts.join('\n\n'),
    userTexts,
    historyMessageCount,
  };
}

function countHistoryMessages(
  historyText: string,
  roleBasedCount: number,
): number {
  const markerCount =
    (historyText.match(/\bUser:/gi)?.length ?? 0) +
    (historyText.match(/\bAssistant:/gi)?.length ?? 0);

  return Math.max(roleBasedCount, markerCount);
}

function countUniqueDocuments(chunks: RetrievalChunkAudit[]): number {
  const documents = new Set(
    chunks
      .map((chunk) => chunk.source_document?.trim())
      .filter((document): document is string => Boolean(document)),
  );
  return documents.size;
}

function finalizeAnalysis(
  analysis: PromptCompositionAnalysis,
  actualInputTokens?: number,
): PromptCompositionAnalysis {
  if (actualInputTokens == null || actualInputTokens <= 0) {
    return {
      ...analysis,
      totals: {
        ...analysis.totals,
        actual_input_tokens_from_vertex: actualInputTokens,
      },
    };
  }

  const estimationErrorPercent = round(
    (Math.abs(analysis.totals.total_estimated_tokens - actualInputTokens) /
      actualInputTokens) *
      100,
    2,
  );

  return {
    ...analysis,
    totals: {
      total_estimated_tokens: analysis.totals.total_estimated_tokens,
      actual_input_tokens_from_vertex: actualInputTokens,
      estimation_error_percent: estimationErrorPercent,
    },
  };
}

function buildPercentages(tokens: Record<PromptComponent, number>): {
  system_prompt_percentage: number;
  retrieval_percentage: number;
  history_percentage: number;
  query_percentage: number;
} {
  const total =
    tokens.system_prompt + tokens.history + tokens.retrieval + tokens.query;

  if (total <= 0) {
    return {
      system_prompt_percentage: 0,
      retrieval_percentage: 0,
      history_percentage: 0,
      query_percentage: 0,
    };
  }

  return {
    system_prompt_percentage: round((tokens.system_prompt / total) * 100, 2),
    retrieval_percentage: round((tokens.retrieval / total) * 100, 2),
    history_percentage: round((tokens.history / total) * 100, 2),
    query_percentage: round((tokens.query / total) * 100, 2),
  };
}

function resolveLargestComponent(tokens: Record<PromptComponent, number>): {
  component: PromptComponent;
  tokens: number;
} {
  const entries = Object.entries(tokens) as Array<[PromptComponent, number]>;
  const [component, value] = entries.reduce((largest, current) =>
    current[1] > largest[1] ? current : largest,
  );
  return { component, tokens: value };
}

function averagePercentages(
  audits: PromptCompositionAnalysis[],
): Omit<PromptTokenSourceReport, 'request_count' | 'where_are_tokens_coming_from'> {
  const totals = audits.reduce(
    (accumulator, audit) => {
      accumulator.system_prompt_percentage +=
        audit.composition_percentages.system_prompt_percentage;
      accumulator.retrieval_percentage +=
        audit.composition_percentages.retrieval_percentage;
      accumulator.history_percentage +=
        audit.composition_percentages.history_percentage;
      accumulator.query_percentage +=
        audit.composition_percentages.query_percentage;
      return accumulator;
    },
    {
      system_prompt_percentage: 0,
      retrieval_percentage: 0,
      history_percentage: 0,
      query_percentage: 0,
    },
  );

  const count = audits.length;
  return {
    system_prompt_percentage: round(totals.system_prompt_percentage / count, 2),
    retrieval_percentage: round(totals.retrieval_percentage / count, 2),
    history_percentage: round(totals.history_percentage / count, 2),
    query_percentage: round(totals.query_percentage / count, 2),
  };
}

function describeTokenSources(percentages: {
  system_prompt_percentage: number;
  retrieval_percentage: number;
  history_percentage: number;
  query_percentage: number;
}): string {
  const ranked = [
    ['system prompt / instruction template', percentages.system_prompt_percentage],
    ['retrieval context', percentages.retrieval_percentage],
    ['conversation history', percentages.history_percentage],
    ['user query', percentages.query_percentage],
  ].sort((left, right) => (right[1] as number) - (left[1] as number));

  const [topLabel, topPercent] = ranked[0];
  return `Most input tokens are coming from ${topLabel} (${topPercent}% on average).`;
}

function detectMisclassificationSignal(
  audit: PromptCompositionAnalysis,
): {
  request_id: string;
  signal: string;
  actual_input_tokens_from_vertex: number;
  system_prompt_percentage: number;
  retrieval_percentage: number;
} | null {
  const actual = audit.totals.actual_input_tokens_from_vertex ?? 0;
  if (actual < HIGH_TOKEN_THRESHOLD) {
    return null;
  }

  if (
    audit.composition_percentages.system_prompt_percentage >= 70 &&
    audit.composition_percentages.retrieval_percentage <= 5 &&
    audit.retrieval.retrieved_chunks_count === 0 &&
    actual >= HIGH_TOKEN_THRESHOLD
  ) {
    return {
      request_id: audit.request_id,
      signal:
        'High token request with near-zero detected retrieval chunks; large instruction template may be misclassified or retrieval markers missing.',
      actual_input_tokens_from_vertex: actual,
      system_prompt_percentage:
        audit.composition_percentages.system_prompt_percentage,
      retrieval_percentage: audit.composition_percentages.retrieval_percentage,
    };
  }

  if (audit.retrieval.duplicate_chunks_count > 0 && actual >= HIGH_TOKEN_THRESHOLD) {
    return {
      request_id: audit.request_id,
      signal:
        'Duplicate retrieval chunks detected; repeated context may be inflating token usage.',
      actual_input_tokens_from_vertex: actual,
      system_prompt_percentage:
        audit.composition_percentages.system_prompt_percentage,
      retrieval_percentage: audit.composition_percentages.retrieval_percentage,
    };
  }

  if (
    audit.composition_percentages.retrieval_percentage >= 70 &&
    audit.retrieval.retrieved_chunks_count > 0
  ) {
    return {
      request_id: audit.request_id,
      signal:
        'Retrieval context is the dominant token source for this request.',
      actual_input_tokens_from_vertex: actual,
      system_prompt_percentage:
        audit.composition_percentages.system_prompt_percentage,
      retrieval_percentage: audit.composition_percentages.retrieval_percentage,
    };
  }

  return null;
}

function extractEntryText(entry: {
  role?: string;
  parts?: Array<{ text?: string }>;
}): string {
  return (entry.parts ?? [])
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
}

function collectPatternMatches(text: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  const globalPattern = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );

  for (const match of text.matchAll(globalPattern)) {
    const value = (match[1] ?? match[0] ?? '').trim();
    if (value) {
      matches.push(value);
    }
  }

  return matches;
}

function collectQueryMatches(text: string): string[] {
  const matches: string[] = [];

  for (const pattern of QUERY_SECTION_PATTERNS) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      matches.push(value);
    }
  }

  return matches;
}

function removeMatches(text: string, matches: string[]): string {
  let remaining = text;
  for (const match of matches) {
    remaining = remaining.replace(match, '');
  }
  return remaining;
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hashContent(content: string): string {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (hash * 31 + content.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function estimateTokenCount(charCount: number): number {
  if (charCount <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(charCount / 4));
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
