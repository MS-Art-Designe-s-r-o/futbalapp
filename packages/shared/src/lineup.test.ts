import { describe, expect, it } from 'vitest';
import { LINEUP_FORMATS, defaultLineupFormat, matchLineupSchema } from './lineup';

describe('lineup', () => {
  it('formát podľa kategórie', () => {
    expect(defaultLineupFormat('U9')).toBe('4+1');
    expect(defaultLineupFormat('U11')).toBe('6+1');
    expect(defaultLineupFormat('U13')).toBe('8+1');
    expect(defaultLineupFormat('U15')).toBe('10+1');
    expect(defaultLineupFormat(null)).toBe('10+1');
  });
  it('počet postov zodpovedá formátu', () => {
    for (const [k, v] of Object.entries(LINEUP_FORMATS)) {
      const n = k.split('+').reduce((a, b) => a + Number(b), 0);
      for (const f of Object.values(v.formations)) expect(f).toHaveLength(n);
    }
  });
  it('validácia', () => {
    expect(matchLineupSchema.safeParse({ format: '8+1', formation: '3-3-2', slots: { '0': 'a', '1': 'b' } }).success).toBe(true);
    expect(matchLineupSchema.safeParse({ format: '8+1', formation: '3-3-2', slots: { '0': 'a', '1': 'a' } }).success).toBe(false);
    expect(matchLineupSchema.safeParse({ format: '8+1', formation: '3-3-2', slots: { '20': 'a' } }).success).toBe(false);
    expect(matchLineupSchema.safeParse({ format: 'x', formation: '3-3-2', slots: {} }).success).toBe(false);
  });
});
