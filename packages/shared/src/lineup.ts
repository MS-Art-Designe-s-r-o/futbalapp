import { z } from 'zod';
import type { PlayerPosition } from './enums';

/** Post na ihrisku: postavenie + poloha v % (zvislé ihrisko, vlastná bránka dole). */
export interface LineupSlot {
  pos: PlayerPosition;
  x: number;
  y: number;
}

const S = (a: Array<[PlayerPosition, number, number]>): LineupSlot[] => a.map(([pos, x, y]) => ({ pos, x, y }));

/** Formáty hry (počet hráčov) a ich rozostavenia. */
export const LINEUP_FORMATS: Record<string, { label: string; formations: Record<string, LineupSlot[]> }> = {
  '10+1': {
    label: '10+1 (U15 a starší)',
    formations: {
      '4-4-2': S([['GK', 50, 91], ['FB', 13, 72], ['CB', 37, 75], ['CB', 63, 75], ['FB', 87, 72], ['WM', 13, 50], ['CM', 37, 52], ['CM', 63, 52], ['WM', 87, 50], ['ST', 37, 25], ['ST', 63, 25]]),
      '4-3-3': S([['GK', 50, 91], ['FB', 13, 72], ['CB', 37, 75], ['CB', 63, 75], ['FB', 87, 72], ['CM', 28, 50], ['CDM', 50, 58], ['CM', 72, 50], ['W', 15, 26], ['ST', 50, 20], ['W', 85, 26]]),
      '3-5-2': S([['GK', 50, 91], ['CB', 24, 75], ['CB', 50, 77], ['CB', 76, 75], ['WB', 10, 52], ['CM', 32, 50], ['CDM', 50, 58], ['CM', 68, 50], ['WB', 90, 52], ['ST', 37, 25], ['ST', 63, 25]]),
    },
  },
  '8+1': {
    label: '8+1 (U13)',
    formations: {
      '3-3-2': S([['GK', 50, 91], ['CB', 22, 72], ['CB', 50, 75], ['CB', 78, 72], ['WM', 18, 50], ['CM', 50, 52], ['WM', 82, 50], ['ST', 36, 25], ['ST', 64, 25]]),
      '3-2-3': S([['GK', 50, 91], ['CB', 22, 72], ['CB', 50, 75], ['CB', 78, 72], ['CM', 36, 52], ['CM', 64, 52], ['W', 16, 26], ['ST', 50, 22], ['W', 84, 26]]),
    },
  },
  '7+1': {
    label: '7+1 (U11)',
    formations: {
      '3-3-1': S([['GK', 50, 91], ['CB', 22, 73], ['CB', 50, 76], ['CB', 78, 73], ['WM', 15, 50], ['CM', 50, 53], ['WM', 85, 50], ['ST', 50, 22]]),
      '2-3-2': S([['GK', 50, 91], ['CB', 33, 73], ['CB', 67, 73], ['WM', 15, 50], ['CM', 50, 53], ['WM', 85, 50], ['ST', 35, 23], ['ST', 65, 23]]),
    },
  },
  '5+1': {
    label: '5+1 (U9)',
    formations: {
      '2-1-2': S([['GK', 50, 91], ['CB', 33, 70], ['CB', 67, 70], ['CM', 50, 48], ['ST', 30, 22], ['ST', 70, 22]]),
    },
  },
};

/** Predvolený formát podľa kódu kategórie (U9 → 5+1, U11 → 7+1, U13 → 8+1, inak 10+1). */
export function defaultLineupFormat(categoryCode?: string | null): string {
  const n = Number(/\d+/.exec(categoryCode ?? '')?.[0]);
  if (!Number.isFinite(n)) return '10+1';
  if (n <= 9) return '5+1';
  if (n <= 11) return '7+1';
  if (n <= 13) return '8+1';
  return '10+1';
}

/** Uložené rozostavenie: slot (index postu) → memberId. */
export const matchLineupSchema = z
  .object({
    format: z.string().refine((f) => f in LINEUP_FORMATS, 'Neznámy formát'),
    formation: z.string(),
    slots: z.record(z.string().regex(/^\d+$/), z.string().min(1)),
  })
  .superRefine((v, ctx) => {
    const fm = LINEUP_FORMATS[v.format]?.formations[v.formation];
    if (!fm) return ctx.addIssue({ code: 'custom', message: 'Neznáme rozostavenie' });
    const ids = Object.values(v.slots);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Hráč je v rozostavení viackrát' });
    for (const k of Object.keys(v.slots)) {
      if (Number(k) >= fm.length) ctx.addIssue({ code: 'custom', message: 'Neplatný post' });
    }
  });
export type MatchLineup = z.infer<typeof matchLineupSchema>;
