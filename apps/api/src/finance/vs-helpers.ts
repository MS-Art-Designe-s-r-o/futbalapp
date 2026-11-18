import { birthDateVariableSymbol, generateVariableSymbol, paymentVariableSymbol } from '@fkknv/shared';

/**
 * VS povinnosti: dátum narodenia (DDMMRRRR + kód predpisu) → inak reg. číslo (+ MMRR) → inak RRMM + memberSeq.
 */
export function obligationVariableSymbol(
  member: { birthDate?: Date | null; registrationNumber?: string | null; memberSeq: number },
  plan: { vsCode: number },
  period: { year: number; month: number },
): string {
  if (member.birthDate && !Number.isNaN(member.birthDate.getTime())) {
    return birthDateVariableSymbol(member.birthDate, plan.vsCode);
  }
  return (
    paymentVariableSymbol(member.registrationNumber, period) ?? generateVariableSymbol(member.memberSeq, period)
  );
}

/** Kód predpisu: mesačný → 0, inak najnižší nepoužitý 4..9 (ak sú všetky obsadené, 9). */
export function nextPlanVsCode(period: string, usedCodes: Iterable<number>): number {
  if (period === 'MONTHLY') return 0;
  const used = new Set(usedCodes);
  for (let c = 4; c <= 9; c++) if (!used.has(c)) return c;
  return 9;
}

export type VsDecision =
  | { kind: 'member'; memberId: string; preferExactVs: boolean }
  | { kind: 'ambiguous' }
  | { kind: 'none' };

/**
 * Rozhodnutie párovania podľa VS.
 * @param ownerIds členovia s otvorenou povinnosťou s presne týmto VS
 * @param birthMemberIds neneaktívni členovia s dátumom narodenia z VS (len ak ide o VS podľa dátumu narodenia)
 */
export function decideVsMatch(ownerIds: string[], birthMemberIds: string[]): VsDecision {
  const owners = [...new Set(ownerIds)];
  if (owners.length === 1) return { kind: 'member', memberId: owners[0]!, preferExactVs: true };
  if (owners.length > 1) return { kind: 'ambiguous' };
  const birth = [...new Set(birthMemberIds)];
  if (birth.length === 1) return { kind: 'member', memberId: birth[0]!, preferExactVs: false };
  return { kind: 'none' };
}
