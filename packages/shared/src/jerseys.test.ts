import { describe, expect, it } from 'vitest';
import { formatJerseys, resolveJerseys } from './enums';

describe('dresy', () => {
  it('formatJerseys', () => {
    expect(formatJerseys(['LIGHT'])).toBe('biely');
    expect(formatJerseys(['DARK'])).toBe('modrý');
    expect(formatJerseys(['DARK', 'LIGHT'])).toBe('biely a modrý (hráči prinesú oba)');
    expect(formatJerseys([])).toBeNull();
    expect(formatJerseys(null)).toBeNull();
  });
  it('resolveJerseys: nové pole, staré pole, nič', () => {
    expect(resolveJerseys({ jerseyColors: ['DARK'] })).toEqual({ jerseyColors: ['DARK'], jerseyColor: 'DARK' });
    expect(resolveJerseys({ jerseyColors: ['DARK', 'LIGHT'] })).toEqual({ jerseyColors: ['DARK', 'LIGHT'], jerseyColor: null });
    expect(resolveJerseys({ jerseyColors: [] })).toEqual({ jerseyColors: [], jerseyColor: null });
    expect(resolveJerseys({ jerseyColor: 'LIGHT' })).toEqual({ jerseyColors: ['LIGHT'], jerseyColor: 'LIGHT' });
    expect(resolveJerseys({ jerseyColor: null })).toEqual({ jerseyColors: [], jerseyColor: null });
    expect(resolveJerseys({})).toBeUndefined();
  });
});
