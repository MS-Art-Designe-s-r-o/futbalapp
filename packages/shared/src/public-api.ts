/**
 * Zmluva verejného (neautentifikovaného) API: GET /api/v1/public/*.
 * Odpovede obsahujú VÝLUČNE tieto polia (explicitný zoznam na serveri) — nikdy celé záznamy členov.
 */

export type PublicEventState = 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'CANCELLED';

export interface PublicSeasonDto {
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface PublicClubDto {
  name: string;
  timezone: string; // IANA, napr. Europe/Bratislava
}

export interface PublicTeamDto {
  id: string;
  name: string;
  categoryCode: string;
  categoryName: string;
  sortOrder: number;
  /** Logo družstva (cesta/URL) alebo null. */
  logoUrl?: string | null;
  /** Počet hráčov v súpiske (agregát, bez osobných údajov). */
  rosterSize: number;
}

export interface PublicPlayerDto {
  id: string;
  firstName: string;
  lastName: string;
  /** Relatívna URL na /public/players/:id/photo; len ak má hráč súhlas s fotkou a fotka existuje. */
  photoUrl: string | null;
}

export interface PublicSquadDto {
  team: PublicTeamDto;
  season: PublicSeasonDto;
  /** Iba hráči so súhlasom so zverejnením mena. */
  players: PublicPlayerDto[];
}

export interface PublicMatchDto {
  /** Domáci a hosťujúci podľa Match.isHome (náš klub = PublicClubDto.name + družstvo). */
  homeName: string;
  awayName: string;
  isHome: boolean;
  opponent: string;
  /** Logo súpera (http/https URL z registra klubov / zápasu), alebo null. */
  opponentLogoUrl: string | null;
  competition: string | null;
  /** Skóre z pohľadu domácich/hostí; null ak zápas nebol odohraný. */
  homeScore: number | null;
  awayScore: number | null;
}

export interface PublicEventDto {
  id: string;
  type: 'TRAINING' | 'MATCH' | 'TOURNAMENT';
  state: PublicEventState;
  teamId: string;
  teamName: string;
  categoryCode: string;
  categoryName: string;
  title: string;
  startAt: string; // ISO UTC
  endAt: string | null;
  location: string | null;
  /** Adresa miesta (pre odkaz na mapu), alebo null. */
  address: string | null;
  match: PublicMatchDto | null;
}

export interface PublicEventsDto {
  club: PublicClubDto;
  season: PublicSeasonDto;
  events: PublicEventDto[];
}

export interface PublicArticleListItemDto {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  /** Archívny oznam — web ho zreteľne označí ako archív. */
  isArchive: boolean;
  sourceUrl: string | null;
}

export interface PublicArticleDto extends PublicArticleListItemDto {
  /** Odseky čistého textu. */
  paragraphs: string[];
}

export interface PublicTeamsDto {
  club: PublicClubDto;
  season: PublicSeasonDto;
  teams: PublicTeamDto[];
}

export interface PublicEventDetailDto {
  club: PublicClubDto;
  event: PublicEventDto;
}

/** Verejné stavy obsahu: DRAFT sa nikdy nezverejňuje. */
export type PublicContentStatus = 'PUBLISHED' | 'ARCHIVED';

export type PublicDocumentCategory = 'CONTRACT' | 'SUBSIDY' | 'TAX_FORM' | 'ANNOUNCEMENT' | 'OTHER';

/** Položka zoznamu GET /public/pages (len PUBLISHED a ARCHIVED). */
export interface PublicPageListItemDto {
  slug: string;
  title: string;
  status: PublicContentStatus;
}

export interface PublicPageDto {
  slug: string;
  title: string;
  /** Odseky; riadok začínajúci „## " v pôvodnom texte je v `sections` podnadpis. */
  sections: Array<{ heading: string | null; paragraphs: string[] }>;
  status: PublicContentStatus;
  sourceUrl: string | null;
  sourceNote: string | null;
  updatedAt: string;
}

export interface PublicPersonDto {
  id: string;
  name: string;
  role: string;
  group: 'MANAGEMENT' | 'COACH' | 'OTHER';
  teamNote: string | null;
  phone: string | null;
  email: string | null;
  status: PublicContentStatus;
  sourceUrl: string | null;
  sourceNote: string | null;
}

export interface PublicDocumentDto {
  id: string;
  title: string;
  description: string | null;
  category: PublicDocumentCategory;
  documentDate: string | null; // YYYY-MM-DD podľa zdroja
  status: PublicContentStatus;
  mimeType: string | null;
  sizeBytes: number | null;
  /** Relatívna URL /api/v1/public/documents/:id/file; null ak sa súbor nepodarilo prevziať. */
  downloadUrl: string | null;
  /** Odkaz na pôvodný zdroj (ponechaný vždy, ak je známy). */
  sourceUrl: string | null;
  sourceNote: string | null;
}
