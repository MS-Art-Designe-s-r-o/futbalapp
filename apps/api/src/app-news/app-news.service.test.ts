import { describe, expect, it, vi } from 'vitest';
import { AppNewsService } from './app-news.service';

function make() {
  const prisma = {
    appNews: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'n1', ...data })),
      findMany: vi.fn(async () => [{ id: 'n1' }, { id: 'n2' }]),
      findUnique: vi.fn(async () => ({ id: 'n1', title: 'Novinka', publishedAt: null })),
      update: vi.fn(async () => ({})),
    },
    appNewsView: { createMany: vi.fn(async () => ({ count: 2 })) },
    user: { findMany: vi.fn(async () => [{ id: 'u1' }, { id: 'u2' }]) },
  };
  const push = { notifyUsers: vi.fn(async () => ({ sent: 2 })) };
  return { prisma, push, svc: new AppNewsService(prisma as never, push as never) };
}
const admin = { id: 'a1', email: 'a@x', roles: [{ role: 'ADMIN' as const, teamId: null }], isDemo: false };

describe('AppNewsService', () => {
  it('odmietne prázdny názov a odkaz bez http(s)', async () => {
    const { svc } = make();
    await expect(svc.create({ title: '  ' }, admin)).rejects.toThrow('názov');
    await expect(svc.create({ title: 'X', videoUrl: 'javascript:alert(1)' }, admin)).rejects.toThrow('http');
  });
  it('vytvorí novinku ako koncept', async () => {
    const { svc, prisma } = make();
    await svc.create({ title: ' Nová funkcia ', body: 'Popis', videoUrl: 'https://youtu.be/x' }, admin);
    expect(prisma.appNews.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Nová funkcia', videoUrl: 'https://youtu.be/x', createdById: 'a1' }) }),
    );
  });
  it('označí všetky nevidené novinky ako videné', async () => {
    const { svc, prisma } = make();
    await svc.markAllSeen(admin);
    expect(prisma.appNewsView.createMany).toHaveBeenCalledWith({
      data: [{ newsId: 'n1', userId: 'a1' }, { newsId: 'n2', userId: 'a1' }],
      skipDuplicates: true,
    });
  });
  it('zverejnenie pošle push všetkým používateľom, bez notify nie', async () => {
    const a = make();
    expect(await a.svc.publish('n1', true)).toEqual({ published: true, notified: 2 });
    expect(a.push.notifyUsers).toHaveBeenCalledWith(['u1', 'u2'], expect.objectContaining({ body: 'Novinka' }));
    const b = make();
    await b.svc.publish('n1', false);
    expect(b.push.notifyUsers).not.toHaveBeenCalled();
  });
});
