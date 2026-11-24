import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { maxVideoBytes, videoDiskStorage, videoFileFilter } from '../matches/video-storage';
import { EventMediaService } from './event-media.service';

const MEDIA_ROLES = ['ADMIN', 'MANAGER', 'COACH', 'GK_COACH'] as const;

/** Fotky a videá z tréningov: /events/:id/media, /events/:id/photos, /events/:id/videos. */
@Controller('events')
export class EventMediaController {
  constructor(private readonly media: EventMediaService) {}

  @Get(':id/media')
  @Roles(...MEDIA_ROLES)
  list(@Param('id') eventId: string, @CurrentUser() user: AuthUser) {
    return this.media.list(eventId, user);
  }

  @Post(':id/photos')
  @Roles(...MEDIA_ROLES)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  addPhoto(
    @Param('id') eventId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string; size: number },
  ) {
    if (!file?.buffer) throw new BadRequestException('Chýba súbor (pole "file")');
    return this.media.addPhoto(eventId, file, user);
  }

  /** Servírovanie fotky (neuhádnuteľné ID, ako pri zápasoch). */
  @Public()
  @Get('photos/:photoId')
  async photo(@Param('photoId') photoId: string, @Res() res: Response) {
    const photo = await this.media.getPhoto(photoId);
    if (!photo) throw new NotFoundException('Fotka neexistuje');
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(Buffer.from(photo.data));
  }

  @Delete(':id/photos/:photoId')
  @Roles(...MEDIA_ROLES)
  deletePhoto(@Param('id') eventId: string, @Param('photoId') photoId: string, @CurrentUser() user: AuthUser) {
    return this.media.deletePhoto(eventId, photoId, user);
  }

  @Post(':id/videos')
  @Roles(...MEDIA_ROLES)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: videoDiskStorage,
      fileFilter: videoFileFilter,
      limits: { fileSize: maxVideoBytes(), files: 1 },
    }),
  )
  addVideo(
    @Param('id') eventId: string,
    @CurrentUser() user: AuthUser,
    @Body('title') title?: string,
    @UploadedFile() file?: { path: string; filename: string; originalname: string; mimetype: string; size: number },
  ) {
    if (!file?.path) throw new BadRequestException('Chýba súbor (pole "file")');
    return this.media.addVideo(eventId, file, typeof title === 'string' ? title : undefined, user);
  }

  /** Prehrávanie videa (Range/206 cez sendFile → seekovanie). */
  @Public()
  @Get('videos/:videoId')
  async stream(@Param('videoId') videoId: string, @Res() res: Response) {
    const video = await this.media.getVideoForStream(videoId);
    if (!video) throw new NotFoundException('Video neexistuje');
    res.setHeader('Content-Type', video.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(
      this.media.filePath(video.storagePath),
      { acceptRanges: true, cacheControl: false, lastModified: true, dotfiles: 'deny' },
      (err?: Error & { code?: string; status?: number }) => {
        if (!err || res.headersSent) return;
        const notFound = err.code === 'ENOENT' || err.status === 404;
        res.status(notFound ? 404 : (err.status ?? 500)).json({ message: notFound ? 'Súbor videa chýba' : 'Video sa nepodarilo načítať' });
      },
    );
  }

  @Delete(':id/videos/:videoId')
  @Roles(...MEDIA_ROLES)
  deleteVideo(@Param('id') eventId: string, @Param('videoId') videoId: string, @CurrentUser() user: AuthUser) {
    return this.media.deleteVideo(eventId, videoId, user);
  }
}
