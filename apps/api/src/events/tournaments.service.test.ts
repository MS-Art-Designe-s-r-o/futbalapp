import { describe, expect, it, vi } from 'vitest';
import { createEventSchema, createTournamentMatchSchema, tournamentParticipantsSchema } from '@fkknv/shared';
import { EventsService } from './events.service';
import { TournamentsService } from './tournaments.service';

const admin = { id: 'u1', roles: [{ role: 'ADMIN' }] } as never;
const otherCoach = { id: 'u2', roles: [{ role: 'COACH', teamId: 't9' }] } as never;

/** Register klubov v pamäti (findFirst case-insensitive + ClubsService.create). */
function clubRegistry(initial: Array<{ name: string; logoUrl: string | null }>) {
  const list = initial.map((c, i) => ({ id: `c${i}`, ...c }));
  const club = {
    findFirst: vi.fn(async ({ where }: { where: { name: { equals: string } } }) =>
      list.find((c) => c.name.toLowerCase() === where.name.equals.toLowerCase()) ?? null,
    ),
  };
  const clubs = {
    create: vi.fn(async ({ name }: { name: string }) => {
      const c = { id: `c${list.length}`, name, logoUrl: null };
      list.push(c);
      return c;
    }),
    logoForName: vi.fn(async () => null),
    ensure: vi.fn(async () => undefined),
  };
  return { list, club, clubs };
}

function child(id: string, order: number | null, opponent: string, startAt: string, over: Record<string, unknown> = {}) {
  return {
    id,
    tournamentOrder: order,
    startAt: new Date(startAt),
    endAt: null,
    location: 'Ihrisko',
    match: {
      id: `m-${id}`,
      opponent,
      opponentLogo: null,
      state: 'PLANNED',
      scoreUs: null,
      scoreThem: null,
      timerPhase: 'NOT_STARTED',
      _count: { events: 0, nominations: 0 },
      ...over,
    },
  };
}

function tournament(over: Record<string, unknown> = {}) {
  return {
    id: 'tr1',
    type: 'TOURNAMENT',
    isDemo: false,
    seasonId: 's1',
    teamId: 't1',
    title: 'Turnaj U10',
    startAt: new Date('2030-05-01T09:00:00Z'),
    endAt: new Date('2030-05-01T15:00:00Z'),
    location: 'Hala',
    address: 'Ulica 1',
    surface: 'UT',
    pitchId: 'p1',
    team: { id: 't1', name: 'U10' },
    match: null,
    tournamentParticipants: [
      { id: 'tp1', clubName: 'Lokomotíva', logoUrl: 'https://x/l.png', sortOrder: 0 },
      { id: 'tp2', clubName: 'Slavia', logoUrl: null, sortOrder: 1 },
    ],
    children: [] as ReturnType<typeof child>[],
    tournamentNominations: [] as Array<{ memberId: string; member?: { id: string; firstName: string; lastName: string } }>,
    ...over,
  };
}

const baseMember = {
  id: 'mb1',
  isDemo: false,
  status: 'ACTIVE',
  userId: 'pu1',
  firstName: 'Ján',
  lastName: 'Novák',
  guardians: [{ userId: 'g1' }],
  memberships: [{ id: 'ms1' }],
};

function makeTournaments(
  t: ReturnType<typeof tournament> | null,
  member: Record<string, unknown> | null = baseMember,
  members: unknown[] = [],
) {
  const reg = clubRegistry([
    { name: 'Lokomotíva', logoUrl: 'https://x/l.png' },
    { name: 'Slavia', logoUrl: null },
  ]);
  const push = { notifyUsers: vi.fn(async () => undefined) };
  const prisma = {
    club: reg.club,
    event: {
      findUnique: vi.fn(async () => t),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ev-new', ...data, match: { id: 'm-new' } })),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    match: { update: vi.fn(async () => ({})) },
    pitch: { findUnique: vi.fn(async () => ({ id: 'p2', name: 'Umelka', surface: 'UT2', address: 'Iná 5' })) },
    member: { findUnique: vi.fn(async () => member), findMany: vi.fn(async () => members) },
    tournamentNomination: { upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 1 })) },
    matchNomination: {
      upsert: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 2 })),
    },
    tournamentParticipant: {
      deleteMany: vi.fn(() => 'del'),
      update: vi.fn(() => 'upd'),
      create: vi.fn(() => 'cre'),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  return { prisma, reg, push, service: new TournamentsService(prisma as never, reg.clubs as never, push as never) };
}

describe('zmluva (zod)', () => {
  it('participants: trim, bez duplicít, max 40', () => {
    const r = tournamentParticipantsSchema.parse({ clubs: [' Slavia ', 'slavia', 'Lokomotíva'] });
    expect(r.clubs).toEqual(['Slavia', 'Lokomotíva']);
    expect(tournamentParticipantsSchema.safeParse({ clubs: Array.from({ length: 41 }, (_, i) => `K${i}`) }).success).toBe(false);
    expect(tournamentParticipantsSchema.safeParse({ clubs: ['x'.repeat(121)] }).success).toBe(false);
    expect(createTournamentMatchSchema.safeParse({ opponent: '  ' }).success).toBe(false);
  });

  it('POST /events: turnaj s participants aj starý turnaj so súperom, zápas s friendly', () => {
    const base = { title: 'Turnaj', teamId: 't1', startAt: '2030-05-01T09:00:00Z' };
    expect(createEventSchema.parse({ ...base, type: 'TOURNAMENT', participants: ['A', 'a', 'B'] }).participants).toEqual(['A', 'B']);
    expect(createEventSchema.safeParse({ ...base, type: 'TOURNAMENT', opponent: 'Slavia' }).success).toBe(true);
    expect(createEventSchema.parse({ ...base, type: 'MATCH', opponent: 'X', friendly: true }).friendly).toBe(true);
    // PATCH /events používa .partial() — musí ostať ZodObject
    expect(createEventSchema.partial().safeParse({ friendly: false }).success).toBe(true);
  });
});

describe('vytvorenie turnaja a priateľského zápasu (POST /events)', () => {
  function makeEvents() {
    const reg = clubRegistry([{ name: 'Lokomotíva', logoUrl: 'https://x/l.png' }]);
    const prisma = {
      season: { findFirst: vi.fn(async () => ({ id: 's1' })) },
      team: { findUnique: vi.fn(async () => ({ id: 't1' })) },
      pitch: { findUnique: vi.fn(async () => null) },
      club: reg.club,
      event: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'e1', ...data })) },
      tournamentParticipant: { createMany: vi.fn(async () => ({ count: 2 })) },
    };
    return { prisma, reg, service: new EventsService(prisma as never, reg.clubs as never, {} as never) };
  }

  it('turnaj: bez Match, účastníci uložení, nový klub doplnený do registra bez loga, existujúci prevezme logo', async () => {
    const { service, prisma, reg } = makeEvents();
    await service.create(
      { type: 'TOURNAMENT', title: 'Turnaj', teamId: 't1', startAt: new Date('2030-05-01T09:00:00Z'), participants: ['lokomotíva', 'Nový FK'] } as never,
      'u1',
    );
    const data = prisma.event.create.mock.calls[0]![0].data;
    expect(data.type).toBe('TOURNAMENT');
    expect(data.match).toBeUndefined();
    expect(reg.clubs.create).toHaveBeenCalledWith({ name: 'Nový FK' });
    expect(reg.clubs.create).toHaveBeenCalledTimes(1);
    expect(prisma.tournamentParticipant.createMany.mock.calls[0]![0].data).toEqual([
      { eventId: 'e1', clubName: 'Lokomotíva', logoUrl: 'https://x/l.png', sortOrder: 0 },
      { eventId: 'e1', clubName: 'Nový FK', logoUrl: null, sortOrder: 1 },
    ]);
  });

  it('starý turnaj so súperom (bez participants) má Match ako doteraz', async () => {
    const { service, prisma } = makeEvents();
    await service.create({ type: 'TOURNAMENT', title: 'Turnaj', teamId: 't1', startAt: new Date(), opponent: 'Slavia' } as never, 'u1');
    const data = prisma.event.create.mock.calls[0]![0].data;
    expect(data.match.create).toMatchObject({ opponent: 'Slavia', isFriendly: false });
  });

  it('priateľský zápas: isFriendly, source INTERNAL (default), bez futbalnetId', async () => {
    const { service, prisma } = makeEvents();
    await service.create({ type: 'MATCH', title: 'Priateľák', teamId: 't1', startAt: new Date(), opponent: 'Lokomotíva', friendly: true } as never, 'u1');
    const data = prisma.event.create.mock.calls[0]![0].data;
    expect(data.match.create.isFriendly).toBe(true);
    expect(data.futbalnetId).toBeUndefined();
    expect(data.source === undefined || data.source === 'INTERNAL').toBe(true);
  });

  it('dresy sa uložia pri bežnom aj priateľskom zápase; bez zadania null', async () => {
    const { service, prisma } = makeEvents();
    for (const friendly of [false, true]) {
      await service.create({ type: 'MATCH', title: 'Z', teamId: 't1', startAt: new Date(), opponent: 'X', friendly, jerseyColor: 'DARK', opponentJerseyColor: 'LIGHT' } as never, 'u1');
    }
    await service.create({ type: 'MATCH', title: 'Z', teamId: 't1', startAt: new Date(), opponent: 'X' } as never, 'u1');
    const calls = prisma.event.create.mock.calls.map((c) => c[0].data.match.create);
    expect(calls[0]).toMatchObject({ isFriendly: false, jerseyColor: 'DARK', opponentJerseyColor: 'LIGHT' });
    expect(calls[1]).toMatchObject({ isFriendly: true, jerseyColor: 'DARK', opponentJerseyColor: 'LIGHT' });
    expect(calls[2]).toMatchObject({ jerseyColor: null, opponentJerseyColor: null });
  });

  it('bežný zápas nie je priateľský', async () => {
    const { service, prisma } = makeEvents();
    await service.create({ type: 'MATCH', title: 'Z', teamId: 't1', startAt: new Date(), opponent: 'X' } as never, 'u1');
    expect(prisma.event.create.mock.calls[0]![0].data.match.create.isFriendly).toBe(false);
  });
});

describe('zápasy turnaja', () => {
  it('pridať zápas len so súperom z účastníkov (inak 400)', async () => {
    const { service, prisma } = makeTournaments(tournament());
    await expect(service.addMatch('tr1', { opponent: 'Iný klub' }, admin)).rejects.toMatchObject({ status: 400 });
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('pridaný zápas: MATCH s parentEventId, poradie 1, čas turnaja, logo účastníka, zdedí plochu turnaja', async () => {
    const { service, prisma } = makeTournaments(tournament());
    const res = await service.addMatch('tr1', { opponent: 'lokomotíva' }, admin);
    expect(res).toEqual({ eventId: 'ev-new', matchId: 'm-new', order: 1 });
    const data = prisma.event.create.mock.calls[0]![0].data as Record<string, any>;
    expect(data).toMatchObject({
      type: 'MATCH',
      teamId: 't1',
      parentEventId: 'tr1',
      tournamentOrder: 1,
      title: 'Turnaj U10: 1. zápas',
      startAt: new Date('2030-05-01T09:00:00Z'),
      source: 'INTERNAL',
    });
    expect(data).toMatchObject({ pitchId: 'p1', location: 'Hala', address: 'Ulica 1', surface: 'UT' });
    expect(data.futbalnetId).toBeUndefined();
    expect(data.match.create).toEqual({
      opponent: 'Lokomotíva',
      opponentLogo: 'https://x/l.png',
      isHome: false,
      isFriendly: false,
      jerseyColor: null,
      opponentJerseyColor: null,
    });
  });

  it('zápas turnaja: vlastný pitchId prepíše plochu; dresy sa uložia; kontrola obsadenosti sa nevolá', async () => {
    const { service, prisma } = makeTournaments(tournament());
    await service.addMatch('tr1', { opponent: 'Slavia', pitchId: 'p2', jerseyColor: 'DARK', opponentJerseyColor: 'LIGHT' }, admin);
    const data = prisma.event.create.mock.calls[0]![0].data as Record<string, any>;
    expect(data).toMatchObject({ pitchId: 'p2', location: 'Umelka', surface: 'UT2', address: 'Iná 5' });
    expect(data.match.create).toMatchObject({ jerseyColor: 'DARK', opponentJerseyColor: 'LIGHT' });
    expect(prisma.event.findMany).toBeUndefined(); // assertPitchFree (event.findMany) sa nevolá
  });

  it('PATCH zápasu turnaja: dresy sa uložia, null maže, plocha sa zmení', async () => {
    const t = tournament({ children: [child('a', 1, 'Slavia', '2030-05-01T09:00:00Z')] });
    const { service, prisma } = makeTournaments(t);
    await service.updateMatch('tr1', 'a', { jerseyColor: 'LIGHT', opponentJerseyColor: null, pitchId: 'p2' }, admin);
    expect(prisma.match.update).toHaveBeenCalledWith({ where: { id: 'm-a' }, data: { jerseyColor: 'LIGHT', opponentJerseyColor: null } });
    expect(prisma.event.update.mock.calls[0]![0].data).toMatchObject({ pitchId: 'p2', location: 'Umelka', surface: 'UT2', address: 'Iná 5' });
  });

  it('schémy: dresy a pitchId pri zápase turnaja, null povolený', () => {
    expect(createTournamentMatchSchema.parse({ opponent: 'X', pitchId: 'p', jerseyColor: 'DARK', opponentJerseyColor: null })).toMatchObject({ pitchId: 'p', opponentJerseyColor: null });
    expect(createTournamentMatchSchema.safeParse({ opponent: 'X', jerseyColor: 'RED' }).success).toBe(false);
    expect(createEventSchema.parse({ title: 'Zápas', type: 'MATCH', startAt: '2030-05-01T09:00:00Z', opponentJerseyColor: 'LIGHT' }).opponentJerseyColor).toBe('LIGHT');
  });

  it('poradie: predvolene max+1, duplicita → 409', async () => {
    const t = tournament({ children: [child('a', 1, 'Slavia', '2030-05-01T09:00:00Z'), child('b', 3, 'Lokomotíva', '2030-05-01T10:00:00Z')] });
    const { service } = makeTournaments(t);
    expect((await service.addMatch('tr1', { opponent: 'Slavia' }, admin)).order).toBe(4);
    await expect(service.addMatch('tr1', { opponent: 'Slavia', order: 3 }, admin)).rejects.toMatchObject({ status: 409 });
    await expect(service.updateMatch('tr1', 'a', { order: 3 }, admin)).rejects.toMatchObject({ status: 409 });
  });

  it('cudzí tréner nemôže upravovať (403)', async () => {
    const { service } = makeTournaments(tournament());
    await expect(service.addMatch('tr1', { opponent: 'Slavia' }, otherCoach)).rejects.toMatchObject({ status: 403 });
  });

  it('udalosť, ktorá nie je turnaj → 404', async () => {
    const { service } = makeTournaments(tournament({ type: 'MATCH' }));
    await expect(service.get('tr1', admin)).rejects.toMatchObject({ status: 404 });
  });

  it('zmazanie zápasu: len PLANNED bez nominácií a záznamov', async () => {
    const t = tournament({
      children: [
        child('ok', 1, 'Slavia', '2030-05-01T09:00:00Z'),
        child('live', 2, 'Slavia', '2030-05-01T10:00:00Z', { state: 'LIVE' }),
        child('nom', 3, 'Slavia', '2030-05-01T11:00:00Z', { _count: { events: 0, nominations: 2 } }),
        child('ev', 4, 'Slavia', '2030-05-01T12:00:00Z', { _count: { events: 1, nominations: 0 } }),
      ],
    });
    const { service, prisma } = makeTournaments(t);
    for (const id of ['live', 'nom', 'ev']) {
      await expect(service.removeMatch('tr1', id, admin)).rejects.toMatchObject({ status: 400 });
    }
    expect(prisma.event.delete).not.toHaveBeenCalled();
    await expect(service.removeMatch('tr1', 'ok', admin)).resolves.toEqual({ deleted: 1 });
    expect(prisma.event.delete).toHaveBeenCalledWith({ where: { id: 'ok' } });
  });

  it('GET: zápasy zoradené podľa poradia, potom času; turnaj bez Match', async () => {
    const t = tournament({
      children: [
        child('c', null, 'Slavia', '2030-05-01T08:00:00Z'),
        child('b', 2, 'Slavia', '2030-05-01T09:00:00Z'),
        child('a', 1, 'Lokomotíva', '2030-05-01T12:00:00Z'),
      ],
    });
    const { service } = makeTournaments(t);
    const res = await service.get('tr1', admin);
    expect(res.matches.map((m) => m.eventId)).toEqual(['a', 'b', 'c']);
    expect(res.matches[0]).toMatchObject({ matchId: 'm-a', order: 1, opponent: 'Lokomotíva', state: 'PLANNED' });
    expect(res.participants.map((p) => p.clubName)).toEqual(['Lokomotíva', 'Slavia']);
    expect(res.event).toMatchObject({ id: 'tr1', team: { id: 't1', name: 'U10' }, legacyMatchId: null });
  });

  it('PUT participants: odstránenie účastníka so zápasom → 400; nový klub do registra', async () => {
    const t = tournament({ children: [child('a', 1, 'Slavia', '2030-05-01T09:00:00Z')] });
    const { service, prisma, reg } = makeTournaments(t);
    await expect(service.setParticipants('tr1', ['Lokomotíva'], admin)).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await service.setParticipants('tr1', ['Slavia', 'Nový FK'], admin);
    expect(reg.clubs.create).toHaveBeenCalledWith({ name: 'Nový FK' });
    expect(prisma.tournamentParticipant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['tp1'] } } });
    expect(prisma.tournamentParticipant.update).toHaveBeenCalledWith({ where: { id: 'tp2' }, data: { sortOrder: 0, logoUrl: null } });
    expect(prisma.tournamentParticipant.create).toHaveBeenCalledWith({
      data: { eventId: 'tr1', clubName: 'Nový FK', logoUrl: null, sortOrder: 1 },
    });
  });
});

describe('nominácia turnaja', () => {
  const threeMatches = () => [
    child('a', 1, 'Slavia', '2030-05-01T09:00:00Z'),
    child('b', 2, 'Slavia', '2030-05-01T10:00:00Z', { state: 'LIVE' }),
    child('c', 3, 'Slavia', '2030-05-01T11:00:00Z', { state: 'FINISHED' }),
  ];

  it('pridanie propaguje do PLANNED/LIVE, nie FINISHED, a pošle jeden push', async () => {
    const { service, prisma, push } = makeTournaments(tournament({ children: threeMatches(), tournamentNominations: [] } as never));
    const r = await service.nominate('tr1', 'mb1', admin);
    expect(r).toEqual({ memberId: 'mb1', matchesUpdated: 2 });
    const ids = prisma.matchNomination.upsert.mock.calls.map((c) => (c[0] as { create: { matchId: string } }).create.matchId);
    expect(ids).toEqual(['m-a', 'm-b']);
    expect(prisma.tournamentNomination.upsert).toHaveBeenCalledTimes(1);
    expect(push.notifyUsers).toHaveBeenCalledTimes(1);
    expect((push.notifyUsers.mock.calls[0] as unknown[])[0]).toEqual(['g1', 'pu1']);
  });

  it('odobratie nastaví REMOVED len v PLANNED/LIVE a nepošle push', async () => {
    const { service, prisma, push } = makeTournaments(tournament({ children: threeMatches(), tournamentNominations: [] } as never));
    const r = await service.removeNomination('tr1', 'mb1', admin);
    expect(r).toEqual({ memberId: 'mb1', matchesUpdated: 2 });
    const arg = prisma.matchNomination.updateMany.mock.calls[0][0] as { where: { matchId: { in: string[] } }; data: unknown };
    expect(arg.where.matchId.in).toEqual(['m-a', 'm-b']);
    expect(arg.data).toEqual({ status: 'REMOVED' });
    expect(prisma.tournamentNomination.deleteMany).toHaveBeenCalled();
    expect(push.notifyUsers).not.toHaveBeenCalled();
  });

  it('nový zápas turnaja dostane nominovaných', async () => {
    const { service, prisma } = makeTournaments(
      tournament({ tournamentNominations: [{ memberId: 'mb1' }, { memberId: 'mb2' }] } as never),
    );
    await service.addMatch('tr1', { opponent: 'Slavia' } as never, admin);
    const ids = prisma.matchNomination.upsert.mock.calls.map((c) => (c[0] as { create: { memberId: string; matchId: string } }).create);
    expect(ids).toEqual([
      { matchId: 'm-new', memberId: 'mb1', status: 'NOMINATED' },
      { matchId: 'm-new', memberId: 'mb2', status: 'NOMINATED' },
    ]);
  });

  it('cudzí tréner 403, nečlen družstva 400', async () => {
    const a = makeTournaments(tournament({ tournamentNominations: [] } as never));
    await expect(a.service.nominate('tr1', 'mb1', otherCoach)).rejects.toMatchObject({ status: 403 });
    const b = makeTournaments(tournament({ tournamentNominations: [] } as never), { ...baseMember, memberships: [] });
    await expect(b.service.nominate('tr1', 'mb1', admin)).rejects.toMatchObject({ status: 400 });
    expect(b.prisma.tournamentNomination.upsert).not.toHaveBeenCalled();
  });

  it('candidates: nominovaní najprv, v skupinách abecedne', async () => {
    const members = [
      { id: '1', firstName: 'Zuzana', lastName: 'Čech' },
      { id: '2', firstName: 'Adam', lastName: 'Zelený' },
      { id: '3', firstName: 'Eva', lastName: 'Adamová' },
      { id: '4', firstName: 'Ivan', lastName: 'Šťastný' },
    ];
    const { service } = makeTournaments(tournament({ tournamentNominations: [{ memberId: '2' }, { memberId: '4' }] } as never), baseMember, members);
    const r = await service.candidates('tr1', admin);
    expect(r.map((x) => [x.id, x.nominated])).toEqual([['4', true], ['2', true], ['3', false], ['1', false]]);
  });
});
