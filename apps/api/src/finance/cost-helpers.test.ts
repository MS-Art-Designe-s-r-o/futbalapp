import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { aggregateCosts, filterSortDebits, planMatch, validateCostFields } from './cost-helpers';
import { FinanceService } from './finance.service';

const base = { costItem: null, kind: null, period: null, description: null };

describe('validateCostFields', () => {
  it('voľný výdavok bez položky je ok', () => expect(() => validateCostFields(base)).not.toThrow());
  it('položka vyžaduje obdobie', () => {
    expect(() => validateCostFields({ ...base, costItem: { hasKinds: false } })).toThrow(BadRequestException);
    expect(() => validateCostFields({ ...base, costItem: { hasKinds: false }, period: '2026-11' })).not.toThrow();
  });
  it('zlý formát obdobia', () => {
    expect(() => validateCostFields({ ...base, costItem: { hasKinds: false }, period: '2026-13' })).toThrow();
  });
  it('druh povinný pri hasKinds', () => {
    expect(() => validateCostFields({ ...base, costItem: { hasKinds: true }, period: '2026-11' })).toThrow();
    expect(() => validateCostFields({ ...base, costItem: { hasKinds: true }, period: '2026-11', kind: 'RENT' })).not.toThrow();
  });
  it('druh zakázaný bez hasKinds', () => {
    expect(() => validateCostFields({ ...base, costItem: { hasKinds: false }, period: '2026-11', kind: 'RENT' })).toThrow();
  });
  it('OTHER vyžaduje popis', () => {
    const i = { ...base, costItem: { hasKinds: true }, period: '2026-11', kind: 'OTHER' };
    expect(() => validateCostFields(i)).toThrow('Pri ostatných nákladoch doplňte popis');
    expect(() => validateCostFields({ ...i, description: 'Oprava' })).not.toThrow();
  });
});

const tx = (id: string, amountCents: number, date: string, name: string | null = null, msg: string | null = null) => ({
  id, date: new Date(date), amountCents, counterpartyName: name, counterpartyIban: null, variableSymbol: null, message: msg,
});

describe('filterSortDebits', () => {
  const rows = [tx('a', -1000, '2026-01-01', 'Plynárne'), tx('b', -5000, '2026-03-01', 'Škola'), tx('c', -1000, '2026-02-01', null, 'plyn')];
  it('q bez diakritiky', () => expect(filterSortDebits(rows, { q: 'skola' }).map((r) => r.id)).toEqual(['b']));
  it('suma najprv, potom dátum', () =>
    expect(filterSortDebits(rows, { amountCents: 1000 }).map((r) => r.id)).toEqual(['c', 'a', 'b']));
  it('bez parametrov dátum zostupne', () => expect(filterSortDebits(rows, {}).map((r) => r.id)).toEqual(['b', 'c', 'a']));
});

describe('planMatch', () => {
  const exp = { id: 'e1', amountCents: 1000 };
  it('zhoda sumy', () => expect(planMatch(exp, { amountCents: -1000 }, null)).toEqual({ deleteExpenseId: null }));
  it('409 pri nezhode', () => {
    try {
      planMatch(exp, { amountCents: -900 }, null);
      throw new Error('no');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      expect((e as ConflictException).getResponse()).toMatchObject({ code: 'AMOUNT_MISMATCH', expenseCents: 1000, txCents: 900 });
    }
  });
  it('force obíde nezhodu', () => expect(planMatch(exp, { amountCents: -900 }, null, true).deleteExpenseId).toBeNull());
  it('zlúči auto výdavok', () =>
    expect(planMatch(exp, { amountCents: -1000 }, { id: 'auto', costItemId: null })).toEqual({ deleteExpenseId: 'auto' }));
  it('iný nákladový výdavok -> 400', () =>
    expect(() => planMatch(exp, { amountCents: -1000 }, { id: 'x', costItemId: 'i' })).toThrow(BadRequestException));
});

describe('aggregateCosts', () => {
  const g = { id: 'g1', name: 'Tribúna' };
  it('sčíta podľa skupiny a položky', () => {
    const r = aggregateCosts([
      { amountCents: 100, kind: null, costItem: { name: 'Plyn', group: g } },
      { amountCents: 50, kind: null, costItem: { name: 'Plyn', group: g } },
      { amountCents: 70, kind: 'RENT', costItem: { name: 'Hala', group: { id: 'g2', name: 'Trávnik' } } },
      { amountCents: 999, kind: null, costItem: null },
    ]);
    expect(r.totalPaidCents).toBe(220);
    expect(r.byGroup).toEqual([{ groupId: 'g1', group: 'Tribúna', cents: 150 }, { groupId: 'g2', group: 'Trávnik', cents: 70 }]);
    expect(r.byItem[0]).toEqual({ group: 'Tribúna', item: 'Plyn', kind: null, cents: 150 });
  });
});

describe('FinanceService.matchExpense / unmatchExpense', () => {
  it('zlúči auto výdavok v transakcii a nastaví MANUAL', async () => {
    const calls: string[] = [];
    const db = {
      expense: {
        delete: vi.fn(async () => calls.push('delete')),
        update: vi.fn(async ({ data }: { data: unknown }) => (calls.push('update'), data)),
      },
    };
    const prisma = {
      expense: { findUnique: vi.fn(async () => ({ id: 'e1', amountCents: 1000 })) },
      bankTransaction: {
        findUnique: vi.fn(async () => ({ id: 't1', amountCents: -1000, date: new Date('2026-02-02'), expense: { id: 'auto', costItemId: null } })),
      },
      $transaction: vi.fn(async (fn: (d: typeof db) => unknown) => fn(db)),
    };
    const svc = new FinanceService(prisma as never);
    const r = (await svc.matchExpense('e1', 't1')) as unknown as Record<string, unknown>;
    expect(calls).toEqual(['delete', 'update']);
    expect(r).toMatchObject({ status: 'PAID', bankTransactionId: 't1', matchedBy: 'MANUAL' });
  });
  it('nezhoda sumy hodí 409 bez zápisu', async () => {
    const prisma = {
      expense: { findUnique: vi.fn(async () => ({ id: 'e1', amountCents: 1000 })) },
      bankTransaction: { findUnique: vi.fn(async () => ({ id: 't1', amountCents: -800, date: new Date(), expense: null })) },
      $transaction: vi.fn(),
    };
    await expect(new FinanceService(prisma as never).matchExpense('e1', 't1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('unmatch vynuluje väzbu', async () => {
    const update = vi.fn(async (a: unknown) => a);
    const prisma = { expense: { findUnique: vi.fn(async () => ({ id: 'e1' })), update } };
    await new FinanceService(prisma as never).unmatchExpense('e1');
    expect(update.mock.calls[0]![0]).toMatchObject({
      data: { status: 'PLANNED', paidAt: null, bankTransactionId: null, matchedBy: null },
    });
  });
});
