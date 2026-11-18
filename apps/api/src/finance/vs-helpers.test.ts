import { describe, expect, it } from 'vitest';
import { decideVsMatch, nextPlanVsCode, obligationVariableSymbol } from './vs-helpers';

const d = new Date(Date.UTC(2016, 4, 14));

describe('obligationVariableSymbol', () => {
  it('dátum narodenia + kód', () => {
    expect(obligationVariableSymbol({ birthDate: d, memberSeq: 5, registrationNumber: '123' }, { vsCode: 2 }, { year: 2026, month: 9 })).toBe('140520162');
    expect(obligationVariableSymbol({ birthDate: d, memberSeq: 5 }, { vsCode: 0 }, { year: 2026, month: 9 })).toBe('140520160');
  });
  it('bez dátumu: reg. číslo', () => {
    expect(obligationVariableSymbol({ birthDate: null, memberSeq: 5, registrationNumber: '123' }, { vsCode: 0 }, { year: 2026, month: 9 })).toBe('00001230926');
  });
  it('bez dátumu a reg. čísla: RRMM + memberSeq', () => {
    expect(obligationVariableSymbol({ birthDate: null, memberSeq: 42, registrationNumber: null }, { vsCode: 0 }, { year: 2026, month: 9 })).toBe('2609000042');
  });
});

describe('nextPlanVsCode', () => {
  it('mesačný → 0', () => expect(nextPlanVsCode('MONTHLY', [0, 4])).toBe(0));
  it('najnižší voľný 4..9', () => {
    expect(nextPlanVsCode('ONE_TIME', [0, 1, 2])).toBe(4);
    expect(nextPlanVsCode('SEASON', [4, 5, 7])).toBe(6);
  });
  it('všetky obsadené → 9', () => expect(nextPlanVsCode('ONE_TIME', [4, 5, 6, 7, 8, 9])).toBe(9));
});

describe('decideVsMatch', () => {
  it('jediný vlastník povinnosti', () => {
    expect(decideVsMatch(['a', 'a'], ['b'])).toEqual({ kind: 'member', memberId: 'a', preferExactVs: true });
  });
  it('viac členov s rovnakým VS → nejednoznačné', () => {
    expect(decideVsMatch(['a', 'b'], ['a'])).toEqual({ kind: 'ambiguous' });
  });
  it('bez povinnosti: jediný člen s dátumom narodenia', () => {
    expect(decideVsMatch([], ['c'])).toEqual({ kind: 'member', memberId: 'c', preferExactVs: false });
  });
  it('bez povinnosti a viac/žiadny člen s dátumom → none', () => {
    expect(decideVsMatch([], ['c', 'd'])).toEqual({ kind: 'none' });
    expect(decideVsMatch([], [])).toEqual({ kind: 'none' });
  });
});
