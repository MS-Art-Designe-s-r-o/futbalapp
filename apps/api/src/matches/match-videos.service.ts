import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { MatchesService } from './matches.service';
import { resolveVideoMime, videosDir } from './video-storage';

/** Max. počet videí na zápas. */
const MAX_VIDEOS_PER_MATCH = 30;

const VIDEO_SELECT = {
  id: true,
  mimeType: true,
  size: true,
  filename: true,
  title: true,
  createdAt: true,
} as const;

@Injectable()
export class MatchVideosService implements OnModuleInit {
  private readonly logger = new Logger(MatchVideosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
  ) {}

  /** Pri štarte vytvorí adresár pre videá (named volume v Dockeri). */
  async onModuleInit() {
    try {
      await mkdir(videosDir(), { recursive: true });
    } catch (e) {
      this.logger.warn(`Adresár pre videá ${videosDir()} sa nepodarilo vytvoriť: ${(e as Error).message}`);
    }
  }

  /** Absolútna cesta k súboru videa (basename → žiadny path traversal). */
  filePath(storagePath: string): string {
    return join(videosDir(), basename(storagePath));
  }

  /** Zoznam videí zápasu (s demo izoláciou ako detail zápasu). */
  async list(matchId: string, user: AuthUser) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { event: { select: { isDemo: true } } },
    });
    if (!match || match.event.isDemo !== !!user.isDemo) throw new NotFoundException('Zápas neexistuje');
    return this.prisma.matchVideo.findMany({
      where: { matchId },
      select: VIDEO_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Uloží metadáta nahraného videa (súbor už je na disku z multer storage). */
  async add(
    matchId: string,
    file: { path: string; filename: string; originalname: string; mimetype: string; size: number },
    title: string | undefined,
    user: AuthUser,
  ) {
    try {
      await this.matches.assertMatchTeam(matchId, user);
      const mimeType = resolveVideoMime(file.mimetype, file.originalname) ?? 'video/mp4';
      if (!file.size) throw new BadRequestException('Súbor je prázdny');
      const count = await this.prisma.matchVideo.count({ where: { matchId } });
      if (count >= MAX_VIDEOS_PER_MATCH) {
        throw new BadRequestException(`Dosiahnutý limit ${MAX_VIDEOS_PER_MATCH} videí na zápas`);
      }
      return await this.prisma.matchVideo.create({
        data: {
          matchId,
          mimeType,
          size: file.size,
          filename: file.originalname?.slice(0, 255) || null,
          storagePath: file.filename,
          title: title?.trim().slice(0, 200) || null,
          uploadedById: user.id,
        },
        select: VIDEO_SELECT,
      });
    } catch (e) {
      // neplatný zápas / oprávnenie / limit → nahraný súbor zmazať
      await unlink(file.path).catch(() => undefined);
      throw e;
    }
  }

  /** Metadáta pre streamovanie (neuhádnuteľné ID). */
  async getForStream(videoId: string) {
    return this.prisma.matchVideo.findUnique({
      where: { id: videoId },
      select: { mimeType: true, storagePath: true, filename: true },
    });
  }

  async delete(matchId: string, videoId: string, user: AuthUser) {
    await this.matches.assertMatchTeam(matchId, user);
    const video = await this.prisma.matchVideo.findUnique({ where: { id: videoId } });
    if (!video || video.matchId !== matchId) throw new NotFoundException('Video neexistuje');
    await this.prisma.matchVideo.delete({ where: { id: videoId } });
    await unlink(this.filePath(video.storagePath)).catch(() => undefined);
    return { deleted: true };
  }

  /**
   * Upratovanie súborov bez záznamu v DB (zmazaný zápas/udalosť kaskádou, prerušený upload).
   * Súbory mladšie ako 6 h nechávame — môže ísť o práve prebiehajúci upload.
   */
  @Cron('30 4 * * *')
  async cleanupOrphans() {
    let names: string[];
    try {
      names = await readdir(videosDir());
    } catch {
      return;
    }
    if (!names.length) return;
    // súbory videí zápasov aj tréningov (spoločný adresár)
    const known = new Set([
      ...(await this.prisma.matchVideo.findMany({ select: { storagePath: true } })).map((v) => v.storagePath),
      ...(await this.prisma.eventVideo.findMany({ select: { storagePath: true } })).map((v) => v.storagePath),
    ]);
    const cutoff = Date.now() - 6 * 3600 * 1000;
    let removed = 0;
    for (const name of names) {
      if (known.has(name)) continue;
      const path = join(videosDir(), name);
      try {
        const st = await stat(path);
        if (!st.isFile() || st.mtimeMs > cutoff) continue;
        await unlink(path);
        removed++;
      } catch {
        // ignorovať
      }
    }
    if (removed) this.logger.log(`Zmazaných ${removed} osirelých video súborov`);
  }
}
