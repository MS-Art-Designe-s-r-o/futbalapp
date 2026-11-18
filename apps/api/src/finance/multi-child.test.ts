import { describe, expect, it } from 'vitest';
import { orderMultiChildObligations, parseSpecificSymbolBirthDate, splitAmount, type OpenObligation } from './multi-child';

const ob = (id: string, memberId: string, vs: string, openCents: number): OpenObligation => ({ id, memberId, variableSymbol: vs, openCents });

describe('parseSpecificSymbolBirthDate', () => {
  it('8 aj 9 číslic, ostatné ignoruje', () => {
    expect(parseSpecificSymbolBirthDate('03012009')?.toISOString()).toBe('2009-01-03T00:00:00.000Z');
    expect(parseSpecificSymbolBirthDate(' 030120092 ')?.toISOString()).toBe('2009-01-03T00:00:00.000Z');
    expect(parseSpecificSymbolBirthDate('123')).toBeNull();
    expect(parseSpecificSymbolBirthDate('1234567890')).toBeNull();
    expect(parseSpecificSymbolBirthDate('31022016')).toBeNull();
    expect(parseSpecificSymbolBirthDate(undefined)).toBeNull();
  });
});

describe('rozdelenie platby za dve deti', () => {
  const a = [ob('a1', 'A', '140520160', 2500), ob('a2', 'A', '140520162', 6000)];
  const b = [ob('b1', 'B', '030120090', 2500), ob('b2', 'B', '030120092', 6000)];
  const bd = new Date(Date.UTC(2009, 0, 3));

  it('B s kódom z VS platby je pred ostatnými A', () => {
    const o = orderMultiChildObligations('140520160', a, b, bd);
    expect(o.map((x) => x.id)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });
  it('suma presne pokryje obe deti', () => {
    const r = splitAmount(5000, orderMultiChildObligations('140520160', a, b, bd));
    expect(r.allocations.map((x) => [x.obligationId, x.cents])).toEqual([['a1', 2500], ['b1', 2500]]);
    expect(r.remainingCents).toBe(0);
  });
  it('suma pokryje len časť A', () => {
    const r = splitAmount(1000, orderMultiChildObligations('140520160', a, b, bd));
    expect(r.allocations).toEqual([{ obligationId: 'a1', memberId: 'A', cents: 1000 }]);
  });
  it('prebytok ide na ostatné povinnosti', () => {
    const r = splitAmount(9000, orderMultiChildObligations('140520160', a, b, bd));
    expect(r.allocations.map((x) => [x.obligationId, x.cents])).toEqual([['a1', 2500], ['b1', 2500], ['a2', 4000]]);
    const r2 = splitAmount(20000, orderMultiChildObligations('140520160', a, b, bd));
    expect(r2.remainingCents).toBe(20000 - 17000);
  });
  it('bez 9-ciferného VS ide B oldest-first', () => {
    const o = orderMultiChildObligations('12345', a, [ob('bx', 'B', '999', 100)], bd);
    expect(o.map((x) => x.id)).toEqual(['bx', 'a1', 'a2']);
  });
});
