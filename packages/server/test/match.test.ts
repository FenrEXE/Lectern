import { describe, expect, it } from 'vitest';
import {
  correctQuery,
  coverage,
  editDistance,
  normalizeText,
  titleSimilarity,
  wordSimilarity,
} from '@lectern/shared';

describe('normalizeText', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeText('  The Well of Ascension! ')).toBe('the well of ascension');
    expect(normalizeText('Brontë & Co.')).toBe('bronte and co');
  });
});

describe('editDistance', () => {
  it('counts edits, with a swap costing one', () => {
    expect(editDistance('sanderson', 'sandersen')).toBe(1);
    expect(editDistance('teh', 'the')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('wordSimilarity', () => {
  it('tolerates small typos and prefixes', () => {
    expect(wordSimilarity('sandersen', 'sanderson')).toBeGreaterThan(0.85);
    expect(wordSimilarity('mistbron', 'mistborn')).toBeGreaterThan(0.8);
    expect(wordSimilarity('sand', 'sanderson')).toBe(0.9);
  });

  it('rejects unrelated words and different numbers', () => {
    expect(wordSimilarity('dragon', 'empire')).toBe(0);
    expect(wordSimilarity('2', '3')).toBe(0);
    expect(wordSimilarity('cat', 'car')).toBe(0);
  });
});

describe('coverage', () => {
  it('scores a typo-ridden query against the right book highly', () => {
    const text = 'Mistborn: The Final Empire Brandon Sanderson Mistborn';
    expect(coverage('brandon sandersen mistborn', text)).toBeGreaterThan(0.9);
    expect(coverage('brandon sandersen mistborn', 'The Hobbit J. R. R. Tolkien')).toBeLessThan(0.2);
  });
});

describe('titleSimilarity', () => {
  it('matches titles with or without a series prefix', () => {
    expect(titleSimilarity('The Final Empire', 'Mistborn: The Final Empire')).toBeGreaterThan(0.7);
    expect(titleSimilarity('The Final Empire', 'The Well of Ascension')).toBeLessThan(0.3);
  });
});

describe('correctQuery', () => {
  it('fixes typos using the best match', () => {
    expect(correctQuery('brandon sandersen mistbron', 'Mistborn The Final Empire Brandon Sanderson')).toBe(
      'brandon sanderson mistborn',
    );
  });

  it('leaves correct queries and prefixes alone', () => {
    expect(correctQuery('brandon sanderson', 'Brandon Sanderson')).toBeUndefined();
    expect(correctQuery('sand', 'Brandon Sanderson')).toBeUndefined();
  });
});

describe('authors and languages', () => {
  it('treats initials the same however they are written, but not different initials', async () => {
    const { sameAuthor, languageId, languageMatches } = await import('@lectern/shared');
    expect(sameAuthor('R.J. Knight', 'R. J. Knight')).toBe(true);
    expect(sameAuthor('rj knight', 'R.J. Knight')).toBe(true);
    expect(sameAuthor('R. Knight', 'R.J. Knight')).toBe(false);
    expect(sameAuthor('R. Knight', 'A.R. Knight')).toBe(false);
    expect(sameAuthor('Elsie Silver', 'elsie  silver')).toBe(true);
    expect(languageId('en-GB')).toBe('english');
    expect(languageId('ENG')).toBe('english');
    expect(languageMatches('german', 'english')).toBe(false);
    expect(languageMatches(undefined, 'english')).toBe(true); // unknown: kept
    expect(languageMatches('german', 'any')).toBe(true);
  });
});
