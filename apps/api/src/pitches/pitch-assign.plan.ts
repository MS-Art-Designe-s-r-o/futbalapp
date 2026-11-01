/**
 * Plán jednorazového priradenia hracích plôch k už vytvoreným udalostiam
 * (textové pole `location` → `pitchId`), aby plocha bola v systéme rezervácií.
 * Čistá funkcia — zápis robí skript prisma/assign-pitches.ts.
 */
export interface PlanPitch {
  id: string;
  name: string;
}
export interface PlanEvent {
  id: string;
  type: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  location: string | null;
  pitchId: string | null;
  /** pre zápas/turnaj: true = domáci */
  isHome: boolean | null;
  /** zápas turnaja — plochu rezervuje turnaj, nepriraďuje sa samostatne */
  parentEventId?: string | null;
}
export interface AssignPlan {
  assignments: Array<{ eventId: string; pitchId: string }>;
  /** text miesta, ktorý sa nepodarilo priradiť → počet udalostí */
  unmatched: Map<string, number>;
  conflicts: Array<{ eventId: string; title: string; startAt: Date; pitchName: string; clashWith: string }>;
}

const DEFAULT_MS = 90 * 60_000;

export function normalizePlace(v: string): string {
  return v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Nájde plochu pre text: ručné mapovanie → presná zhoda názvu → jediná čiastočná zhoda. */
export function matchPitch(text: string, pitches: PlanPitch[], mapping: Record<string, string> = {}): PlanPitch | null {
  const n = normalizePlace(text);
  if (!n) return null;
  const mapped = Object.entries(mapping).find(([k]) => normalizePlace(k) === n);
  if (mapped) return pitches.find((p) => normalizePlace(p.name) === normalizePlace(mapped[1])) ?? null;
  const exact = pitches.filter((p) => normalizePlace(p.name) === n);
  if (exact.length === 1) return exact[0]!;
  const partial = pitches.filter((p) => {
    const pn = normalizePlace(p.name);
    return pn.includes(n) || n.includes(pn);
  });
  return partial.length === 1 ? partial[0]! : null;
}

export function planPitchAssignment(input: {
  pitches: PlanPitch[];
  /** udalosti bez plochy (kandidáti) */
  events: PlanEvent[];
  /** už rezervované udalosti (majú pitchId) — na kontrolu prekryvov */
  reserved: Array<{ title: string; pitchId: string; startAt: Date; endAt: Date | null }>;
  mapping?: Record<string, string>;
  includePast?: boolean;
  now?: Date;
}): AssignPlan {
  const now = input.now ?? new Date();
  const slots = input.reserved.map((r) => ({ ...r }));
  const out: AssignPlan = { assignments: [], unmatched: new Map(), conflicts: [] };
  const end = (e: { startAt: Date; endAt: Date | null }) => (e.endAt ?? new Date(e.startAt.getTime() + DEFAULT_MS)).getTime();

  const eligible = input.events
    .filter((e) => !e.pitchId && !e.parentEventId && e.location?.trim())
    // tréningy a domáce zápasy/turnaje; zápasy vonku sa neplánujú na našej ploche
    .filter((e) => e.type === 'TRAINING' || ((e.type === 'MATCH' || e.type === 'TOURNAMENT') && e.isHome === true))
    .filter((e) => input.includePast || e.startAt.getTime() >= now.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  for (const e of eligible) {
    const pitch = matchPitch(e.location!, input.pitches, input.mapping);
    if (!pitch) {
      const key = e.location!.trim();
      out.unmatched.set(key, (out.unmatched.get(key) ?? 0) + 1);
      continue;
    }
    const s = e.startAt.getTime();
    const en = end(e);
    // rovnaký čas = spoločné využitie (napr. tréning viacerých družstiev naraz); čiastočný prekryv je konflikt
    const clash = slots.find((x) => x.pitchId === pitch.id && x.startAt.getTime() < en && end(x) > s && !(x.startAt.getTime() === s && end(x) === en));
    if (clash) {
      out.conflicts.push({ eventId: e.id, title: e.title, startAt: e.startAt, pitchName: pitch.name, clashWith: clash.title });
      continue;
    }
    out.assignments.push({ eventId: e.id, pitchId: pitch.id });
    slots.push({ title: e.title, pitchId: pitch.id, startAt: e.startAt, endAt: e.endAt });
  }
  return out;
}
