import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { PublicService } from './public.service';
import {
  decodePhotoDataUrl,
  documentFileHeaders,
  opponentsMissingLogo,
  safeLogoUrl,
  parseSections,
  splitParagraphs,
  toEventDto,
  wallClockToInstant,
  type PublicEventRow,
} from './public.mapper';
import { PublicController } from './public.controller';
import { isInternalRequest } from './public.module';
import type { PrismaService } from '../prisma/prisma.service';

const SEASON = {
  id: 's-db',
  name: '2030/2031',
  startDate: new Date('2030-07-01T00:00:00Z'),
  endDate: new Date('2031-06-30T00:00:00Z'),
  isActive: true,
};

function mockPrisma() {
  return {
    season: { findFirst: vi.fn().mockResolvedValue(SEASON) },
    team: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
    member: { findFirst: vi.fn() },
    event: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    article: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    clubPage: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    clubPerson: { findMany: vi.fn().mockResolvedValue([]) },
    clubDocument: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
  };
}

type Mock = ReturnType<typeof mockPrisma>;
let prisma: Mock;
let service: PublicService;

beforeEach(() => {
  prisma = mockPrisma();
  service = new PublicService(prisma as unknown as PrismaService);
});

const CLUB = { name: 'FK Košická Nová Ves', timezone: 'Europe/Bratislava' };

function eventRow(over: Partial<PublicEventRow> = {}): PublicEventRow {
  return {
    id: 'e1',
    type: 'MATCH',
    title: 'U10 vs Lokomotíva',
    startAt: new Date('2030-09-12T17:00:00Z'),
    endAt: null,
    location: 'Ihrisko KNV',
    address: 'Futbalová 1, Nové Veselé',
    team: { id: 't1', name: 'U10', teamCategory: { code: 'U10', name: 'Prípravka U10' } },
    match: { opponent: 'Lokomotíva', isHome: true, competition: 'Liga', scoreUs: 3, scoreThem: 1, state: 'FINISHED' },
    ...over,
  };
}

/** Rekurzívne zozbiera všetky kľúče z objektu (napr. `select`). */
function allKeys(obj: unknown, acc = new Set<string>()): Set<string> {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      acc.add(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

describe('aktívna sezóna', () => {
  it('berie sa z DB (isActive, najnovšia), nie natvrdo', async () => {
    const res = await service.teams();
    expect(prisma.season.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, orderBy: { startDate: 'desc' } }),
    );
    expect(res.season).toEqual({ name: '2030/2031', startDate: '2030-07-01', endDate: '2031-06-30', isActive: true });
  });
  it('bez aktívnej sezóny → 503', async () => {
    prisma.season.findFirst.mockResolvedValue(null);
    await expect(service.teams()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('mužstvá', () => {
  it('filtruje demo družstvá, rosterSize len aktívni nedemo členovia aktívnej sezóny', async () => {
    prisma.team.findMany.mockResolvedValue([
      { id: 't1', name: 'U10', sortOrder: 0, teamCategory: { code: 'U10', name: 'U10', sortOrder: 3 }, _count: { memberships: 12 } },
    ]);
    const res = await service.teams();
    const arg = prisma.team.findMany.mock.calls[0]![0];
    expect(arg.where).toEqual({ isDemo: false });
    expect(arg.orderBy).toEqual([{ teamCategory: { sortOrder: 'asc' } }, { sortOrder: 'asc' }]);
    const mw = arg.select._count.select.memberships.where;
    expect(mw.seasonId).toBe('s-db');
    expect(mw.member).toEqual({ status: 'ACTIVE', isDemo: false });
    expect(mw.OR).toEqual([{ leftAt: null }, { leftAt: { gt: expect.any(Date) } }]);
    expect(res.teams[0]).toEqual({ id: 't1', name: 'U10', categoryCode: 'U10', categoryName: 'U10', sortOrder: 0, rosterSize: 12 });
  });
});

describe('súpiska', () => {
  beforeEach(() => {
    prisma.team.findFirst.mockResolvedValue({
      id: 't1',
      name: 'U10',
      sortOrder: 0,
      teamCategory: { code: 'U10', name: 'U10', sortOrder: 3 },
      _count: { memberships: 3 },
    });
  });

  it('demo družstvo → 404', async () => {
    prisma.team.findFirst.mockResolvedValue(null);
    await expect(service.squad('demo')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.team.findFirst.mock.calls[0]![0].where).toEqual({ id: 'demo', isDemo: false });
  });

  it('dotaz vyžaduje súhlas, ACTIVE, nie demo; select bez citlivých polí', async () => {
    await service.squad('t1');
    const arg = prisma.teamMembership.findMany.mock.calls[0]![0];
    expect(arg.where.member).toEqual({ status: 'ACTIVE', isDemo: false, publicProfileConsent: true });
    expect(arg.where.seasonId).toBe('s-db');
    expect(arg.where.teamId).toBe('t1');
    const keys = allKeys(arg.select);
    for (const forbidden of ['birthDate', 'birthNumber', 'healthNotes', 'dataUrl', 'photoUrl', 'addressStreet', 'userId', 'sex']) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(arg.include).toBeUndefined();
  });

  it('hráč bez súhlasu (ak by ho DB vrátila filtrom) nie je; foto len pri súhlase a existencii', async () => {
    prisma.teamMembership.findMany.mockResolvedValue([
      { member: { id: 'm2', firstName: 'Ján', lastName: 'Šimko', publicPhotoConsent: false, photo: { id: 'p2' } } },
      { member: { id: 'm1', firstName: 'Adam', lastName: 'Čech', publicPhotoConsent: true, photo: { id: 'p1' } } },
      { member: { id: 'm3', firstName: 'Peter', lastName: 'Sekera', publicPhotoConsent: true, photo: null } },
    ]);
    const res = await service.squad('t1');
    // slovenské radenie: Čech < Sekera < Šimko
    expect(res.players.map((p) => p.lastName)).toEqual(['Čech', 'Sekera', 'Šimko']);
    expect(res.players.find((p) => p.id === 'm1')!.photoUrl).toBe('/api/v1/public/players/m1/photo');
    expect(res.players.find((p) => p.id === 'm2')!.photoUrl).toBeNull();
    expect(res.players.find((p) => p.id === 'm3')!.photoUrl).toBeNull();
    expect(Object.keys(res.players[0]!).sort()).toEqual(['firstName', 'id', 'lastName', 'photoUrl']);
  });
});

describe('foto hráča', () => {
  it('vyžaduje súhlas profil + foto a nie demo', async () => {
    prisma.member.findFirst.mockResolvedValue(null);
    expect(await service.playerPhoto('m1')).toBeNull();
    const arg = prisma.member.findFirst.mock.calls[0]![0];
    expect(arg.where).toMatchObject({ id: 'm1', isDemo: false, publicProfileConsent: true, publicPhotoConsent: true });
    expect(arg.select).toEqual({ photo: { select: { dataUrl: true } } });
  });
  it('bez fotky → null; s fotkou → buffer + mime', async () => {
    prisma.member.findFirst.mockResolvedValue({ photo: null });
    expect(await service.playerPhoto('m1')).toBeNull();
    prisma.member.findFirst.mockResolvedValue({ photo: { dataUrl: `data:image/png;base64,${Buffer.from('abc').toString('base64')}` } });
    const p = await service.playerPhoto('m1');
    expect(p!.mime).toBe('image/png');
    expect(p!.buffer.toString()).toBe('abc');
  });
  it('SVG ani neplatné data URL sa neservírujú', () => {
    expect(decodePhotoDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(decodePhotoDataUrl('https://x/y.jpg')).toBeNull();
  });
});

describe('udalosti', () => {
  it('where: nie demo, aktívna sezóna, družstvo, len MATCH/TOURNAMENT alebo verejný TRAINING', async () => {
    await service.events({});
    const arg = prisma.event.findMany.mock.calls[0]![0];
    const base = arg.where.AND[0];
    expect(base).toEqual({
      isDemo: false,
      seasonId: 's-db',
      teamId: { not: null },
      team: { isDemo: false },
      OR: [{ type: { in: ['MATCH', 'TOURNAMENT'] } }, { type: 'TRAINING', isPublic: true }],
    });
    expect(arg.take).toBe(200);
    const keys = allKeys(arg.select);
    for (const forbidden of ['attendances', 'nominations', 'notes', 'meetAt', 'jerseyColor', 'videoUrl', 'highlightsUrl', 'createdById', 'futbalnetId', 'recurrenceGroupId', 'isPublic']) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it('CLUB_EVENT/PARENT_MEETING a udalosť bez družstva sa nevrátia ani pri chybnom riadku', () => {
    expect(toEventDto(eventRow({ type: 'CLUB_EVENT' }), CLUB)).toBeNull();
    expect(toEventDto(eventRow({ type: 'PARENT_MEETING' }), CLUB)).toBeNull();
    expect(toEventDto(eventRow({ team: null }), CLUB)).toBeNull();
  });

  it('filtre: type, from/to ako kalendárne dni, limit max 500, neplatné → 400', async () => {
    await service.events({ type: 'training', from: '2030-09-01', to: '2030-09-30', limit: '9999', teamId: 't1', categoryCode: 'U10' });
    const arg = prisma.event.findMany.mock.calls[0]![0];
    expect(arg.where.AND).toEqual(
      expect.arrayContaining([
        { type: 'TRAINING' },
        { teamId: 't1' },
        { team: { teamCategory: { code: 'U10' } } },
        { startAt: { gte: new Date('2030-09-01T00:00:00Z') } },
        { startAt: { lt: new Date('2030-10-01T00:00:00Z') } },
      ]),
    );
    expect(arg.take).toBe(500);
    await expect(service.events({ type: 'club' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.events({ from: '2030-13-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.events({ limit: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('toEventDto vracia address (orezanú) alebo null', () => {
    expect(toEventDto(eventRow({ address: '  Futbalová 1  ' }), CLUB)!.address).toBe('Futbalová 1');
    expect(toEventDto(eventRow({ address: null }), CLUB)!.address).toBeNull();
    expect(toEventDto(eventRow({ address: '   ' }), CLUB)!.address).toBeNull();
  });

  it('domáci: isHome=true → my domáci, skóre z pohľadu domácich', () => {
    const e = toEventDto(eventRow(), CLUB)!;
    expect(e.state).toBe('FINISHED');
    expect(e.match).toEqual({
      homeName: 'FK Košická Nová Ves',
      awayName: 'Lokomotíva',
      isHome: true,
      opponent: 'Lokomotíva',
      opponentLogoUrl: null,
      competition: 'Liga',
      homeScore: 3,
      awayScore: 1,
    });
  });

  it('logo súpera: z Match.opponentLogo, inak z registra klubov; nebezpečné URL sa zahodia', () => {
    const base = eventRow();
    const withLogo = toEventDto(eventRow({ match: { ...base.match!, opponentLogo: 'https://cdn.example.sk/l.png' } }), CLUB)!;
    expect(withLogo.match!.opponentLogoUrl).toBe('https://cdn.example.sk/l.png');
    const fromRegistry = toEventDto(base, CLUB, new Map([['Lokomotíva', 'https://reg.example.sk/x.png']]))!;
    expect(fromRegistry.match!.opponentLogoUrl).toBe('https://reg.example.sk/x.png');
    const evil = toEventDto(eventRow({ match: { ...base.match!, opponentLogo: 'javascript:alert(1)' } }), CLUB, new Map([['Lokomotíva', 'data:image/png;base64,AAAA']]))!;
    expect(evil.match!.opponentLogoUrl).toBeNull();
    expect(safeLogoUrl('ftp://x/y.png')).toBeNull();
    expect(safeLogoUrl('https://x.sk/a b.png')).toBeNull();
    expect(opponentsMissingLogo([base])).toEqual(['Lokomotíva']);
    expect(opponentsMissingLogo([eventRow({ match: { ...base.match!, opponentLogo: 'https://cdn.example.sk/l.png' } })])).toEqual([]);
  });

  it('vonku: isHome=false → súper domáci, skóre otočené; názov s družstvom', () => {
    const e = toEventDto(
      eventRow({
        team: { id: 't2', name: 'U10 B', teamCategory: { code: 'U10', name: 'U10' } },
        match: { opponent: 'Lokomotíva', isHome: false, competition: null, scoreUs: 2, scoreThem: 4, state: 'FINISHED' },
      }),
      CLUB,
    )!;
    expect(e.match!.homeName).toBe('Lokomotíva');
    expect(e.match!.awayName).toBe('FK Košická Nová Ves U10 B');
    expect(e.match!.homeScore).toBe(4);
    expect(e.match!.awayScore).toBe(2);
  });

  it('stav: PLANNED→SCHEDULED bez skóre, CANCELLED bez skóre, LIVE s priebežným skóre, tréning SCHEDULED', () => {
    const planned = toEventDto(eventRow({ match: { ...eventRow().match!, state: 'PLANNED' } }), CLUB)!;
    expect(planned.state).toBe('SCHEDULED');
    expect(planned.match!.homeScore).toBeNull();
    const cancelled = toEventDto(eventRow({ match: { ...eventRow().match!, state: 'CANCELLED' } }), CLUB)!;
    expect(cancelled.state).toBe('CANCELLED');
    expect(cancelled.match!.awayScore).toBeNull();
    const live = toEventDto(eventRow({ match: { ...eventRow().match!, state: 'LIVE' } }), CLUB)!;
    expect(live.state).toBe('LIVE');
    expect(live.match!.homeScore).toBe(3);
    const training = toEventDto(eventRow({ type: 'TRAINING', match: null }), CLUB)!;
    expect(training.state).toBe('SCHEDULED');
    expect(training.match).toBeNull();
  });

  it('nástenný čas → skutočný UTC okamih (leto +2, zima +1)', () => {
    expect(wallClockToInstant(new Date('2030-09-12T17:00:00Z'), 'Europe/Bratislava').toISOString()).toBe('2030-09-12T15:00:00.000Z');
    expect(wallClockToInstant(new Date('2030-12-12T17:00:00Z'), 'Europe/Bratislava').toISOString()).toBe('2030-12-12T16:00:00.000Z');
    expect(toEventDto(eventRow(), CLUB)!.startAt).toBe('2030-09-12T15:00:00.000Z');
  });

  it('detail neverejnej udalosti → 404', async () => {
    prisma.event.findFirst.mockResolvedValue(null);
    await expect(service.event('x')).rejects.toBeInstanceOf(NotFoundException);
    const arg = prisma.event.findFirst.mock.calls[0]![0];
    expect(arg.where.AND[0]).toEqual({ id: 'x' });
    expect(arg.where.AND[1].OR).toEqual([{ type: { in: ['MATCH', 'TOURNAMENT'] } }, { type: 'TRAINING', isPublic: true }]);
  });
});

describe('články', () => {
  it('len publikované (publishedAt <= now), zoradené desc', async () => {
    await service.articles();
    const arg = prisma.article.findMany.mock.calls[0]![0];
    expect(arg.where.publishedAt.not).toBeNull();
    expect(arg.where.publishedAt.lte).toBeInstanceOf(Date);
    expect(arg.orderBy[0]).toEqual({ publishedAt: 'desc' });
    expect(arg.select.body).toBeUndefined();
    expect(arg.select).toMatchObject({ isArchive: true, sourceUrl: true });
    expect(arg.select.authorId).toBeUndefined();
  });
  it('zoznam vracia isArchive a sourceUrl', async () => {
    prisma.article.findMany.mockResolvedValue([
      { id: 'a1', slug: 's', title: 'T', excerpt: 'E', publishedAt: new Date('2020-01-01T00:00:00Z'), isArchive: true, sourceUrl: 'https://old.sk/x' },
    ]);
    expect(await service.articles()).toEqual([
      { id: 'a1', slug: 's', title: 'T', excerpt: 'E', publishedAt: '2020-01-01T00:00:00.000Z', isArchive: true, sourceUrl: 'https://old.sk/x' },
    ]);
  });
  it('nepublikovaný článok → 404', async () => {
    prisma.article.findFirst.mockResolvedValue(null);
    await expect(service.article('koncept')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.article.findFirst.mock.calls[0]![0].where.publishedAt.lte).toBeInstanceOf(Date);
  });
  it('paragraphs: split podľa prázdneho riadku, trim, bez prázdnych', async () => {
    expect(splitParagraphs('  Prvý odsek.\r\n\r\n\n  Druhý\nriadok.  \n \nTretí\n\n')).toEqual(['Prvý odsek.', 'Druhý\nriadok.', 'Tretí']);
    prisma.article.findFirst.mockResolvedValue({
      id: 'a1',
      slug: 'leto',
      title: 'Leto',
      excerpt: 'Úvod',
      publishedAt: new Date('2030-01-01T10:00:00Z'),
      isArchive: false,
      sourceUrl: null,
      body: 'A\n\nB',
    });
    expect(await service.article('leto')).toEqual({
      id: 'a1',
      slug: 'leto',
      title: 'Leto',
      excerpt: 'Úvod',
      publishedAt: '2030-01-01T10:00:00.000Z',
      isArchive: false,
      sourceUrl: null,
      paragraphs: ['A', 'B'],
    });
  });
});

describe('rate-limit', () => {
  it('interné volanie (docker, bez XFF) sa nepočíta; cez proxy áno', () => {
    expect(isInternalRequest({ headers: {}, socket: { remoteAddress: '172.18.0.5' } } as never)).toBe(true);
    expect(isInternalRequest({ headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '172.18.0.3' } } as never)).toBe(false);
    expect(isInternalRequest({ headers: {}, socket: { remoteAddress: '8.8.8.8' } } as never)).toBe(false);
  });
});

const PUBLIC_WHERE = { in: ['PUBLISHED', 'ARCHIVED'] };

describe('klubové stránky', () => {
  it('zoznam len PUBLISHED/ARCHIVED, select slug/title/status', async () => {
    prisma.clubPage.findMany.mockResolvedValue([
      { slug: 'historia', title: 'História', status: 'ARCHIVED' },
      { slug: 'koncept', title: 'K', status: 'DRAFT' },
    ]);
    const res = await service.pages();
    const arg = prisma.clubPage.findMany.mock.calls[0]![0];
    expect(arg.where).toEqual({ status: PUBLIC_WHERE });
    expect(arg.select).toEqual({ slug: true, title: true, status: true });
    expect(res).toEqual([{ slug: 'historia', title: 'História', status: 'ARCHIVED' }]);
  });

  it('DRAFT / neexistujúca stránka → 404', async () => {
    prisma.clubPage.findFirst.mockResolvedValue(null);
    await expect(service.page('koncept')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.clubPage.findFirst.mock.calls[0]![0].where).toEqual({ slug: 'koncept', status: PUBLIC_WHERE });
    prisma.clubPage.findFirst.mockResolvedValue({
      slug: 'x', title: 'X', body: '', status: 'DRAFT', sourceUrl: null, sourceNote: null, updatedAt: new Date(),
    });
    await expect(service.page('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ARCHIVED sa vráti so status ARCHIVED a sekciami', async () => {
    prisma.clubPage.findFirst.mockResolvedValue({
      slug: 'historia',
      title: 'História',
      body: 'Úvod.\n\n## Začiatky\nKlub vznikol.\n\nDruhý odsek.',
      status: 'ARCHIVED',
      sourceUrl: 'https://old.sk/historia',
      sourceNote: 'Prevzaté z pôvodného webu',
      updatedAt: new Date('2026-10-01T08:00:00Z'),
    });
    const res = await service.page('historia');
    expect(res).toEqual({
      slug: 'historia',
      title: 'História',
      sections: [
        { heading: null, paragraphs: ['Úvod.'] },
        { heading: 'Začiatky', paragraphs: ['Klub vznikol.', 'Druhý odsek.'] },
      ],
      status: 'ARCHIVED',
      sourceUrl: 'https://old.sk/historia',
      sourceNote: 'Prevzaté z pôvodného webu',
      updatedAt: '2026-10-01T08:00:00.000Z',
    });
    expect(prisma.clubPage.findFirst.mock.calls[0]![0].select.updatedById).toBeUndefined();
    expect(prisma.clubPage.findFirst.mock.calls[0]![0].select.confirmedAt).toBeUndefined();
  });

  it('sections: ## podnadpis, odseky podľa prázdneho riadku, trim, CRLF, prázdne sekcie bez nadpisu vynechané', () => {
    expect(parseSections('')).toEqual([]);
    expect(parseSections('## A\r\n  text  \r\n\r\n\r\n ďalší \n## B\n## C\nposledný')).toEqual([
      { heading: 'A', paragraphs: ['text', 'ďalší'] },
      { heading: 'B', paragraphs: [] },
      { heading: 'C', paragraphs: ['posledný'] },
    ]);
    expect(parseSections('###nie\n#jeden\n<b>x</b>')).toEqual([{ heading: null, paragraphs: ['###nie\n#jeden\n<b>x</b>'] }]);
  });
});

describe('funkcionári a tréneri', () => {
  it('DRAFT sa nevráti; PUBLISHED pred ARCHIVED, potom skupina/poradie/meno', async () => {
    const base = { teamNote: null, phone: null, email: null, sourceUrl: null, sourceNote: null, sortOrder: 0 };
    prisma.clubPerson.findMany.mockResolvedValue([
      { ...base, id: 'arch', name: 'Starý', role: 'Predseda', group: 'MANAGEMENT', status: 'ARCHIVED' },
      { ...base, id: 'coach', name: 'Adam', role: 'Tréner', group: 'COACH', status: 'PUBLISHED' },
      { ...base, id: 'draft', name: 'Koncept', role: 'X', group: 'MANAGEMENT', status: 'DRAFT' },
      { ...base, id: 'boss', name: 'Zuzana', role: 'Predsedníčka', group: 'MANAGEMENT', status: 'PUBLISHED' },
    ]);
    const res = await service.people();
    expect(prisma.clubPerson.findMany.mock.calls[0]![0].where).toEqual({ status: PUBLIC_WHERE });
    expect(res.map((p) => p.id)).toEqual(['boss', 'coach', 'arch']);
    expect(res[2]!.status).toBe('ARCHIVED');
    expect(Object.keys(res[0]!).sort()).toEqual(
      ['email', 'group', 'id', 'name', 'phone', 'role', 'sourceNote', 'sourceUrl', 'status', 'teamNote'].sort(),
    );
    const keys = allKeys(prisma.clubPerson.findMany.mock.calls[0]![0].select);
    expect(keys.has('confirmedAt')).toBe(false);
  });
});

describe('dokumenty', () => {
  const doc = (over: Record<string, unknown>) => ({
    id: 'd',
    title: 'Dok',
    description: null,
    category: 'CONTRACT',
    documentDate: null,
    status: 'PUBLISHED',
    mimeType: 'application/pdf',
    size: 1234,
    sha256: 'abc',
    sourceUrl: 'https://old.sk/d.pdf',
    sourceNote: null,
    ...over,
  });

  it('zoznam neobsahuje data, DRAFT nie, PUBLISHED pred ARCHIVED, downloadUrl len so súborom', async () => {
    prisma.clubDocument.findMany.mockResolvedValue([
      doc({ id: 'a1', status: 'ARCHIVED', documentDate: new Date('2025-05-01T00:00:00Z') }),
      doc({ id: 'p1', documentDate: new Date('2024-01-15T00:00:00Z'), size: null, sha256: null, mimeType: null }),
      doc({ id: 'dr', status: 'DRAFT' }),
      doc({ id: 'p2', documentDate: null }),
    ]);
    const res = await service.documents();
    const arg = prisma.clubDocument.findMany.mock.calls[0]![0];
    expect(arg.where).toEqual({ status: PUBLIC_WHERE });
    expect(arg.select.data).toBeUndefined();
    expect(arg.orderBy[0]).toEqual({ documentDate: { sort: 'desc', nulls: 'last' } });
    expect(res.map((d) => d.id)).toEqual(['p1', 'p2', 'a1']);
    expect(res[0]).toMatchObject({ documentDate: '2024-01-15', downloadUrl: null, sizeBytes: null });
    expect(res[1]).toMatchObject({ downloadUrl: '/api/v1/public/documents/p2/file', sizeBytes: 1234, status: 'PUBLISHED' });
    expect(res[2]!.status).toBe('ARCHIVED');
    for (const d of res) expect(d).not.toHaveProperty('data');
    expect(JSON.stringify(res)).not.toContain('sha256');
  });

  it('filter kategórie; neplatná → 400', async () => {
    await service.documents('SUBSIDY');
    expect(prisma.clubDocument.findMany.mock.calls[0]![0].where).toEqual({ status: PUBLIC_WHERE, category: 'SUBSIDY' });
    await expect(service.documents('SECRET')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('súbor: DRAFT / bez dát → null (404); where vyžaduje verejný stav a data', async () => {
    prisma.clubDocument.findFirst.mockResolvedValue(null);
    expect(await service.documentFile('d1')).toBeNull();
    expect(prisma.clubDocument.findFirst.mock.calls[0]![0].where).toEqual({
      id: 'd1',
      status: PUBLIC_WHERE,
      data: { not: null },
    });
    expect(prisma.clubDocument.findFirst.mock.calls[0]![0].select).toEqual({ data: true, mimeType: true, originalFilename: true });
    prisma.clubDocument.findFirst.mockResolvedValue({ data: null, mimeType: 'application/pdf', originalFilename: 'a.pdf' });
    expect(await service.documentFile('d1')).toBeNull();
  });

  it('controller: 404 bez súboru; s súborom bajty a bezpečné hlavičky', async () => {
    const controller = new PublicController(service);
    const makeRes = () => {
      const headers: Record<string, string> = {};
      const res = {
        statusCode: 200,
        body: undefined as unknown,
        status(c: number) { this.statusCode = c; return this; },
        setHeader(k: string, v: string) { headers[k] = v; return this; },
        end(b?: unknown) { this.body = b; },
      };
      return { res, headers };
    };
    prisma.clubDocument.findFirst.mockResolvedValue(null);
    const r404 = makeRes();
    await controller.documentFile('x', r404.res as never);
    expect(r404.res.statusCode).toBe(404);

    const bytes = Buffer.from('%PDF-1.4 obsah');
    prisma.clubDocument.findFirst.mockResolvedValue({ data: new Uint8Array(bytes), mimeType: 'application/pdf', originalFilename: 'Zmluva č.1.pdf' });
    const ok = makeRes();
    await controller.documentFile('d1', ok.res as never);
    expect(ok.res.statusCode).toBe(200);
    expect(Buffer.compare(ok.res.body as Buffer, bytes)).toBe(0);
    expect(ok.headers['Content-Type']).toBe('application/pdf');
    expect(ok.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(ok.headers['Cache-Control']).toBe('public, max-age=300');
    expect(ok.headers['Content-Length']).toBe(String(bytes.length));
    expect(ok.headers['Content-Disposition']).toBe(
      `inline; filename="Zmluva c.1.pdf"; filename*=UTF-8''Zmluva%20%C4%8D.1.pdf`,
    );
  });

  it('hlavičky: nepovolený typ → octet-stream + attachment; názov bez CR/LF a úvodzoviek', () => {
    const h = documentFileHeaders({ mimeType: 'text/html', originalFilename: 'a"\r\nSet-Cookie: x.html', size: 5 });
    expect(h['Content-Type']).toBe('application/octet-stream');
    expect(h['Content-Disposition'].startsWith('attachment; ')).toBe(true);
    expect(h['Content-Disposition']).not.toMatch(/[\r\n]/);
    expect(h['Content-Disposition']).toContain('filename="aSet-Cookie: x.html"');
    const zip = documentFileHeaders({ mimeType: 'application/zip', originalFilename: null, size: 1 });
    expect(zip['Content-Type']).toBe('application/zip');
    expect(zip['Content-Disposition']).toBe(`attachment; filename="dokument"; filename*=UTF-8''dokument`);
    expect(documentFileHeaders({ mimeType: 'image/png', originalFilename: 'f.png', size: 1 })['Content-Disposition']).toMatch(/^inline;/);
  });
});

describe('priateľský zápas a turnaj vo verejnom API', () => {
  it('isFriendly → competition „Priateľský zápas"', () => {
    const row = eventRow({ match: { ...eventRow().match!, isFriendly: true, competition: null } });
    expect(toEventDto(row, CLUB)?.match?.competition).toBe('Priateľský zápas');
    expect(toEventDto(eventRow(), CLUB)?.match?.competition).toBe('Liga');
  });

  it('select obsahuje isFriendly', async () => {
    await service.events({} as never);
    const arg = prisma.event.findMany.mock.calls[0]![0];
    expect(allKeys(arg.select).has('isFriendly')).toBe(true);
  });

  it('turnaj bez Match → TOURNAMENT s match: null', () => {
    const dto = toEventDto(eventRow({ type: 'TOURNAMENT', match: null }), CLUB);
    expect(dto).toMatchObject({ type: 'TOURNAMENT', state: 'SCHEDULED', match: null });
  });
});
