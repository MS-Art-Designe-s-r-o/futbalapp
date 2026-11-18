import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MembersService } from './members.service';

type M = { teamId: string; team: { isGoalkeeperGroup: boolean } };

function setup(opts: { current: M[]; teams: string[]; inTeams?: boolean; isDemo?: boolean }) {
  const prisma = {
    member: {
      findUnique: vi.fn().mockResolvedValue({ id: 'p1', isDemo: opts.isDemo ?? false }),
      update: vi.fn().mockResolvedValue({}),
    },
    season: { findFirst: vi.fn().mockResolvedValue({ id: 's1' }) },
    team: { findMany: vi.fn().mockResolvedValue(opts.teams.map((id) => ({ id }))) },
    teamMembership: {
      findMany: vi.fn().mockResolvedValue(opts.current),
      count: vi.fn().mockResolvedValue(opts.inTeams === false ? 0 : 1),
      deleteMany: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const goalkeepers = { sync: vi.fn().mockRejectedValue(new Error('x')) };
  const svc = new MembersService(prisma as never, {} as never, {} as never, {} as never, goalkeepers as never);
  vi.spyOn(svc, 'get').mockResolvedValue({ id: 'p1' } as never);
  return { svc, prisma, goalkeepers };
}
const coach = (...teamIds: string[]) =>
  ({ id: 'u', isDemo: false, roles: teamIds.map((teamId) => ({ role: 'COACH', teamId })) }) as never;
const gk = { isGoalkeeperGroup: true };
const reg = { isGoalkeeperGroup: false };

describe('MembersService.coachUpdate', () => {
  it('zakáže hráča mimo družstva trénera', async () => {
    const { svc } = setup({ current: [], teams: ['a'], inTeams: false });
    await expect(svc.coachUpdate('p1', { socialCase: true }, coach('a'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('zakáže demo nezhodu', async () => {
    const { svc } = setup({ current: [], teams: ['a'], isDemo: true });
    await expect(svc.coachUpdate('p1', {}, coach('a'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('odmietne cudzie družstvo', async () => {
    const { svc, prisma } = setup({ current: [{ teamId: 'a', team: reg }], teams: ['a'] });
    await expect(svc.coachUpdate('p1', { teamIds: ['a', 'x'] }, coach('a'))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.teamMembership.deleteMany).not.toHaveBeenCalled();
  });

  it('nesmie hráča nechať bez družstva', async () => {
    const { svc } = setup({ current: [{ teamId: 'a', team: reg }, { teamId: 'g', team: gk }], teams: ['a'] });
    await expect(svc.coachUpdate('p1', { teamIds: [] }, coach('a'))).rejects.toThrow('Hráč musí zostať aspoň v jednom družstve');
  });

  it('cudzie družstvá a skupiny brankárov nechá, pridá/odoberie len vlastné; sync je best-effort', async () => {
    const { svc, prisma, goalkeepers } = setup({
      current: [{ teamId: 'a', team: reg }, { teamId: 'foreign', team: reg }, { teamId: 'g', team: gk }],
      teams: ['a', 'b'],
    });
    await svc.coachUpdate('p1', { teamIds: ['b'], position: 'ST', healthNotes: '  ' }, coach('a', 'b'));
    expect(prisma.teamMembership.deleteMany).toHaveBeenCalledWith({ where: { memberId: 'p1', seasonId: 's1', teamId: { in: ['a'] } } });
    expect(prisma.teamMembership.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.teamMembership.upsert.mock.calls[0]![0].create.teamId).toBe('b');
    expect(prisma.member.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { position: 'ST', healthNotes: null } });
    expect(goalkeepers.sync).toHaveBeenCalled();
  });
});
