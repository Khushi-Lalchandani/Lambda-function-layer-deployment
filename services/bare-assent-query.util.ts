/** Matches bare affirmative follow-ups with no other substantive content. */
export function isBareAssentQuery(query: string): boolean {
  const trimmed = (query ?? '').trim();
  if (!trimmed) {
    return false;
  }

  return /^(?:yes|yeah|yep|ok|okay|sure|go ahead|please do|please|affirmative)(?:\s+please)?\s*[!.?]*$/i.test(
    trimmed,
  );
}
