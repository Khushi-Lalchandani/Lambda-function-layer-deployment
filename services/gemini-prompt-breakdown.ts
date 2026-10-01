export interface GeminiPromptBreakdown {
  system_prompt_tokens: number;
  history_tokens: number;
  retrieval_tokens: number;
  query_tokens: number;
}

export interface PromptBreakdownMonitoringContext {
  prompt_breakdown?: Partial<GeminiPromptBreakdown>;
}

export interface PromptBreakdownInput {
  contents:
    | string
    | Array<{ role?: string; parts?: Array<{ text?: string }> }>;
  config?: {
    systemInstruction?: string;
    [key: string]: unknown;
  };
  monitoring?: PromptBreakdownMonitoringContext;
}

interface CharacterSegments {
  system: number;
  history: number;
  retrieval: number;
  query: number;
}

const HISTORY_SECTION_PATTERN =
  /previous conversation context:\s*([\s\S]*?)(?=\n\n(?:critical|question:|user query:|query:|input query:|current question:|context from|answer:|candidates:|respond with|$))/gi;

const RETRIEVAL_SOURCE_BLOCK_PATTERN =
  /\[source:[^\]]+\][\s\S]*?(?=(?:\n\n---\n\n)|(?:\n\[source:)|$)/gi;

const RETRIEVAL_CONTEXT_SECTION_PATTERN =
  /(?:context from legal documents:|retrieved document chunks:|document chunks:)\s*([\s\S]*?)(?=\n\n(?:previous conversation|question:|user query:|query:|input query:|current question:|answer:|respond with)|$)/gi;

const QUERY_SECTION_PATTERNS = [
  /(?:^|\n)question:\s*(.+?)(?:\n\n|\nanswer:|\ncontext|$)/is,
  /user query:\s*"([^"]+)"/i,
  /(?:^|\n)query:\s*"([^"]+)"/i,
  /input query:\s*"([^"]+)"/i,
  /current question:\s*(.+?)(?:\n|$)/is,
  /(?:^|\n)query:\s*(.+?)(?:\n\n|\ncandidates:|$)/is,
];

export function extractPromptBreakdown(
  params: PromptBreakdownInput,
  actualPromptTokens?: number,
): GeminiPromptBreakdown {
  const explicit = params.monitoring?.prompt_breakdown;
  if (isCompleteBreakdown(explicit)) {
    return explicit;
  }

  const segments = analyzeCharacterSegments(params);
  const estimated = scaleCharacterSegmentsToTokens(
    segments,
    actualPromptTokens,
  );

  if (!explicit) {
    return estimated;
  }

  return {
    system_prompt_tokens:
      explicit.system_prompt_tokens ?? estimated.system_prompt_tokens,
    history_tokens: explicit.history_tokens ?? estimated.history_tokens,
    retrieval_tokens:
      explicit.retrieval_tokens ?? estimated.retrieval_tokens,
    query_tokens: explicit.query_tokens ?? estimated.query_tokens,
  };
}

function analyzeCharacterSegments(params: PromptBreakdownInput): CharacterSegments {
  const systemChars = (params.config?.systemInstruction ?? '').length;
  const { modelHistoryText, userTexts } = splitContents(params.contents);

  let historyChars = modelHistoryText.length;
  let retrievalChars = 0;
  let queryChars = 0;
  let templateChars = 0;

  for (const userText of userTexts) {
    let remaining = userText;
    const historyMatches = collectPatternMatches(
      remaining,
      HISTORY_SECTION_PATTERN,
    );
    historyChars += sumLength(historyMatches);
    remaining = removeMatches(remaining, historyMatches);

    const retrievalMatches = [
      ...collectPatternMatches(remaining, RETRIEVAL_SOURCE_BLOCK_PATTERN),
      ...collectPatternMatches(remaining, RETRIEVAL_CONTEXT_SECTION_PATTERN),
    ];
    retrievalChars += sumLength(retrievalMatches);
    remaining = removeMatches(remaining, retrievalMatches);

    const queryMatches = collectQueryMatches(remaining);
    queryChars += sumLength(queryMatches);
    remaining = removeMatches(remaining, queryMatches);

    templateChars += remaining.trim().length;
  }

  if (queryChars === 0 && userTexts.length > 0) {
    const lastUserText = userTexts[userTexts.length - 1]?.trim() ?? '';
    if (lastUserText.length > 0 && lastUserText.length <= 500) {
      queryChars = lastUserText.length;
      templateChars = Math.max(0, templateChars - queryChars);
    }
  }

  return {
    system: systemChars + templateChars,
    history: historyChars,
    retrieval: retrievalChars,
    query: queryChars,
  };
}

function scaleCharacterSegmentsToTokens(
  segments: CharacterSegments,
  actualPromptTokens?: number,
): GeminiPromptBreakdown {
  const estimated = {
    system_prompt_tokens: estimateTokenCount(segments.system),
    history_tokens: estimateTokenCount(segments.history),
    retrieval_tokens: estimateTokenCount(segments.retrieval),
    query_tokens: estimateTokenCount(segments.query),
  };

  if (actualPromptTokens == null || actualPromptTokens <= 0) {
    return estimated;
  }

  const estimatedTotal =
    estimated.system_prompt_tokens +
    estimated.history_tokens +
    estimated.retrieval_tokens +
    estimated.query_tokens;

  if (estimatedTotal <= 0) {
    return {
      system_prompt_tokens: actualPromptTokens,
      history_tokens: 0,
      retrieval_tokens: 0,
      query_tokens: 0,
    };
  }

  const scale = actualPromptTokens / estimatedTotal;
  const scaled = {
    system_prompt_tokens: Math.round(estimated.system_prompt_tokens * scale),
    history_tokens: Math.round(estimated.history_tokens * scale),
    retrieval_tokens: Math.round(estimated.retrieval_tokens * scale),
    query_tokens: Math.round(estimated.query_tokens * scale),
  };

  const drift =
    actualPromptTokens -
    (scaled.system_prompt_tokens +
      scaled.history_tokens +
      scaled.retrieval_tokens +
      scaled.query_tokens);

  scaled.query_tokens += drift;

  return scaled;
}

function splitContents(
  contents: PromptBreakdownInput['contents'],
): { modelHistoryText: string; userTexts: string[] } {
  if (typeof contents === 'string') {
    return { modelHistoryText: '', userTexts: [contents] };
  }

  const modelParts: string[] = [];
  const userTexts: string[] = [];

  for (const entry of contents ?? []) {
    const text = extractEntryText(entry);
    if (!text) {
      continue;
    }

    if (entry.role === 'model') {
      modelParts.push(text);
      continue;
    }

    userTexts.push(text);
  }

  return {
    modelHistoryText: modelParts.join('\n\n'),
    userTexts,
  };
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

function sumLength(values: string[]): number {
  return values.reduce((sum, value) => sum + value.length, 0);
}

function estimateTokenCount(charCount: number): number {
  if (charCount <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(charCount / 4));
}

function isCompleteBreakdown(
  breakdown?: Partial<GeminiPromptBreakdown>,
): breakdown is GeminiPromptBreakdown {
  return (
    breakdown?.system_prompt_tokens != null &&
    breakdown?.history_tokens != null &&
    breakdown?.retrieval_tokens != null &&
    breakdown?.query_tokens != null
  );
}
