/**
 * Normalizes free-text address queries so semantically identical inputs collapse
 * to one cache key and one provider call. Kept pure and dependency-free so it is
 * cheap to unit-test.
 */
export function normalizeAddressQuery(raw: string): string {
  return (
    raw
      .toLowerCase()
      // Cyrillic ё → е so "Королёва"/"Королева" match.
      .replace(/ё/g, 'е')
      // Drop punctuation that never changes the place.
      .replace(/[.,;]+/g, ' ')
      // Collapse all whitespace runs to a single space.
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Minimum query length before a search is worth sending to a provider. */
export const MIN_ADDRESS_QUERY_LENGTH = 3;

/**
 * True when a query is long enough to search. Guards both the controller and
 * the provider so a one-character keystroke never hits the network.
 */
export function isSearchableQuery(raw: string): boolean {
  return normalizeAddressQuery(raw).length >= MIN_ADDRESS_QUERY_LENGTH;
}
