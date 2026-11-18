import { describe, expect, it } from 'vitest';
import { generateVariableSymbol, parseVariableSymbol, periodLabel } from './payments';

describe('variabilný symbol', () => {
  it('generuje RRMM + 6-miestne poradové číslo člena', () => {
    expect(generateVariableSymbol(42, { year: 2026, month: 9 })).toBe('2609000042');
    expect(generateVariableSymbol(999999, { year: 2027, month: 12 })).toBe('2712999999');
  });

  it('parse je inverzný ku generovaniu', () => {
    const vs = generateVariableSymbol(123, { year: 2026, month: 1 });
    expect(parseVariableSymbol(vs)).toEqual({ year2: 26, month: 1, memberSeq: 123 });
  });

  it('odmietne neplatné vstupy', () => {
    expect(() => generateVariableSymbol(0, { year: 2026, month: 9 })).toThrow();
    expect(() => generateVariableSymbol(1_000_000, { year: 2026, month: 9 })).toThrow();
    expect(() => generateVariableSymbol(1, { year: 2026, month: 13 })).toThrow();
    expect(parseVariableSymbol('abc')).toBeNull();
    expect(parseVariableSymbol('2613000001')).toBeNull(); // mesiac 13
  });

  it('periodLabel formátuje obdobie', () => {
    expect(periodLabel(2026, 9)).toBe('2026-09');
  });
});

import { paymentVariableSymbol, parsePaymentVariableSymbol } from './payments';

describe('paymentVariableSymbol', () => {
  it('doplní registračné číslo nulami a pridá MMRR', () => {
    expect(paymentVariableSymbol('123', { year: 2026, month: 9 })).toBe('00001230926');
  });
  it('odstráni nečíselné znaky', () => {
    expect(paymentVariableSymbol('KNV-42/A', { year: 2027, month: 12 })).toBe('00000421227');
  });
  it('vráti null bez číslic', () => {
    expect(paymentVariableSymbol(null, { year: 2026, month: 1 })).toBeNull();
    expect(paymentVariableSymbol('ABC', { year: 2026, month: 1 })).toBeNull();
  });
  it('parsuje späť', () => {
    expect(parsePaymentVariableSymbol('00001230926')).toEqual({ registrationDigits: '123', month: 9, year2: 26 });
    expect(parsePaymentVariableSymbol('2609000042')).toBeNull();
  });
});

import { birthDateVariableSymbol, parseBirthDateVariableSymbol, FEE_PRESETS } from './payments';
describe('VS podľa dátumu narodenia', () => {
  it('generuje DDMMRRRR + kód predpisu', () => {
    expect(birthDateVariableSymbol(new Date(Date.UTC(2016, 4, 14)), 2)).toBe('140520162');
    expect(birthDateVariableSymbol('2009-01-03T00:00:00Z', 0)).toBe('030120090');
  });
  it('parse je inverzný a odmietne neplatné dátumy', () => {
    expect(parseBirthDateVariableSymbol('140520162')).toEqual({ day: 14, month: 5, year: 2016, code: 2 });
    expect(parseBirthDateVariableSymbol('310220161')).toBeNull();
    expect(parseBirthDateVariableSymbol('1234567890')).toBeNull();
  });
  it('kód mimo 0..9 a neplatný dátum zlyhá; prednastavené kódy sú 1..3', () => {
    expect(() => birthDateVariableSymbol(new Date(), 10)).toThrow();
    expect(() => birthDateVariableSymbol('x', 1)).toThrow();
    expect(FEE_PRESETS.map((p) => p.vsCode)).toEqual([1, 2, 3]);
  });
});
