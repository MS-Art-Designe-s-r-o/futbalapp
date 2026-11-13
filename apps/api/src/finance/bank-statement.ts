import * as XLSX from 'xlsx';
import type { BankRow } from './finance.service';

/** Odstráni diakritiku a znormalizuje hlavičku stĺpca. */
function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/** Mapovanie normalizovanej hlavičky na pole BankRow. */
const HEADER_MAP: Record<string, keyof BankRow | 'bookingDate'> = {
  'datum realizacie': 'date',
  'datum zauctovania': 'bookingDate',
  'ucet partnera': 'counterpartyIban',
  'nazov partnera': 'counterpartyName',
  suma: 'amountCents',
  vs: 'variableSymbol',
  'doplnujuce informacie': 'message',
  'cislo dokladu': 'externalId',
};

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(Math.round((value - 25569) * 86400 * 1000));
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

/**
 * Rozparsuje bankový výpis (VÚB/„export pohybov na účte", .xls aj .xlsx) na
 * pohyby: kredity (Suma > 0) aj debety (Suma < 0, odchádzajúce platby = výdavky). Deduplikáciu rieši
 * externalId (Číslo dokladu) na úrovni importu.
 */
export function parseBankStatement(buffer: Buffer): BankRow[] {
  const wb = XLSX.read(buffer, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error('Výpis neobsahuje žiadny hárok');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });

  // nájdi hlavičkový riadok (obsahuje „Číslo dokladu" aj „Suma")
  const headerIdx = matrix.findIndex(
    (r) => r.some((c) => norm(c) === 'cislo dokladu') && r.some((c) => norm(c) === 'suma'),
  );
  if (headerIdx === -1) throw new Error('V súbore sa nenašla hlavička výpisu (Suma, Číslo dokladu, …)');

  const header = matrix[headerIdx]!;
  const colToField = new Map<number, keyof BankRow | 'bookingDate'>();
  header.forEach((cell, i) => {
    const field = HEADER_MAP[norm(cell)];
    if (field) colToField.set(i, field);
  });

  const rows: BankRow[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const raw: Partial<Record<keyof BankRow | 'bookingDate', unknown>> = {};
    matrix[r]!.forEach((cell, i) => {
      const field = colToField.get(i);
      if (field) raw[field] = cell;
    });

    const amount = typeof raw.amountCents === 'number' ? raw.amountCents : Number(raw.amountCents);
    const externalId = toText(raw.externalId);
    if (!externalId || !Number.isFinite(amount) || amount === 0) continue; // kredity (+) aj debety (−)

    const date = toDate(raw.date) ?? toDate(raw.bookingDate);
    if (!date) continue;

    rows.push({
      externalId,
      date: date.toISOString(),
      amountCents: Math.round(amount * 100),
      variableSymbol: toText(raw.variableSymbol),
      counterpartyIban: toText(raw.counterpartyIban),
      counterpartyName: toText(raw.counterpartyName),
      message: toText(raw.message),
    });
  }

  return rows;
}
