import {
  isSearchableQuery,
  normalizeAddressQuery,
} from './address-normalizer.js';

describe('normalizeAddressQuery', () => {
  it('lower-cases, collapses whitespace and strips punctuation', () => {
    expect(normalizeAddressQuery('  Невский  проспект, 45. ')).toBe(
      'невский проспект 45',
    );
  });

  it('folds ё to е so equivalent spellings collapse', () => {
    expect(normalizeAddressQuery('Королёва')).toBe(
      normalizeAddressQuery('Королева'),
    );
  });

  it('produces the same key for punctuation and spacing variants', () => {
    expect(normalizeAddressQuery('спб, невский, 45')).toBe(
      normalizeAddressQuery('СПБ  Невский 45'),
    );
  });
});

describe('isSearchableQuery', () => {
  it('rejects queries shorter than three meaningful characters', () => {
    expect(isSearchableQuery('  а ')).toBe(false);
    expect(isSearchableQuery('..')).toBe(false);
  });

  it('accepts queries with at least three characters', () => {
    expect(isSearchableQuery('спб')).toBe(true);
  });
});
