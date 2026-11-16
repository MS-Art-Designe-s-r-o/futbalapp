import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  PublicArticleDto,
  PublicArticleListItemDto,
  PublicDocumentDto,
  PublicEventDetailDto,
  PublicEventDto,
  PublicEventsDto,
  PublicPageDto,
  PublicPageListItemDto,
  PublicPersonDto,
  PublicSquadDto,
  PublicTeamDto,
  PublicTeamsDto,
} from '@fkknv/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  ARTICLE_DETAIL_SELECT,
  ARTICLE_LIST_SELECT,
  DOCUMENT_FILE_SELECT,
  DOCUMENT_SELECT,
  PAGE_DETAIL_SELECT,
  PAGE_LIST_SELECT,
  PERSON_SELECT,
  PUBLIC_CONTENT_STATUSES,
  PUBLIC_EVENT_SELECT,
  SEASON_SELECT,
  SQUAD_MEMBER_SELECT,
  TEAM_CATEGORY_SELECT,
  clubConfig,
  decodePhotoDataUrl,
  parseDay,
  publicStatus,
  statusRank,
  toArticleDto,
  toArticleListItem,
  toDocumentDto,
  toEventDto,
  opponentsMissingLogo,
  toPageDto,
  toPersonDto,
  toSeasonDto,
  type PublicEventRow,
} from './public.mapper';

export interface PublicEventsQuery {
  categoryCode?: string;
  teamId?: string;
  type?: string;
  from?: string;
  to?: string;
  limit?: string;
}

const DEFAULT_EVENT_LIMIT = 200;
const MAX_EVENT_LIMIT = 500;
const DEFAULT_ARTICLE_LIMIT = 50;
const MAX_ARTICLE_LIMIT = 200;

const MAX_PUBLIC_DOCUMENTS = 500;
const DOCUMENT_CATEGORIES = new Set(['CONTRACT', 'SUBSIDY', 'TAX_FORM', 'ANNOUNCEMENT', 'OTHER']);
const PERSON_GROUP_RANK: Record<string, number> = { MANAGEMENT: 0, COACH: 1, OTHER: 2 };

const collator = new Intl.Collator('sk');

type ActiveSeason = { id: string; name: string; startDate: Date; endDate: Date; isActive: boolean };

@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  /** Aktívna sezóna z DB (pri viacerých aktívnych najnovšia podľa začiatku). */
  async activeSeason(): Promise<ActiveSeason> {
    const season = await this.prisma.season.findFirst({
      where: { isActive: true },
      orderBy: { startDate: 'desc' },
      select: SEASON_SELECT,
    });
    if (!season) throw new ServiceUnavailableException('Nie je nastavená aktívna sezóna');
    return season;
  }

  /** Platné členstvo v družstve v aktívnej sezóne (aktívny, nie demo hráč). */
  /** Logá súperov z registra klubov (Club.logoUrl) pre zápasy, ktoré ho nemajú priamo v Match.opponentLogo. */
  private async clubLogos(rows: PublicEventRow[]): Promise<Map<string, string | null>> {
    const names = opponentsMissingLogo(rows);
    if (names.length === 0) return new Map();
    const clubs = await this.prisma.club.findMany({
      where: { name: { in: names }, logoUrl: { not: null } },
      select: { name: true, logoUrl: true },
    });
    return new Map(clubs.map((c) => [c.name, c.logoUrl]));
  }

  private activeMembershipWhere(seasonId: string, now: Date): Prisma.TeamMembershipWhereInput {
    return {
      seasonId,
      OR: [{ leftAt: null }, { leftAt: { gt: now } }],
      member: { status: 'ACTIVE', isDemo: false },
    };
  }

  private toTeamDto(
    t: { id: string; name: string; sortOrder: number; teamCategory: { code: string; name: string; sortOrder: number } },
    rosterSize: number,
  ): PublicTeamDto {
    return {
      id: t.id,
      name: t.name,
      categoryCode: t.teamCategory.code,
      categoryName: t.teamCategory.name,
      sortOrder: t.sortOrder,
      rosterSize,
    };
  }

  async teams(): Promise<PublicTeamsDto> {
    const club = clubConfig();
    const season = await this.activeSeason();
    const now = new Date();
    const teams = await this.prisma.team.findMany({
      where: { isDemo: false, isGoalkeeperGroup: false },
      orderBy: [{ teamCategory: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        teamCategory: { select: TEAM_CATEGORY_SELECT },
        _count: { select: { memberships: { where: this.activeMembershipWhere(season.id, now) } } },
      },
    });
    return {
      club,
      season: toSeasonDto(season),
      teams: teams.map((t) => this.toTeamDto(t, t._count.memberships)),
    };
  }

  async squad(teamId: string): Promise<PublicSquadDto> {
    const season = await this.activeSeason();
    const now = new Date();
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, isDemo: false, isGoalkeeperGroup: false },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        teamCategory: { select: TEAM_CATEGORY_SELECT },
        _count: { select: { memberships: { where: this.activeMembershipWhere(season.id, now) } } },
      },
    });
    if (!team) throw new NotFoundException('Družstvo neexistuje');

    const base = this.activeMembershipWhere(season.id, now);
    const memberships = await this.prisma.teamMembership.findMany({
      where: {
        ...base,
        teamId: team.id,
        member: { status: 'ACTIVE', isDemo: false, publicProfileConsent: true },
      },
      select: { member: { select: SQUAD_MEMBER_SELECT } },
    });

    const seen = new Set<string>();
    const players = memberships
      .map((m) => m.member)
      .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
      .sort((a, b) => collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName))
      .map((m) => ({
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        photoUrl: m.publicPhotoConsent && m.photo ? `/api/v1/public/players/${m.id}/photo` : null,
      }));

    return { team: this.toTeamDto(team, team._count.memberships), season: toSeasonDto(season), players };
  }

  /** Fotka hráča len pri súhlase so zverejnením profilu aj fotky. null = 404. */
  async playerPhoto(memberId: string): Promise<{ mime: string; buffer: Buffer } | null> {
    const member = await this.prisma.member.findFirst({
      where: {
        id: memberId,
        isDemo: false,
        status: 'ACTIVE',
        publicProfileConsent: true,
        publicPhotoConsent: true,
      },
      select: { photo: { select: { dataUrl: true } } },
    });
    return decodePhotoDataUrl(member?.photo?.dataUrl);
  }

  /** Základná podmienka verejnej udalosti (zápas/turnaj vždy, tréning len isPublic). */
  private publicEventWhere(seasonId: string): Prisma.EventWhereInput {
    return {
      isDemo: false,
      seasonId,
      teamId: { not: null },
      team: { isDemo: false, isGoalkeeperGroup: false },
      OR: [{ type: { in: ['MATCH', 'TOURNAMENT'] } }, { type: 'TRAINING', isPublic: true }],
    };
  }

  async events(query: PublicEventsQuery): Promise<PublicEventsDto> {
    const and: Prisma.EventWhereInput[] = [];

    if (query.type !== undefined && query.type !== '') {
      if (query.type === 'match') and.push({ type: { in: ['MATCH', 'TOURNAMENT'] } });
      else if (query.type === 'training') and.push({ type: 'TRAINING' });
      else throw new BadRequestException('Neplatný typ (match | training)');
    }
    if (query.teamId) and.push({ teamId: query.teamId });
    if (query.categoryCode) and.push({ team: { teamCategory: { code: query.categoryCode } } });

    // from/to sú kalendárne dni v pásme klubu; časy sú v DB uložené ako nástenný čas
    // v UTC komponentoch, takže hranice dňa sú polnoci v UTC komponentoch.
    if (query.from) {
      const from = parseDay(query.from);
      if (!from) throw new BadRequestException('Neplatný dátum from (YYYY-MM-DD)');
      and.push({ startAt: { gte: from } });
    }
    if (query.to) {
      const to = parseDay(query.to);
      if (!to) throw new BadRequestException('Neplatný dátum to (YYYY-MM-DD)');
      and.push({ startAt: { lt: new Date(to.getTime() + 24 * 3600 * 1000) } });
    }

    let limit = DEFAULT_EVENT_LIMIT;
    if (query.limit !== undefined && query.limit !== '') {
      if (!/^\d+$/.test(query.limit) || Number(query.limit) < 1) throw new BadRequestException('Neplatný limit');
      limit = Math.min(Number(query.limit), MAX_EVENT_LIMIT);
    }

    const club = clubConfig();
    const season = await this.activeSeason();
    const rows = await this.prisma.event.findMany({
      where: { AND: [this.publicEventWhere(season.id), ...and] },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: PUBLIC_EVENT_SELECT,
    });
    const clubLogos = await this.clubLogos(rows as PublicEventRow[]);
    const events = (rows as PublicEventRow[])
      .map((r) => toEventDto(r, club, clubLogos))
      .filter((e): e is PublicEventDto => e !== null);
    return { club, season: toSeasonDto(season), events };
  }

  async event(id: string): Promise<PublicEventDetailDto> {
    const club = clubConfig();
    const season = await this.activeSeason();
    const row = await this.prisma.event.findFirst({
      where: { AND: [{ id }, this.publicEventWhere(season.id)] },
      select: PUBLIC_EVENT_SELECT,
    });
    const event = row ? toEventDto(row as PublicEventRow, club, await this.clubLogos([row as PublicEventRow])) : null;
    if (!event) throw new NotFoundException('Udalosť neexistuje');
    return { club, event };
  }

  async articles(limitRaw?: string): Promise<PublicArticleListItemDto[]> {
    let limit = DEFAULT_ARTICLE_LIMIT;
    if (limitRaw !== undefined && limitRaw !== '') {
      if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1) throw new BadRequestException('Neplatný limit');
      limit = Math.min(Number(limitRaw), MAX_ARTICLE_LIMIT);
    }
    const rows = await this.prisma.article.findMany({
      where: { publishedAt: { not: null, lte: new Date() } },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: ARTICLE_LIST_SELECT,
    });
    return rows.map(toArticleListItem);
  }

  async article(slug: string): Promise<PublicArticleDto> {
    const row = await this.prisma.article.findFirst({
      where: { slug, publishedAt: { not: null, lte: new Date() } },
      select: ARTICLE_DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException('Článok neexistuje');
    return toArticleDto(row);
  }

  // ------------------------------------------------------------ klubový obsah (DRAFT nikdy)

  async pages(): Promise<PublicPageListItemDto[]> {
    const rows = await this.prisma.clubPage.findMany({
      where: { status: { in: [...PUBLIC_CONTENT_STATUSES] } },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: PAGE_LIST_SELECT,
    });
    return rows.flatMap((r) => {
      const status = publicStatus(r.status);
      return status ? [{ slug: r.slug, title: r.title, status }] : [];
    });
  }

  async page(slug: string): Promise<PublicPageDto> {
    const row = await this.prisma.clubPage.findFirst({
      where: { slug, status: { in: [...PUBLIC_CONTENT_STATUSES] } },
      select: PAGE_DETAIL_SELECT,
    });
    const page = row ? toPageDto(row) : null;
    if (!page) throw new NotFoundException('Stránka neexistuje');
    return page;
  }

  async people(): Promise<PublicPersonDto[]> {
    const rows = await this.prisma.clubPerson.findMany({
      where: { status: { in: [...PUBLIC_CONTENT_STATUSES] } },
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: PERSON_SELECT,
    });
    return [...rows]
      .sort(
        (a, b) =>
          statusRank(a.status) - statusRank(b.status) ||
          (PERSON_GROUP_RANK[a.group] ?? 9) - (PERSON_GROUP_RANK[b.group] ?? 9) ||
          a.sortOrder - b.sortOrder ||
          collator.compare(a.name, b.name),
      )
      .map(toPersonDto)
      .filter((p): p is PublicPersonDto => p !== null);
  }

  async documents(category?: string): Promise<PublicDocumentDto[]> {
    if (category !== undefined && category !== '' && !DOCUMENT_CATEGORIES.has(category)) {
      throw new BadRequestException('Neplatná kategória (CONTRACT | SUBSIDY | TAX_FORM | ANNOUNCEMENT | OTHER)');
    }
    const rows = await this.prisma.clubDocument.findMany({
      where: {
        status: { in: [...PUBLIC_CONTENT_STATUSES] },
        ...(category ? { category: category as Prisma.ClubDocumentWhereInput['category'] } : {}),
      },
      orderBy: [{ documentDate: { sort: 'desc', nulls: 'last' } }, { sortOrder: 'asc' }, { title: 'asc' }],
      take: MAX_PUBLIC_DOCUMENTS,
      select: DOCUMENT_SELECT,
    });
    // stabilné triedenie: PUBLISHED pred ARCHIVED, inak poradie z DB (dátum desc)
    return [...rows]
      .sort((a, b) => statusRank(a.status) - statusRank(b.status))
      .map(toDocumentDto)
      .filter((d): d is PublicDocumentDto => d !== null);
  }

  /** Súbor zverejneného dokumentu (bajty bez zmeny). null = 404 (DRAFT, neexistuje, bez súboru). */
  async documentFile(
    id: string,
  ): Promise<{ buffer: Buffer; mimeType: string | null; originalFilename: string | null } | null> {
    const row = await this.prisma.clubDocument.findFirst({
      where: { id, status: { in: [...PUBLIC_CONTENT_STATUSES] }, data: { not: null } },
      select: DOCUMENT_FILE_SELECT,
    });
    if (!row?.data || row.data.length === 0) return null;
    return { buffer: Buffer.from(row.data), mimeType: row.mimeType, originalFilename: row.originalFilename };
  }
}
