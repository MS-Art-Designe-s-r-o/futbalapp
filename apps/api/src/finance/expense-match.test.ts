import { describe, expect, it } from 'vitest';
import { pickExpenseMatch, periodRange } from './finance.service';

const e = (payee: string, variableSymbol: string | null = null, iban: string | null = null) => ({ payee, variableSymbol, iban });

describe('pickExpenseMatch', () => {
  it('uprednostní VS', () => {
    const a = e('A', '123');
    const b = e('B', '456');
    expect(pickExpenseMatch([a, b], { variableSymbol: '0456' })).toBe(b);
  });
  it('potom IBAN', () => {
    const a = e('A', null, 'SK12 3456');
    expect(pickExpenseMatch([a], { counterpartyIban: 'sk123456' })).toBe(a);
  });
  it('potom názov bez diakritiky', () => {
    const a = e('Športové potreby s.r.o.');
    expect(pickExpenseMatch([a], { counterpartyName: 'SPORTOVE POTREBY SRO' })).toBeUndefined();
    expect(pickExpenseMatch([e('Športové potreby')], { counterpartyName: 'SPORTOVE POTREBY s.r.o.' })).toBeDefined();
  });
  it('bez zhody undefined', () => {
    expect(pickExpenseMatch([e('X', '1')], { variableSymbol: '2', counterpartyName: 'Y' })).toBeUndefined();
  });
});

describe('periodRange', () => {
  it('rok a mesiac', () => {
    expect(periodRange(2026).lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(periodRange(2026, 12).lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(periodRange(2026, 2).gte.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
});
