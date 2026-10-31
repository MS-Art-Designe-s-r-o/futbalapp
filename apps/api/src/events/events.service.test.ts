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

  it('tréning cez zápas sa neponúka (400)', async () => {
    const { service, prisma } = make();
    prisma.event.findMany.mockResolvedValue([clash('MATCH')] as never);
    await expect(service.create({ ...training, allowSharedPitch: true } as never, 'u1')).rejects.toMatchObject({ status: 400 });
  });
});
