/**
 * Variabilný symbol: max 10 číslic.
 * Formát: RRMM + 6-miestne ID člena → napr. 2609000042 (september 2026, člen 42).
 * Pre jednorazové/sezónne poplatky sa použije mesiac splatnosti.
 */
export function generateVariableSymbol(memberSeq: number, period: { year: number; month: number }): string {
  if (memberSeq <= 0 || memberSeq > 999_999) {
    throw new Error(`memberSeq mimo rozsahu 1..999999: ${memberSeq}`);
  }
  if (period.month < 1 || period.month > 12) {
    throw new Error(`Neplatný mesiac: ${period.month}`);
  }
  const yy = String(period.year % 100).padStart(2, '0');
  const mm = String(period.month).padStart(2, '0');
  return `${yy}${mm}${String(memberSeq).padStart(6, '0')}`;
}

export function parseVariableSymbol(vs: string): { year2: number; month: number; memberSeq: number } | null {
  if (!/^\d{10}$/.test(vs)) return null;
  const year2 = Number(vs.slice(0, 2));
  const month = Number(vs.slice(2, 4));
  const memberSeq = Number(vs.slice(4));
  if (month < 1 || month > 12 || memberSeq < 1) return null;
  return { year2, month, memberSeq };
}

/** Označenie obdobia platby, napr. "2026-09". */
export function periodLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Variabilný symbol v novom formáte CCCCCCCMMRR:
 * číslice z registračného čísla člena (doplnené nulami zľava na 7 miest) + MM + RR.
 * POZOR: výsledok má 11 číslic, slovenské banky akceptujú VS max. 10 číslic.
 */
export const PAYMENT_VS_LENGTH = 11;

export function paymentVariableSymbol(
  registrationNumber: string | null | undefined,
  period: { year: number; month: number },
): string | null {
  const digits = (registrationNumber ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (period.month < 1 || period.month > 12) throw new Error(`Neplatný mesiac: ${period.month}`);
  const mm = String(period.month).padStart(2, '0');
  const yy = String(((period.year % 100) + 100) % 100).padStart(2, '0');
  return `${digits.padStart(7, '0')}${mm}${yy}`;
}

/** Rozparsuje nový VS (CCCCCCCMMRR) — registračné číslo (číslice, bez núl zľava) a obdobie. */
export function parsePaymentVariableSymbol(
  vs: string,
): { registrationDigits: string; month: number; year2: number } | null {
  if (!/^\d{11,}$/.test(vs)) return null;
  const year2 = Number(vs.slice(-2));
  const month = Number(vs.slice(-4, -2));
  const registrationDigits = vs.slice(0, -4).replace(/^0+/, '');
  if (month < 1 || month > 12 || !registrationDigits) return null;
  return { registrationDigits, month, year2 };
}

/**
 * Variabilný symbol podľa dátumu narodenia hráča: DDMMRRRR + kód predpisu (1 číslica) = 9 číslic.
 * Kód predpisu: 0 = členské a ostatné, 1 = Dresy, 2 = Kemp, 3 = Súprava, 4–9 = ďalšie predpisy.
 * Príklad: hráč nar. 14. 5. 2016, Kemp → 140520162.
 */
export function birthDateVariableSymbol(birthDate: Date | string, code = 0): string {
  const d = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  if (Number.isNaN(d.getTime())) throw new Error('Neplatný dátum narodenia');
  if (!Number.isInteger(code) || code < 0 || code > 9) throw new Error(`Kód predpisu mimo rozsahu 0..9: ${code}`);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  return `${dd}${mm}${yyyy}${code}`;
}

/** Rozparsuje VS podľa dátumu narodenia (9 číslic). Vráti null, ak nejde o platný dátum. */
export function parseBirthDateVariableSymbol(
  vs: string,
): { day: number; month: number; year: number; code: number } | null {
  if (!/^\d{9}$/.test(vs)) return null;
  const day = Number(vs.slice(0, 2));
  const month = Number(vs.slice(2, 4));
  const year = Number(vs.slice(4, 8));
  const code = Number(vs.slice(8));
  if (year < 1930 || year > 2100) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { day, month, year, code };
}

/** Prednastavené predpisy: kód sa použije ako posledná číslica variabilného symbolu. */
export const FEE_PRESETS = [
  { key: 'DRESY', name: 'Dresy', vsCode: 1 },
  { key: 'KEMP', name: 'Kemp', vsCode: 2 },
  { key: 'SUPRAVA', name: 'Súprava', vsCode: 3 },
] as const;
