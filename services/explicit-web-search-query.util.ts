/** Detects when the user explicitly asks to search the web. */

const EXPLICIT_WEB_SEARCH_PATTERNS: RegExp[] = [
  /\bweb\s+search\b/i,
  /\bsearch\s+(?:the\s+)?web\b/i,
  /\bsearch\s+online\b/i,
  /\bsearch\s+(?:on\s+)?(?:the\s+)?internet\b/i,
  /\blook\s+(?:it\s+)?up\s+(?:on\s+)?(?:the\s+)?(?:web|internet)\b/i,
  /\bfind\s+(?:it\s+)?(?:on\s+)?(?:the\s+)?(?:web|internet)\b/i,
];

export function isExplicitWebSearchQuery(query: string): boolean {
  const trimmed = (query ?? '').trim();
  if (!trimmed) {
    return false;
  }

  return EXPLICIT_WEB_SEARCH_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Removes explicit web-search instruction framing so the remaining text is the search topic. */
export function stripExplicitWebSearchFraming(query: string): string {
  const trimmed = (query ?? '').trim();
  if (!trimmed) {
    return '';
  }

  let result = trimmed;

  result = result.replace(
    /^(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:(?:do|run|perform)\s+a\s+)?web\s+search\s+(?:for|about|on)?\s+/i,
    '',
  );
  result = result.replace(
    /^(?:please\s+)?search\s+(?:the\s+)?web\s+(?:for|about|on)?\s+/i,
    '',
  );
  result = result.replace(
    /^(?:please\s+)?search\s+online\s+(?:for|about|on)?\s+/i,
    '',
  );
  result = result.replace(
    /^(?:please\s+)?search\s+(?:on\s+)?(?:the\s+)?internet\s+(?:for|about|on)?\s+/i,
    '',
  );
  result = result.replace(
    /^(?:please\s+)?look\s+(?:it\s+)?up\s+(?:on\s+)?(?:the\s+)?(?:web|internet)\s+(?:for|about|on)?\s*/i,
    '',
  );
  result = result.replace(
    /^(?:please\s+)?find\s+(?:it\s+)?(?:on\s+)?(?:the\s+)?(?:web|internet)\s+(?:for|about|on)?\s*/i,
    '',
  );

  result = result.replace(/\s+/g, ' ').trim();
  return result.length >= 3 ? result : trimmed;
}
