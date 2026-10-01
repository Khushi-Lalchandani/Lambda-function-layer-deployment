/** Shared chronology intent detection for query routing. */

export const CHRONOLOGY_INTENT_PATTERN =
  /(?:\bchronolog(?:y|ical)\b|(?:case\s+)?timeline(?:\s+of)?|date[- ]?wise\s+events?|sequence\s+of\s+events|order\s+of\s+events|what\s+happened\s+on|events?\s+with\s+dates|list\s+all\s+events|chronological\s+events)/i;

const NON_CHRONOLOGY_TIME_CONTEXT_PATTERN =
  /(?:delay|delayed|limitation|time[- ]?bar(?:red|ring)?|deadline|due\s+date|statutory\s+timeline|within\s+\d+\s+days?|after\s+\d+\s+days?|prescribed\s+time|non[- ]?compliance|compliance|penalty|consequence|writ|mandamus|grounds?|justified)/i;

const PURE_CHRONOLOGY_PATTERNS = [
  /^(?:give me|show me|provide(?: me)?|list|share|get|tell me)\s+(?:the\s+)?(?:full\s+|complete\s+|entire\s+)?(?:case\s+)?chronolog(?:y|ical)/i,
  /^(?:give me|show me|provide)\s+(?:the\s+)?(?:date[- ]?wise\s+)?(?:events?|timeline)/i,
  /^what(?:'s| is)\s+the\s+(?:case\s+)?chronolog(?:y|ical)/i,
  /\bchronolog(?:y|ical)\s+of\s+(?:the\s+)?(?:entire\s+)?case\b/i,
  /\btimeline\s+of\s+(?:the\s+)?(?:entire\s+)?case\b/i,
  /\b(?:entire|full|complete)\s+case\s+(?:chronolog(?:y|ical)|timeline)\b/i,
];

const ADDITIONAL_DOCUMENT_INTENT_PATTERN =
  /\b(?:overview|summary|summarize|summarise|analysis|analyse|analyze|key\s+issues?|evidence|findings?|arguments?|what|who|how|why|where|which|explain|describe|tell|is|are|was|were|can|does|did|amount|penalty|relief|petitioner|respondent|section|order|payment|parties|liability|damages)\b/i;

const MIXED_CHRONOLOGY_PATTERNS = [
  /\b(?:timeline|chronolog(?:y|ical)|date[- ]?wise|events?\s+with\s+dates|sequence\s+of\s+events)\b[^?.]{0,200}\b(?:and|&|,)\b[^?.]{0,200}\b(?:overview|summary|summarize|summarise|analysis|analyse|analyze|key\s+issues?|evidence|findings?|arguments?|what|who|how|why|where|which|explain|describe|tell|is|are|was|were|can|does|did|amount|penalty|relief|petitioner|respondent|section|order|payment|parties|liability|damages)\b/i,
  /\b(?:overview|summary|summarize|summarise|analysis|analyse|analyze|key\s+issues?|evidence|findings?|arguments?|what|who|how|why|where|which|explain|describe|tell)\b[^?.]{0,200}\b(?:and|&|,)\b[^?.]{0,200}\b(?:timeline|chronolog(?:y|ical)|date[- ]?wise|sequence\s+of\s+events)\b/i,
  /\b(?:also|as well as|in addition to)\b/i,
];

const STRIP_PHRASES_FOR_REMAINDER = [
  'date-wise',
  'date wise',
  'chronology',
  'chronological',
  'timeline',
  'sequence of events',
  'what happened on',
  'events with dates',
  'all dates',
  'list all events',
  'timeline of',
  'chronological events',
  'what are the dates',
  'important dates',
  'order of events',
  'give me',
  'show me',
  'provide me',
  'tell me',
  'list',
  'share',
  'get',
  'the',
  'a',
  'an',
  'of',
  'this',
  'case',
  'entire',
  'full',
  'complete',
  'please',
  'kindly',
  'events',
  'dates',
];

export function hasChronologyIntent(
  query: string,
  queryType?: string,
): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }

  if (queryType === 'chronological') {
    return true;
  }

  if (!CHRONOLOGY_INTENT_PATTERN.test(trimmed)) {
    return false;
  }

  // Guard against legal "timeline/deadline/delay" discussions that are not asking for ordered events.
  const hasOrderingSignal =
    /\b(chronolog(?:y|ical)|timeline|date[- ]?wise|sequence\s+of\s+events|order\s+of\s+events|list\s+all\s+events|events?\s+with\s+dates|what\s+happened\s+on)\b/i.test(
      trimmed,
    );
  if (!hasOrderingSignal) {
    return false;
  }

  return !NON_CHRONOLOGY_TIME_CONTEXT_PATTERN.test(trimmed);
}

export function isGeneralCaseSummaryQuery(query: string): boolean {
  const trimmed = query.trim();
  return (
    /^(tell me about|what is|give me.*(?:summary|overview)|describe|explain)\s+(this\s+)?case/i.test(
      trimmed,
    ) ||
    /^give me\s+(?:a\s+)?(?:quick\s+)?overview\s+of\s+(?:this\s+)?case/i.test(
      trimmed,
    )
  );
}

/**
 * True when the user asks ONLY for dates/timeline/chronology (metadata path).
 * Example: "Give me the chronology of the entire case."
 */
export function isChronologyOnlyQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed || !hasChronologyIntent(query)) {
    return false;
  }

  // Mixed intents must be detected before pure chronology patterns — e.g.
  // "Give me the chronology of this entire case and also give me overview"
  if (MIXED_CHRONOLOGY_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }

  if ((trimmed.match(/\?/g) ?? []).length > 1) {
    return false;
  }

  if (PURE_CHRONOLOGY_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  let remainder = trimmed.toLowerCase();
  for (const phrase of STRIP_PHRASES_FOR_REMAINDER) {
    remainder = remainder.split(phrase).join(' ');
  }
  remainder = remainder
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const meaningfulWords = remainder
    .split(' ')
    .filter((word) => word.length > 2);

  return meaningfulWords.length <= 2;
}

export function hasAdditionalDocumentIntents(query: string): boolean {
  return ADDITIONAL_DOCUMENT_INTENT_PATTERN.test(query.trim());
}

/** Full = user wants entire case timeline; scoped = filter to query-relevant events only. */
export function resolveChronologyScope(query: string): 'full' | 'scoped' {
  return isChronologyOnlyQuery(query) ? 'full' : 'scoped';
}
