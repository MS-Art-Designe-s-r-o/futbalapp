import { describe, expect, it, vi } from 'vitest';
import { EventsService } from './events.service';

const pitch = { id: 'p1', name: 'Hlavné', surface: 'PT', address: 'Plocha 1' };
const admin = { id: 'u1', roles: [{ role: 'ADMIN' }] } as never;

function make() {
  const prisma = {
    season: { findFirst: vi.fn(async () => ({ id: 's1' })) },
    team: { findUnique: vi.fn(async () => null) },
    pitch: { findUnique: vi.fn(async () => pitch) },
    teamMembership: { findMany: vi.fn(async () => []) },
    event: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => ({ id: 'e1', teamId: null, type: 'OTHER', pitchId: null, startAt: new Date('2030-01-01T10:00:00Z'), endAt: new Date('2030-01-01T11:00:00Z') })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'e1', ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'e1', startAt: new Date('2030-01-01T10:00:00Z'), endAt: new Date('2030-01-01T11:00:00Z'), ...data })),
    },
  };
  return { prisma, service: new EventsService(prisma as never, {} as never, {} as never) };
}

const base = {
  type: 'OTHER' as const,
  title: 'T',
  startAt: new Date('2030-01-01T10:00:00Z'),
  endAt: new Date('2030-01-01T11:00:00Z'),
  pitchId: 'p1',
};

describe('adresa udalosti s plochou', () => {
  it('create preberie adresu plochy', async () => {
    const { service, prisma } = make();
    await service.create(base as never, 'u1');
    expect(prisma.event.create.mock.calls[0]![0].data.address).toBe('Plocha 1');
  });

  it('create: vlastná adresa má prednosť', async () => {
    const { service, prisma } = make();
    await service.create({ ...base, address: 'Vlastná 5' } as never, 'u1');
    expect(prisma.event.create.mock.calls[0]![0].data.address).toBe('Vlastná 5');
  });

  it('update pri nastavení plochy preberie adresu plochy, vlastná má prednosť', async () => {
    const a = make();
    await a.service.update('e1', { pitchId: 'p1' } as never, admin);
    expect(a.prisma.event.update.mock.calls[0]![0].data.address).toBe('Plocha 1');
    const b = make();
    await b.service.update('e1', { pitchId: 'p1', address: 'Vlastná 5' } as never, admin);
    expect(b.prisma.event.update.mock.calls[0]![0].data.address).toBe('Vlastná 5');
  });

  it('bez plochy ostáva input.address', async () => {
    const { service, prisma } = make();
    await service.create({ ...base, pitchId: undefined, address: 'X 1' } as never, 'u1');
    expect(prisma.event.create.mock.calls[0]![0].data.address).toBe('X 1');
  });
});

describe('zdieľanie plochy medzi tréningami', () => {
  const clash = (type: string) => ({
    id: 'x1', type, teamId: 't9', team: { name: 'U11' }, title: 'Tréning U11',
    startAt: new Date('2030-01-01T10:30:00Z'), endAt: new Date('2030-01-01T11:30:00Z'),
  });
  const training = { ...base, type: 'TRAINING' as const };

  it('tréning na obsadenej ploche vráti 409 s družstvami', async () => {
    const { service, prisma } = make();
    prisma.event.findMany.mockResolvedValue([clash('TRAINING')] as never);
    await expect(service.create(training as never, 'u1')).rejects.toMatchObject({ status: 409 });
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('s allowSharedPitch sa tréning vytvorí', async () => {
    const { service, prisma } = make();
    prisma.event.findMany.mockResolvedValue([clash('TRAINING')] as never);
    (prisma as never as { userRole: unknown }).userRole = { findMany: vi.fn(async () => []) };
    (prisma as never as { team: unknown }).team = { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) };
    await service.create({ ...training, allowSharedPitch: true } as never, 'u1');
    expect(prisma.event.create).toHaveBeenCalled();
  });

  it('zápas na obsadenej ploche sa vždy odmietne (400)', async () => {
    const { service, prisma } = make();
    prisma.event.findMany.mockResolvedValue([clash('TRAINING')] as never);
    await expect(service.create({ ...base, type: 'MATCH', allowSharedPitch: true } as never, 'u1')).rejects.toMatchObject({ status: 400 });
  });

  it('tréning cez zápas vyžaduje potvrdenie (409), s allowSharedPitch prejde', async () => {
    const { service, prisma } = make();
    prisma.event.findMany.mockResolvedValue([clash('MATCH')] as never);
    await expect(service.create(training as never, 'u1')).rejects.toMatchObject({ status: 409 });
    (prisma as never as { userRole: unknown }).userRole = { findMany: vi.fn(async () => []) };
    (prisma as never as { team: unknown }).team = { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) };
    await service.create({ ...training, allowSharedPitch: true } as never, 'u1');
    expect(prisma.event.create).toHaveBeenCalled();
  });
});

describe('zmena typu tréningu (futbalový ↔ brankársky)', () => {
  function makeSwitch() {
    const { prisma, service } = make();
    const teams: Record<string, unknown> = {
      t1: { id: 't1', name: 'U10', teamCategoryId: 'c1', isGoalkeeperGroup: false },
      g1: { id: 'g1', name: 'U10 Brankári', teamCategoryId: 'c1', isGoalkeeperGroup: true },
      x1: { id: 'x1', name: 'U15', teamCategoryId: 'c2', isGoalkeeperGroup: false },
    };
    prisma.team.findUnique = vi.fn(async ({ where }: { where: { id: string } }) => (teams[where.id] ?? null) as never);
    prisma.event.findUnique = vi.fn(async () => ({
      id: 'e1', teamId: 't1', seasonId: 's1', type: 'TRAINING', pitchId: null,
      startAt: new Date('2030-01-01T10:00:00Z'), endAt: new Date('2030-01-01T11:00:00Z'),
    })) as never;
    (prisma as never as Record<string, unknown>).attendance = { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})), findMany: vi.fn(async () => []) };
    return { prisma: prisma as never as typeof prisma & { attendance: { deleteMany: ReturnType<typeof vi.fn> } }, service };
  }

  it('vedenie prepne tréning na skupinu Brankári a dochádzka sa pripraví nanovo', async () => {
    const { prisma, service } = makeSwitch();
    await service.update('e1', { teamId: 'g1' } as never, admin);
    expect(prisma.event.update.mock.calls[0]![0].data.teamId).toBe('g1');
    expect(prisma.attendance.deleteMany).toHaveBeenCalled();
  });

  it('tréner svojho družstva smie prepnúť na brankársku skupinu rovnakej kategórie', async () => {
    const { service } = makeSwitch();
    const coach = { id: 'u2', roles: [{ role: 'COACH', teamId: 't1' }] } as never;
    await expect(service.update('e1', { teamId: 'g1' } as never, coach)).resolves.toBeDefined();
  });

  it('tréner nesmie presunúť tréning do cudzej kategórie', async () => {
    const { service } = makeSwitch();
    const coach = { id: 'u2', roles: [{ role: 'COACH', teamId: 't1' }] } as never;
    await expect(service.update('e1', { teamId: 'x1' } as never, coach)).rejects.toMatchObject({ status: 403 });
  });
});

describe('brankársky tréning: výnimka pri rezervácii plochy', () => {
  const clash = (type: string) => ({
    id: 'x1', type, teamId: 't9', team: { name: 'U11' }, title: 'Iná udalosť',
    startAt: new Date('2030-01-01T10:30:00Z'), endAt: new Date('2030-01-01T11:30:00Z'),
  });
  const gk = { ...base, type: 'TRAINING' as const, teamId: 'g1' };
  function makeGk() {
    const m = make();
    m.prisma.team.findUnique = vi.fn(async () => ({ id: 'g1', name: 'U10 Brankári', isGoalkeeperGroup: true }) as never);
    (m.prisma as never as Record<string, unknown>).userRole = { findMany: vi.fn(async () => []) };
    (m.prisma as never as Record<string, unknown>).team = { findUnique: m.prisma.team.findUnique, findMany: vi.fn(async () => []) };
    return m;
  }

  it('pri inom tréningu sa vytvorí bez potvrdenia', async () => {
    const { service, prisma } = makeGk();
    prisma.event.findMany.mockResolvedValue([clash('TRAINING')] as never);
    await service.create(gk as never, 'u1');
    expect(prisma.event.create).toHaveBeenCalled();
  });

  it('pri zápase alebo turnaji na ploche sa odmietne (400)', async () => {
    for (const type of ['MATCH', 'TOURNAMENT']) {
      const { service, prisma } = makeGk();
      prisma.event.findMany.mockResolvedValue([clash(type)] as never);
      await expect(service.create({ ...gk, allowSharedPitch: true } as never, 'u1')).rejects.toMatchObject({ status: 400 });
      expect(prisma.event.create).not.toHaveBeenCalled();
    }
  });
});

describe('skupiny brankárov: tréner len tréningy', () => {
  const coach = { id: 'u2', roles: [{ role: 'COACH', teamId: 'g1' }] } as never;
  it('zápas na skupinu brankárov sa pre trénera odmietne, tréning prejde, vedenie smie všetko', async () => {
    const { service, prisma } = make();
    (prisma as never as Record<string, unknown>).team = { count: vi.fn(async () => 1), findUnique: prisma.team.findUnique };
    await expect(service.assertGkTeamsOnlyTraining(coach, 'MATCH', ['g1'])).rejects.toMatchObject({ status: 403 });
    await expect(service.assertGkTeamsOnlyTraining(coach, 'TRAINING', ['g1'])).resolves.toBeUndefined();
    await expect(service.assertGkTeamsOnlyTraining(admin, 'MATCH', ['g1'])).resolves.toBeUndefined();
  });
});
