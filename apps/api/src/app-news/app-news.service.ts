import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { basename, join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../notifications/push.service';
import type { AuthUser } from '../auth/current-user.decorator';

import { resolveVideoMime, videosDir } from '../matches/video-storage';

const isAdmin = (user: AuthUser) => user.roles.some((r) => r.role === 'ADMIN');

/** Novinky v aplikáciách/portáli: zverejňuje len admin, vidia ich všetci prihlásení členovia. */
@Injectable()
export class AppNewsService {
  private readonly logger = new Logger(AppNewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  filePath(storagePath: string): string {
    return join(videosDir(), basename(storagePath));
  }

  /** Zoznam noviniek od najnovšej; člen vidí zverejnené, admin aj koncepty (+ počet zobrazení). */
  async list(user: AuthUser) {
    const admin = isAdmin(user);
    const rows = await this.prisma.appNews.findMany({
      where: admin ? {} : { publishedAt: { not: null } },
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 100,
      include: { views: { where: { userId: user.id }, select: { id: true } }, _count: { select: { views: true } } },
    });
    const totalUsers = admin ? await this.prisma.user.count({ where: { isDemo: false } }) : 0;
    return {
      totalUsers,
      items: rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        videoUrl: n.videoUrl,
        hasVideo: !!n.videoStoragePath,
        videoMimeType: n.videoMimeType,
        videoSize: n.videoSize,
        createdAt: n.createdAt,
        publishedAt: n.publishedAt,
        seen: n.views.length > 0,
        ...(admin ? { viewsCount: n._count.views } : {}),
      })),
    };
  }

  async unseenCount(user: AuthUser): Promise<{ count: number }> {
    const count = await this.prisma.appNews.count({
      where: { publishedAt: { not: null }, views: { none: { userId: user.id } } },
    });
    return { count };
  }

  /** Označí všetky zverejnené novinky ako videné (po otvorení Noviniek). */
  async markAllSeen(user: AuthUser) {
    const unseen = await this.prisma.appNews.findMany({
      where: { publishedAt: { not: null }, views: { none: { userId: user.id } } },
      select: { id: true },
    });
    if (unseen.length) {
      await this.prisma.appNewsView.createMany({
        data: unseen.map((n) => ({ newsId: n.id, userId: user.id })),
        skipDuplicates: true,
      });
    }
    return { marked: unseen.length };
  }

  async create(input: { title: string; body?: string; videoUrl?: string }, user: AuthUser) {
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('Zadajte názov novinky');
    const videoUrl = input.videoUrl?.trim();
    if (videoUrl && !/^https?:\/\//i.test(videoUrl)) throw new BadRequestException('Odkaz na video musí začínať http:// alebo https://');
    return this.prisma.appNews.create({
      data: { title: title.slice(0, 200), body: input.body?.trim().slice(0, 5000) || null, videoUrl: videoUrl || null, createdById: user.id },
      select: { id: true },
    });
  }

  /** Uloží nahraté video (súbor už je na disku z multer storage); pri chybe súbor zmaže. */
  async attachVideo(id: string, file: { path: string; filename: string; originalname: string; mimetype: string; size: number }) {
    try {
      const news = await this.prisma.appNews.findUnique({ where: { id } });
      if (!news) throw new NotFoundException('Novinka neexistuje');
      if (!file.size) throw new BadRequestException('Súbor je prázdny');
      const old = news.videoStoragePath;
      await this.prisma.appNews.update({
        where: { id },
        data: {
          videoStoragePath: file.filename,
          videoMimeType: resolveVideoMime(file.mimetype, file.originalname) ?? 'video/mp4',
          videoSize: file.size,
          videoFilename: file.originalname?.slice(0, 255) || null,
        },
      });
      if (old) await unlink(this.filePath(old)).catch(() => undefined);
      return { ok: true };
    } catch (e) {
      await unlink(file.path).catch(() => undefined);
      throw e;
    }
  }

  /** Zverejní novinku a (voliteľne) pošle push všetkým členom. */
  async publish(id: string, notify: boolean) {
    const news = await this.prisma.appNews.findUnique({ where: { id } });
    if (!news) throw new NotFoundException('Novinka neexistuje');
    if (news.publishedAt) return { published: true, notified: 0 };
    await this.prisma.appNews.update({ where: { id }, data: { publishedAt: new Date() } });
    let notified = 0;
    if (notify) {
      try {
        const users = await this.prisma.user.findMany({ where: { isDemo: false }, select: { id: true } });
        const res = await this.push.notifyUsers(users.map((u) => u.id), {
          title: 'Novinka v aplikácii FK KNV',
          body: news.title,
          data: { type: 'news', newsId: id },
        });
        notified = res.sent;
      } catch (e) {
        this.logger.warn(`Push o novinke zlyhal: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { published: true, notified };
  }

  async remove(id: string) {
    const news = await this.prisma.appNews.findUnique({ where: { id } });
    if (!news) throw new NotFoundException('Novinka neexistuje');
    await this.prisma.appNews.delete({ where: { id } });
    if (news.videoStoragePath) await unlink(this.filePath(news.videoStoragePath)).catch(() => undefined);
    return { deleted: true };
  }

  /** Metadáta pre prehrávanie (neuhádnuteľné ID, verejné ako ostatné videá — <video> neposiela Authorization). */
  getForStream(id: string) {
    return this.prisma.appNews.findFirst({
      where: { id, publishedAt: { not: null }, videoStoragePath: { not: null } },
      select: { videoMimeType: true, videoStoragePath: true },
    });
  }
}

