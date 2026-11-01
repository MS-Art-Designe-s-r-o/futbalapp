import type {
  PublicArticleDto,
  PublicArticleListItemDto,
  PublicClubDto,
  PublicContentStatus,
  PublicDocumentDto,
  PublicPageDto,
  PublicPersonDto,
  PublicEventDto,
  PublicEventState,
  PublicSeasonDto,
} from '@fkknv/shared';
import { FRIENDLY_MATCH_LABEL_SK } from '@fkknv/shared';

/**
 * Explicitný výber polí pre verejné API. Nič mimo týchto `select`-ov sa z DB
 * nenačíta, takže sa nemôže ani omylom dostať do odpovede.
 */

export const SEASON_SELECT = { id: true, name: true, startDate: true, endDate: true, isActive: true } as const;

export const TEAM_CATEGORY_SELECT = { code: true, name: true, sortOrder: true } as const;

/** Člen v súpiske: len meno + príznak súhlasu s fotkou + existencia fotky (bez dát). */
export const SQUAD_MEMBER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  publicPhotoConsent: true,
  photo: { select: { id: true } },
} as const;

export const PUBLIC_EVENT_SELECT = {
  id: true,
  type: true,
  title: true,
  startAt: true,
  endAt: true,
  location: true,
  address: true,
  team: {
    select: { id: true, name: true, teamCategory: { select: { code: true, name: true } } },
  },
  match: {
    select: { opponent: true, opponentLogo: true, isHome: true, isFriendly: true, competition: true, scoreUs: true, scoreThem: true, state: true },
  },
} as const;

export const ARTICLE_LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  publishedAt: true,
  isArchive: true,
  sourceUrl: true,
} as const;
export const ARTICLE_DETAIL_SELECT = { ...ARTICLE_LIST_SELECT, body: true } as const;

/** Povolené formáty fotky (bez SVG — mohlo by obsahovať skript). */
const PHOTO_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);

export function clubConfig(env: NodeJS.ProcessEnv = process.env): PublicClubDto {
  const name = env.CLUB_NAME?.trim() || 'FK Košická Nová Ves';
  let timezone = env.CLUB_TIMEZONE?.trim() || 'Europe/Bratislava';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
  } catch {
    timezone = 'Europe/Bratislava';
  }
  return { name, timezone };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function toSeasonDto(s: { name: string; startDate: Date; endDate: Date; isActive: boolean }): PublicSeasonDto {
  return { name: s.name, startDate: isoDay(s.startDate), endDate: isoDay(s.endDate), isActive: s.isActive };
}

/**
 * Časy udalostí sa v DB ukladajú ako „nástenný" čas v UTC komponentoch
 * (17:00 v klube = 17:00Z, viď packages/shared/src/datetime.ts). Verejné API
 * vracia skutočný okamih v UTC — klient ho formátuje v `club.timezone`.
 */
export function wallClockToInstant(wall: Date, timeZone: string): Date {
  const offsetAt = (instant: Date) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
        .formatToParts(instant)
        .map((x) => [x.type, x.value]),
    ) as Record<string, string>;
    const hour = Number(p.hour) === 24 ? 0 : Number(p.hour);
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
    return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
  };
  const wallMs = wall.getTime();
  let guess = wallMs - offsetAt(new Date(wallMs));
  // druhý krok — správny posun pri prechode letného/zimného času
  guess = wallMs - offsetAt(new Date(guess));
  return new Date(guess);
}

/** "YYYY-MM-DD" → začiatok kalendárneho dňa v nástennom čase (UTC komponenty). null = neplatné. */
export function parseDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return null;
  }
  return d;
}

export function mapState(type: string, matchState: string | null | undefined): PublicEventState {
  if (type === 'TRAINING' || !matchState) return 'SCHEDULED';
  switch (matchState) {
    case 'LIVE':
      return 'LIVE';
    case 'FINISHED':
      return 'FINISHED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'SCHEDULED';
  }
}

/** Názov nášho družstva: pri jedinom družstve kategórie (názov = kód) len názov klubu. */
export function ourTeamName(clubName: string, teamName: string, categoryCode: string): string {
  return teamName.trim().toUpperCase() === categoryCode.trim().toUpperCase() ? clubName : `${clubName} ${teamName}`;
}

export interface PublicEventRow {
  id: string;
  type: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  location: string | null;
  address: string | null;
  team: { id: string; name: string; teamCategory: { code: string; name: string } } | null;
  match: {
    opponent: string;
    opponentLogo?: string | null;
    isHome: boolean;
    /** priateľský zápas → súťaž sa zobrazí ako „Priateľský zápas" */
    isFriendly?: boolean;
    competition: string | null;
    scoreUs: number | null;
    scoreThem: number | null;
    state: string;
  } | null;
}

/** Logo súpera smie byť len http(s) URL (nikdy data:/javascript:), rozumnej dĺžky. */
export function safeLogoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.length === 0 || v.length > 1000 || /[\s\u0000-\u001f]/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Mená súperov, ktorým chýba platné logo priamo v zápase (doplnia sa z registra klubov). */
export function opponentsMissingLogo(rows: PublicEventRow[]): string[] {
  return [...new Set(rows.filter((r) => r.match && !safeLogoUrl(r.match.opponentLogo)).map((r) => r.match!.opponent))];
}

export function toEventDto(
  e: PublicEventRow,
  club: PublicClubDto,
  clubLogos: ReadonlyMap<string, string | null> = new Map(),
): PublicEventDto | null {
  if (!e.team) return null;
  if (e.type !== 'MATCH' && e.type !== 'TOURNAMENT' && e.type !== 'TRAINING') return null;
  const state = mapState(e.type, e.match?.state);
  let match: PublicEventDto['match'] = null;
  if (e.type !== 'TRAINING' && e.match) {
    const us = ourTeamName(club.name, e.team.name, e.team.teamCategory.code);
    const showScore = state === 'FINISHED' || state === 'LIVE';
    const scoreUs = showScore ? e.match.scoreUs : null;
    const scoreThem = showScore ? e.match.scoreThem : null;
    const home = e.match.isHome;
    match = {
      homeName: home ? us : e.match.opponent,
      awayName: home ? e.match.opponent : us,
      isHome: home,
      opponent: e.match.opponent,
      opponentLogoUrl: safeLogoUrl(e.match.opponentLogo) ?? safeLogoUrl(clubLogos.get(e.match.opponent)),
      competition: e.match.isFriendly ? FRIENDLY_MATCH_LABEL_SK : e.match.competition,
      homeScore: home ? scoreUs : scoreThem,
      awayScore: home ? scoreThem : scoreUs,
    };
  }
  return {
    id: e.id,
    type: e.type,
    state,
    teamId: e.team.id,
    teamName: e.team.name,
    categoryCode: e.team.teamCategory.code,
    categoryName: e.team.teamCategory.name,
    title: e.title,
    startAt: wallClockToInstant(e.startAt, club.timezone).toISOString(),
    endAt: e.endAt ? wallClockToInstant(e.endAt, club.timezone).toISOString() : null,
    location: e.location,
    address: e.address?.trim() || null,
    match,
  };
}

/** Odseky čistého textu: rozdelené prázdnym riadkom, orezané, bez prázdnych. */
export function splitParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function toArticleListItem(a: {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: Date | null;
  isArchive: boolean;
  sourceUrl: string | null;
}): PublicArticleListItemDto {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    excerpt: a.excerpt,
    publishedAt: (a.publishedAt as Date).toISOString(),
    isArchive: a.isArchive,
    sourceUrl: a.sourceUrl,
  };
}

export function toArticleDto(a: Parameters<typeof toArticleListItem>[0] & { body: string }): PublicArticleDto {
  return { ...toArticleListItem(a), paragraphs: splitParagraphs(a.body) };
}

/** data URL → { mime, buffer }; null ak nejde o povolený obrázok v base64. */
export function decodePhotoDataUrl(dataUrl: string | null | undefined): { mime: string; buffer: Buffer } | null {
  if (!dataUrl) return null;
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1]!.toLowerCase();
  if (!PHOTO_MIME.has(mime)) return null;
  const buffer = Buffer.from(m[2]!, 'base64');
  if (buffer.length === 0) return null;
  return { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, buffer };
}

// ---------------------------------------------------------------- klubový obsah

/** Verejne viditeľné stavy (DRAFT nikdy). Poradie = PUBLISHED pred ARCHIVED. */
export const PUBLIC_CONTENT_STATUSES = ['PUBLISHED', 'ARCHIVED'] as const;

export const PAGE_LIST_SELECT = { slug: true, title: true, status: true } as const;
export const PAGE_DETAIL_SELECT = {
  slug: true,
  title: true,
  body: true,
  status: true,
  sourceUrl: true,
  sourceNote: true,
  updatedAt: true,
} as const;

export const PERSON_SELECT = {
  id: true,
  name: true,
  role: true,
  group: true,
  teamNote: true,
  phone: true,
  email: true,
  status: true,
  sourceUrl: true,
  sourceNote: true,
  sortOrder: true,
} as const;

/** Verejný výber dokumentu — bez `data`; existencia súboru podľa size/sha256 (zapisujú sa spolu s data). */
export const DOCUMENT_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  documentDate: true,
  status: true,
  mimeType: true,
  size: true,
  sha256: true,
  sourceUrl: true,
  sourceNote: true,
} as const;

/** Súbor dokumentu na stiahnutie (jediný select, ktorý číta `data`). */
export const DOCUMENT_FILE_SELECT = { data: true, mimeType: true, originalFilename: true } as const;

export function statusRank(status: string): number {
  return status === 'PUBLISHED' ? 0 : 1;
}

/** Zúženie stavu pre verejné DTO; DRAFT (ak by ho DB omylom vrátila) → null. */
export function publicStatus(status: string): PublicContentStatus | null {
  return status === 'PUBLISHED' || status === 'ARCHIVED' ? status : null;
}

/**
 * Čistý text stránky → sekcie. Riadok „## text" začína novú sekciu s podnadpisom,
 * odseky sú oddelené prázdnym riadkom a orezané. HTML sa neinterpretuje (text sa
 * vracia ako text a web ho escapuje).
 */
export function parseSections(body: string): PublicPageDto['sections'] {
  const sections: Array<{ heading: string | null; lines: string[] }> = [{ heading: null, lines: [] }];
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\s*##\s+(.+?)\s*$/.exec(line);
    if (m) sections.push({ heading: m[1]!, lines: [] });
    else sections[sections.length - 1]!.lines.push(line);
  }
  return sections
    .map((s) => ({ heading: s.heading, paragraphs: splitParagraphs(s.lines.join('\n')) }))
    .filter((s) => s.heading !== null || s.paragraphs.length > 0);
}

export function toPageDto(p: {
  slug: string;
  title: string;
  body: string;
  status: string;
  sourceUrl: string | null;
  sourceNote: string | null;
  updatedAt: Date;
}): PublicPageDto | null {
  const status = publicStatus(p.status);
  if (!status) return null;
  return {
    slug: p.slug,
    title: p.title,
    sections: parseSections(p.body),
    status,
    sourceUrl: p.sourceUrl,
    sourceNote: p.sourceNote,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toPersonDto(p: {
  id: string;
  name: string;
  role: string;
  group: string;
  teamNote: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  sourceUrl: string | null;
  sourceNote: string | null;
}): PublicPersonDto | null {
  const status = publicStatus(p.status);
  if (!status) return null;
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    group: p.group as PublicPersonDto['group'],
    teamNote: p.teamNote,
    phone: p.phone,
    email: p.email,
    status,
    sourceUrl: p.sourceUrl,
    sourceNote: p.sourceNote,
  };
}

export function toDocumentDto(d: {
  id: string;
  title: string;
  description: string | null;
  category: string;
  documentDate: Date | null;
  status: string;
  mimeType: string | null;
  size: number | null;
  sha256: string | null;
  sourceUrl: string | null;
  sourceNote: string | null;
}): PublicDocumentDto | null {
  const status = publicStatus(d.status);
  if (!status) return null;
  const hasFile = d.size !== null && d.sha256 !== null;
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category as PublicDocumentDto['category'],
    documentDate: d.documentDate ? isoDay(d.documentDate) : null,
    status,
    mimeType: hasFile ? d.mimeType : null,
    sizeBytes: hasFile ? d.size : null,
    downloadUrl: hasFile ? `/api/v1/public/documents/${d.id}/file` : null,
    sourceUrl: d.sourceUrl,
    sourceNote: d.sourceNote,
  };
}

/** Typy, ktoré sa servírujú s pôvodným Content-Type; ostatné ako application/octet-stream. */
const DOCUMENT_SERVE_MIME = new Set([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
]);
const INLINE_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg']);

/** RFC 5987 kódovanie (encodeURIComponent + znaky ' ( ) *). */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Hlavičky pre stiahnutie dokumentu: bezpečný typ, inline/attachment, názov bez CR/LF a úvodzoviek. */
export function documentFileHeaders(file: { mimeType: string | null; originalFilename: string | null; size: number }) {
  const mime = (file.mimeType ?? '').toLowerCase();
  const contentType = DOCUMENT_SERVE_MIME.has(mime) ? mime : 'application/octet-stream';
  const disposition = INLINE_MIME.has(contentType) ? 'inline' : 'attachment';
  const name =
    (file.originalFilename ?? '')
      .split(/[\\/]/)
      .pop()!
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f"\\;]/g, '')
      .trim()
      .slice(0, 200) || 'dokument';
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_');
  return {
    'Content-Type': contentType,
    'Content-Length': String(file.size),
    'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${rfc5987(name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=300',
  };
}
