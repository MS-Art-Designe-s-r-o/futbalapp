export const ROLES = ['ADMIN', 'MANAGER', 'COACH', 'PLAYER', 'PARENT'] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = ['ACTIVE', 'INACTIVE', 'GUEST'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED', 'INJURED', 'SICK', 'UNKNOWN'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const EVENT_TYPES = ['TRAINING', 'MATCH', 'TOURNAMENT', 'CLUB_EVENT', 'PARENT_MEETING'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Slovenské názvy typov udalostí (pre kalendár a dashboard). */
export const EVENT_TYPE_LABELS_SK: Record<EventType, string> = {
  TRAINING: 'Tréning',
  MATCH: 'Zápas',
  TOURNAMENT: 'Turnaj',
  CLUB_EVENT: 'Podujatie',
  PARENT_MEETING: 'Rodičovské združenie',
};

/** Označenie priateľského zápasu (Match.isFriendly) — napr. namiesto súťaže. */
export const FRIENDLY_MATCH_LABEL_SK = 'Priateľský zápas';

/** Povrch ihriska. */
export const SURFACE_CODES = ['PT', 'UT', 'VT', 'MT', 'MI'] as const;
export type SurfaceCode = (typeof SURFACE_CODES)[number];
export const SURFACE_LABELS_SK: Record<SurfaceCode, string> = {
  PT: 'Prírodná tráva',
  UT: 'Umelá tráva',
  VT: 'Veľká telocvičňa',
  MT: 'Malá telocvičňa',
  MI: 'Multifunkčné ihrisko',
};

export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'PARTIAL', 'OVERDUE', 'WAIVED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const MATCH_EVENT_TYPES = [
  'GOAL',
  'ASSIST',
  'SUB_IN',
  'SUB_OUT',
  'YELLOW',
  'RED',
  'NOTE',
  'GOAL_CONCEDED',
  'FOUL',
  'SHOT',
  'CORNER',
  'PENALTY_SCORED',
  'PENALTY_MISSED',
] as const;
export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];

/** Štítky zápasových udalostí pre UI (SK). */
export const MATCH_EVENT_LABELS_SK: Record<MatchEventType, string> = {
  GOAL: 'Gól',
  GOAL_CONCEDED: 'Inkasovaný gól',
  ASSIST: 'Asistencia',
  SUB_IN: 'Striedanie ↑',
  SUB_OUT: 'Striedanie ↓',
  YELLOW: 'Žltá karta',
  RED: 'Červená karta',
  FOUL: 'Faul',
  SHOT: 'Strela',
  CORNER: 'Roh',
  PENALTY_SCORED: 'Premenená penalta',
  PENALTY_MISSED: 'Nepremenená penalta',
  NOTE: 'Poznámka',
};

export const CHANNEL_KINDS = [
  'TEAM_ANNOUNCEMENTS',
  'TEAM_TRAINING',
  'TEAM_GENERAL',
  'TEAM_EMAIL',
  'CLUB_ANNOUNCEMENT',
  'COACHES',
  'BOARD',
] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** Kódy kategórií klubu v poradí od najmladšej. */
export const CATEGORY_CODES = ['U8', 'U9', 'U10', 'U11', 'U13', 'U15', 'U17', 'U19', 'MUZI'] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];

/** Dres nášho mužstva: LIGHT = biely, DARK = modrý. */
export type JerseyColorCode = 'DARK' | 'LIGHT';
export const JERSEY_LABELS_SK: Record<JerseyColorCode, string> = { LIGHT: 'biely', DARK: 'modrý' };

/** Text dresov: „biely“ / „modrý“ / „biely a modrý (hráči prinesú oba)“; null, ak nie sú zadané. */
export function formatJerseys(colors: readonly JerseyColorCode[] | null | undefined): string | null {
  const set = new Set(colors ?? []);
  const hasLight = set.has('LIGHT');
  const hasDark = set.has('DARK');
  if (hasLight && hasDark) return 'biely a modrý (hráči prinesú oba)';
  if (hasLight) return JERSEY_LABELS_SK.LIGHT;
  if (hasDark) return JERSEY_LABELS_SK.DARK;
  return null;
}

/**
 * Z vstupu (nové `jerseyColors` alebo staré `jerseyColor`) určí ukladané hodnoty.
 * Vráti undefined, ak vstup dresy vôbec neobsahuje (nemení sa nič).
 * Staré `jerseyColor`: presne jedna farba → táto; žiadna alebo obe → null.
 */
export function resolveJerseys(input: {
  jerseyColors?: readonly JerseyColorCode[] | null;
  jerseyColor?: JerseyColorCode | null;
}): { jerseyColors: JerseyColorCode[]; jerseyColor: JerseyColorCode | null } | undefined {
  let colors: JerseyColorCode[];
  if (input.jerseyColors !== undefined) colors = Array.from(new Set(input.jerseyColors ?? []));
  else if (input.jerseyColor !== undefined) colors = input.jerseyColor ? [input.jerseyColor] : [];
  else return undefined;
  return { jerseyColors: colors, jerseyColor: colors.length === 1 ? colors[0]! : null };
}
