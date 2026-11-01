import { afterEach, describe, expect, it, vi } from 'vitest';

const fixtures = [
  {
    id: 'a'.repeat(24),
    appSpace: 'vsfz',
    startAt: new Date('2030-09-12T15:00:00Z'),
    home: 'FK KNV',
    homeLogo: null,
    away: 'Lokomotíva',
    awayLogo: null,
  },
];
vi.mock('./sportnet.parser', () => ({
  parseSportnetProgram: () => fixtures,
  sportnetMatchKey: (f: { id: string }) => `sn:${f.id}`,
}));

import { FutbalnetService } from './futbalnet.service';
import { MatchSyncService } from './match-sync.service';

afterEach(() => vi.unstubAllGlobals());

const admin = { id: 'u1', roles: [{ role: 'ADMIN' }] } as never;

describe('futbalnet import nemení priateľské/ručné zápasy', () => {
  function make(existing: unknown) {
    const prisma = {
      team: { findUnique: vi.fn(async () => ({ id: 't1', name: 'U10', sportnetProgramUrl: 'https://x', sportnetTeamName: 'FK KNV' })) },
      season: { findFirst: vi.fn(async () => ({ id: 's1' })) },
      event: {
        findUnique: vi.fn(async () => existing),
        update: vi.fn(async () => ({})),
        create: vi.fn(async () => ({})),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      match: { update: vi.fn(async () => ({})) },
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '<html/>' })));
    const service = new FutbalnetService(prisma as never, { create: vi.fn(async () => ({})) } as never);
    return { prisma, service };
  }

  it('mazanie sa obmedzuje na source=FUTBALNET a nikdy nezasiahne priateľský zápas ani zápas turnaja', async () => {
    const { prisma, service } = make(null);
    await service.importTeamProgram('t1');
    const where = prisma.event.deleteMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toMatchObject({ teamId: 't1', source: 'FUTBALNET', parentEventId: null, NOT: { match: { isFriendly: true } } });
  });

  it('nový zápas z feedu vzniká ako FUTBALNET (priateľský sa neduplikuje ani nespája)', async () => {
    const { prisma, service } = make(null);
    await service.importTeamProgram('t1');
    expect(prisma.event.create.mock.calls[0]![0].data).toMatchObject({ source: 'FUTBALNET', futbalnetId: `sn:${'a'.repeat(24)}` });
  });

  it('udalosť s rovnakým futbalnetId, ktorá je interná/priateľská, sa neprepíše', async () => {
    const { prisma, service } = make({ id: 'e1', source: 'INTERNAL', match: { id: 'm1', isFriendly: true } });
    await service.importTeamProgram('t1');
    expect(prisma.event.update).not.toHaveBeenCalled();
    expect(prisma.match.update).not.toHaveBeenCalled();
    expect(prisma.event.create).not.toHaveBeenCalled();
  });
});

describe('večerný sync výsledkov vynecháva priateľské zápasy', () => {
  it('cron vyberá len isFriendly=false', async () => {
    const prisma = { match: { findMany: vi.fn(async () => []) } };
    await new MatchSyncService(prisma as never).syncToday();
    for (const call of prisma.match.findMany.mock.calls as unknown as Array<[{ where: { isFriendly: boolean } }]>) {
      expect(call[0].where.isFriendly).toBe(false);
    }
    expect(prisma.match.findMany).toHaveBeenCalledTimes(2);
  });

  it('ručný sync priateľského zápasu → 400, syncMatch ho nemení', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const prisma = {
      match: {
        findUnique: vi.fn(async () => ({ id: 'm1', isFriendly: true, event: { teamId: 't1' } })),
        update: vi.fn(),
      },
    };
    const svc = new MatchSyncService(prisma as never);
    await expect(svc.syncManual('m1', admin)).rejects.toMatchObject({ status: 400 });
    const r = await svc.syncMatch('m1', 'CRON');
    expect(r.status).toBe('NO_RESULT');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.match.update).not.toHaveBeenCalled();
  });
});
