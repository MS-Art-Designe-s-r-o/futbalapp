import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { basename, join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { isDemoScope } from '../auth/scope';
import { EventsService } from './events.service';
import { resolveVideoMime, videosDir } from '../matches/video-storage';

const MAX_PHOTOS = 60;
const MAX_VIDEOS = 30;

const PHOTO_SELECT = { id: true, mimeType: true, size: true, createdAt: true } as const;
const VIDEO_SELECT = { id: true, mimeType: true, size: true, filename: true, title: true, createdAt: true } as const;

/** Fotky a videá z tréningov — dostupné vedeniu, trénerovi družstva a trénerovi brankárov (skupiny Brankári). */
@Injectable()
export class EventMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** Overí, že ide o tréning a že ho používateľ smie spravovať. */
  private async assertTraining(eventId: string, user: AuthUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, type: true, teamId: true, isDemo: true },
    });
    if (!event || event.isDemo !== isDemoScope(user)) throw new NotFoundException('Udalosť neexistuje');
    if (event.type !== 'TRAINING') throw new BadRequestException('Fotky a videá možno pridávať len k tréningom');
    if (!(await this.events.canManage(user, event.teamId))) {
      throw new ForbiddenException('Fotky a videá môže spravovať len tréner družstva a vedenie');
    }
    return event;
  }

  async list(eventId: string, user: AuthUser) {
    await this.assertTraining(eventId, user);
    const [photos, videos] = await Promise.all([
      this.prisma.eventPhoto.findMany({ where: { eventId }, select: PHOTO_SELECT, orderBy: { createdAt: 'asc' } }),
      this.prisma.eventVideo.findMany({ where: { eventId }, select: VIDEO_SELECT, orderBy: { createdAt: 'asc' } }),
    ]);
    return { photos, videos };
  }

  async addPhoto(eventId: string, file: { buffer: Buffer; mimetype: string; size: number }, user: AuthUser) {
    await this.assertTraining(eventId, user);
    if (!file?.buffer) throw new BadRequestException('Chýba súbor');
    if (!file.mimetype?.startsWith('image/')) throw new BadRequestException('Nahrať možno len obrázok');
    if ((await this.prisma.eventPhoto.count({ where: { eventId } })) >= MAX_PHOTOS) {
      throw new BadRequestException(`Dosiahnutý limit ${MAX_PHOTOS} fotiek na tréning`);
    }
    return this.prisma.eventPhoto.create({
      data: { eventId, mimeType: file.mimetype, size: file.size, data: file.buffer, uploadedById: user.id },
      select: PHOTO_SELECT,
    });
  }

  getPhoto(photoId: string) {
    return this.prisma.eventPhoto.findUnique({ where: { id: photoId }, select: { mimeType: true, data: true } });
  }

  async deletePhoto(eventId: string, photoId: string, user: AuthUser) {
    await this.assertTraining(eventId, user);
    const photo = await this.prisma.eventPhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.eventId !== eventId) throw new NotFoundException('Fotka neexistuje');
    await this.prisma.eventPhoto.delete({ where: { id: photoId } });
    return { deleted: true };
  }

  /** Uloží metadáta videa (súbor už je na disku z multer storage); pri chybe súbor zmaže. */
  async addVideo(
    eventId: string,
    file: { path: string; filename: string; originalname: string; mimetype: string; size: number },
    title: string | undefined,
    user: AuthUser,
  ) {
    try {
      await this.assertTraining(eventId, user);
      if (!file.size) throw new BadRequestException('Súbor je prázdny');
      if ((await this.prisma.eventVideo.count({ where: { eventId } })) >= MAX_VIDEOS) {
        throw new BadRequestException(`Dosiahnutý limit ${MAX_VIDEOS} videí na tréning`);
      }
      return await this.prisma.eventVideo.create({
        data: {
          eventId,
          mimeType: resolveVideoMime(file.mimetype, file.originalname) ?? 'video/mp4',
          size: file.size,
          filename: file.originalname?.slice(0, 255) || null,
          storagePath: file.filename,
          title: title?.trim().slice(0, 200) || null,
          uploadedById: user.id,
        },
        select: VIDEO_SELECT,
      });
    } catch (e) {
      await unlink(file.path).catch(() => undefined);
      throw e;
    }
  }

  getVideoForStream(videoId: string) {
    return this.prisma.eventVideo.findUnique({ where: { id: videoId }, select: { mimeType: true, storagePath: true } });
  }

  filePath(storagePath: string): string {
    return join(videosDir(), basename(storagePath));
  }

  async deleteVideo(eventId: string, videoId: string, user: AuthUser) {
    await this.assertTraining(eventId, user);
    const video = await this.prisma.eventVideo.findUnique({ where: { id: videoId } });
    if (!video || video.eventId !== eventId) throw new NotFoundException('Video neexistuje');
    await this.prisma.eventVideo.delete({ where: { id: videoId } });
    await unlink(this.filePath(video.storagePath)).catch(() => undefined);
    return { deleted: true };
  }
}
