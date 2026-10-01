const DETAIL_KEYWORDS = [
  'detail',
  'detailed',
  'comprehensive',
  'depth',
  'elaborate',
  'full',
  'in-depth',
  'explain more',
];

const SUMMARY_KEYWORDS = [
  'summary',
  'summarize',
  'summarise',
  'brief overview',
  'brief summary',
  'overview',
  'key points',
  'main points',
  'takeaways',
  'key takeaways',
  'simple summary',
];

const DOCUMENT_SCOPED_PATTERNS = [
  /\b(?:section|sec\.?|paragraph|para\.?|clause|sub[-\s]?clause|article|annexure|annex|schedule|item|point)\s*(?:no\.?|number)?\s*[\w()./-]+/i,
  /\b(?:serial|sr\.?|sl\.?)\s*no\.?\s*[\w()./-]+/i,
  /\b(?:under|within|from)\s+(?:the\s+)?['"`]/i,
];

export function isDocumentScopedSummaryQuery(query: string): boolean {
  const queryLower = query.toLowerCase().trim();

  return (
    SUMMARY_KEYWORDS.some((keyword) => queryLower.includes(keyword)) &&
    DOCUMENT_SCOPED_PATTERNS.some((pattern) => pattern.test(query))
  );
}

export function isSummaryQuery(query: string): boolean {
  const queryLower = query.toLowerCase().trim();

  if (DETAIL_KEYWORDS.some((keyword) => queryLower.includes(keyword))) {
    return false;
  }

  if (isDocumentScopedSummaryQuery(query)) {
    return false;
  }

  return SUMMARY_KEYWORDS.some((keyword) => queryLower.includes(keyword));
}

export function hasMetadataSummary(documentChats: any[]): boolean {
  if (!documentChats || documentChats.length === 0) {
    return false;
  }

  for (const docChat of documentChats) {
    const document = docChat.Document;
    const metadata = document?.documentMetaData?.[0];

    if (metadata?.summary) {
      const summary = metadata.summary;
      if (
        typeof summary === 'string' &&
        summary.trim().length > 0 &&
        summary.trim().toLowerCase() !== 'unknown' &&
        summary.trim().toLowerCase() !== 'no summary available'
      ) {
        return true;
      }
    }
  }

  return false;
}

export function shouldUseMetadataSummaryPath(
  query: string,
  documentChats?: any[],
): boolean {
  return isSummaryQuery(query) && hasMetadataSummary(documentChats ?? []);
}
