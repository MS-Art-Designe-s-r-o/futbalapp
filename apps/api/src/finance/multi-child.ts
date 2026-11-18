import { birthDateVariableSymbol, parseBirthDateVariableSymbol } from '@fkknv/shared';

/**
 * Špecifický symbol → dátum narodenia druhého dieťaťa.
 * Akceptuje DDMMRRRR (8 číslic) aj 9-ciferný tvar DDMMRRRR+kód; iný počet číslic ignoruje.
 */
export function parseSpecificSymbolBirthDate(ss?: string | null): Date | null {
  const digits = (ss ?? '').replace(/\D/g, '');
  if (digits.length !== 8 && digits.length !== 9) return null;
  const p = parseBirthDateVariableSymbol(digits.length === 8 ? `${digits}0` : digits);
  return p ? new Date(Date.UTC(p.year, p.month - 1, p.day)) : null;
}

export interface OpenObligation {
  id: string;
  memberId: string;
  variableSymbol: string;
  openCents: number;
}

/**
 * Poradie rozúčtovania platby za dvoch súrodencov:
 * (a) povinnosti A s VS platby, (b) povinnosti B s VS dátumu narodenia B + kód z VS platby
 * (inak všetky otvorené B od najstaršej), (c) zvyšok: ostatné A, potom ostatné B.
 * Vstupné zoznamy sú už zoradené od najstaršej.
 */
export function orderMultiChildObligations(
  txVs: string,
  a: OpenObligation[],
  b: OpenObligation[],
  bBirthDate: Date,
): OpenObligation[] {
  const used = new Set<string>();
  const out: OpenObligation[] = [];
  const add = (list: OpenObligation[]) => {
    for (const o of list) if (!used.has(o.id)) (used.add(o.id), out.push(o));
  };
  add(a.filter((o) => o.variableSymbol === txVs));
  const code = /^\d{9}$/.test(txVs) ? Number(txVs.slice(8)) : null;
  if (code !== null) {
    const bVs = birthDateVariableSymbol(bBirthDate, code);
    const exactB = b.filter((o) => o.variableSymbol === bVs);
    add(exactB.length ? exactB : b);
  } else {
    add(b);
  }
  add(a);
  add(b);
  return out;
}

/** Rozdelí sumu postupne na povinnosti v danom poradí. */
export function splitAmount(
  totalCents: number,
  ordered: OpenObligation[],
): { allocations: { obligationId: string; memberId: string; cents: number }[]; remainingCents: number } {
  let remaining = totalCents;
  const allocations: { obligationId: string; memberId: string; cents: number }[] = [];
  for (const o of ordered) {
    if (remaining <= 0) break;
    const cents = Math.min(o.openCents, remaining);
    if (cents <= 0) continue;
    allocations.push({ obligationId: o.id, memberId: o.memberId, cents });
    remaining -= cents;
  }
  return { allocations, remainingCents: remaining };
}
