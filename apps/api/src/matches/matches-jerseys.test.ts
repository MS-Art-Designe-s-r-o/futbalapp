import { describe, expect, it, vi } from 'vitest';
import { MatchesService } from './matches.service';

function make() {
  const prisma = { match: { update: vi.fn(async (a: unknown) => a) } };
  const service = new MatchesService(prisma as never, {} as never, {} as never, {} as never);
  (service as any).assertMatchTeam = vi.fn(async () => undefined);
  return { service, prisma };
}
const user = { id: 'u', roles: ['ADMIN'] } as never;

describe('MatchesService.setDetails dresy', () => {
  it('jeden, oba, žiadny', async () => {
    const { service, prisma } = make();
    await service.setDetails('m', { jerseyColors: ['LIGHT'] }, user);
    expect(prisma.match.update).toHaveBeenLastCalledWith({ where: { id: 'm' }, data: { jerseyColors: ['LIGHT'], jerseyColor: 'LIGHT' } });
    await service.setDetails('m', { jerseyColors: ['LIGHT', 'DARK'] }, user);
    expect(prisma.match.update).toHaveBeenLastCalledWith({ where: { id: 'm' }, data: { jerseyColors: ['LIGHT', 'DARK'], jerseyColor: null } });
    await service.setDetails('m', { jerseyColors: [] }, user);
    expect(prisma.match.update).toHaveBeenLastCalledWith({ where: { id: 'm' }, data: { jerseyColors: [], jerseyColor: null } });
  });
  it('staré telo a nezmenené dresy', async () => {
    const { service, prisma } = make();
    await service.setDetails('m', { jerseyColor: 'DARK' }, user);
    expect(prisma.match.update).toHaveBeenLastCalledWith({ where: { id: 'm' }, data: { jerseyColors: ['DARK'], jerseyColor: 'DARK' } });
    await service.setDetails('m', { jerseyColor: null }, user);
    expect(prisma.match.update).toHaveBeenLastCalledWith({ where: { id: 'm' }, data: { jerseyColors: [], jerseyColor: null } });
    await service.setDetails('m', { notes: 'x' }, user);
    expect((prisma.match.update.mock.calls.at(-1)![0] as any).data).toEqual({ notes: 'x' });
  });
  it('duplicity / neplatná hodnota -> 400', async () => {
    const { service } = make();
    await expect(service.setDetails('m', { jerseyColors: ['DARK', 'DARK'] }, user)).rejects.toMatchObject({ status: 400 });
    await expect(service.setDetails('m', { jerseyColors: ['RED'] as never }, user)).rejects.toMatchObject({ status: 400 });
    await expect(service.setDetails('m', { jerseyColor: 'RED' as never }, user)).rejects.toMatchObject({ status: 400 });
  });
});
