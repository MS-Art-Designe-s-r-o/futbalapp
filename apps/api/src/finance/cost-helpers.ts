import { BadRequestException, ConflictException } from '@nestjs/common';

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface CostFieldsInput {
  costItem: { hasKinds: boolean } | null;
  kind: string | null;
  period: string | null;
  description: string | null;
}

/** Overí pravidlá nákladovej položky (druh, obdobie, popis pri „ostatné"). */
export function validateCostFields(i: CostFieldsInput): void {
  if (i.period != null && !PERIOD_RE.test(i.period)) throw new BadRequestException('Obdobie musí byť vo formáte RRRR-MM');
  if (i.kind != null && i.kind !== 'RENT' && i.kind !== 'OTHER') throw new BadRequestException('Neplatný druh nákladu');
  if (i.costItem) {
    if (!i.period) throw new BadRequestException('Doplňte obdobie nákladu');
    if (i.costItem.hasKinds && !i.kind) throw new BadRequestException('Vyberte druh nákladu (nájom / ostatné)');
    if (!i.costItem.hasKinds && i.kind) throw new BadRequestException('Táto položka nemá druhy nákladu');
  } else if (i.kind) {
    throw new BadRequestException('Druh nákladu možno zadať len pri nákladovej položke');
  }
  if (i.kind === 'OTHER' && !(i.description ?? '').trim()) throw new BadRequestException('Pri ostatných nákladoch doplňte popis');
}

export const normSearch = (s?: string | null) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export interface DebitRow {
  id: string;
  date: Date;
  amountCents: number;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  variableSymbol: string | null;
  message: string | null;
  matchedExpenseId: string | null;
}

/** Filter (q: názov/VS/správa bez diakritiky) + zoradenie (zhodná absolútna suma, potom dátum zostupne). */
export function filterSortDebits<T extends Omit<DebitRow, 'matchedExpenseId'>>(
  rows: T[],
  opts: { q?: string; amountCents?: number | null },
): T[] {
  const q = normSearch(opts.q);
  const out = q
    ? rows.filter((r) => [r.counterpartyName, r.variableSymbol, r.message].some((f) => normSearch(f).includes(q)))
    : [...rows];
  const amt = opts.amountCents != null ? Math.abs(opts.amountCents) : null;
  const eq = (r: T) => (amt != null && Math.abs(r.amountCents) === amt ? 0 : 1);
  return out.sort((a, b) => eq(a) - eq(b) || b.date.getTime() - a.date.getTime());
}

/** Rozhodnutie pri ručnom párovaní: vyhodí chybu, alebo vráti id automaticky založeného výdavku na zmazanie (zlúčenie). */
export function planMatch(
  expense: { id: string; amountCents: number },
  tx: { amountCents: number },
  linked: { id: string; costItemId: string | null } | null,
  force?: boolean,
): { deleteExpenseId: string | null } {
  if (linked && linked.id !== expense.id && linked.costItemId) {
    throw new BadRequestException('Tento pohyb je už spárovaný s iným nákladom');
  }
  const txCents = Math.abs(tx.amountCents);
  if (txCents !== expense.amountCents && !force) {
    throw new ConflictException({
      code: 'AMOUNT_MISMATCH',
      message: 'Suma pohybu sa nezhoduje so sumou nákladu',
      expenseCents: expense.amountCents,
      txCents,
    });
  }
  return { deleteExpenseId: linked && linked.id !== expense.id ? linked.id : null };
}

/** Agregácia uhradených nákladov podľa skupiny a položky. */
export function aggregateCosts(
  expenses: { amountCents: number; kind: string | null; costItem: { name: string; group: { id: string; name: string } } | null }[],
) {
  let totalPaidCents = 0;
  const groups = new Map<string, { groupId: string; group: string; cents: number }>();
  const items = new Map<string, { group: string; item: string; kind: 'RENT' | 'OTHER' | null; cents: number }>();
  for (const e of expenses) {
    if (!e.costItem) continue;
    const kind = e.kind === 'RENT' || e.kind === 'OTHER' ? e.kind : null;
    totalPaidCents += e.amountCents;
    const g = groups.get(e.costItem.group.id) ?? { groupId: e.costItem.group.id, group: e.costItem.group.name, cents: 0 };
    g.cents += e.amountCents;
    groups.set(g.groupId, g);
    const key = `${e.costItem.group.id}|${e.costItem.name}|${kind}`;
    const it = items.get(key) ?? { group: e.costItem.group.name, item: e.costItem.name, kind, cents: 0 };
    it.cents += e.amountCents;
    items.set(key, it);
  }
  const desc = <T extends { cents: number }>(a: T, b: T) => b.cents - a.cents;
  return { totalPaidCents, byGroup: [...groups.values()].sort(desc), byItem: [...items.values()].sort(desc) };
}
