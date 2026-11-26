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
import { AppNewsService } from './app-news.service';

/** Novinky pre členov (video o novinkách v portáli/aplikáciách): čítanie všetci prihlásení, správa len ADMIN. */
@Controller('app-news')
export class AppNewsController {
  constructor(private readonly news: AppNewsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.news.list(user);
  }

  @Get('unseen-count')
  unseen(@CurrentUser() user: AuthUser) {
    return this.news.unseenCount(user);
  }

  @Post('seen')
  seen(@CurrentUser() user: AuthUser) {
    return this.news.markAllSeen(user);
  }

  /** Prehrávanie nahraného videa (Range/206 cez sendFile). */
  @Public()
  @Get('videos/:id')
  async stream(@Param('id') id: string, @Res() res: Response) {
    const video = await this.news.getForStream(id);
    if (!video?.videoStoragePath) throw new NotFoundException('Video neexistuje');
    res.setHeader('Content-Type', video.videoMimeType ?? 'video/mp4');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(
      this.news.filePath(video.videoStoragePath),
      { acceptRanges: true, cacheControl: false, lastModified: true, dotfiles: 'deny' },
      (err?: Error & { code?: string; status?: number }) => {
        if (!err || res.headersSent) return;
        const notFound = err.code === 'ENOENT' || err.status === 404;
        res.status(notFound ? 404 : (err.status ?? 500)).json({ message: notFound ? 'Súbor videa chýba' : 'Video sa nepodarilo načítať' });
      },
    );
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() body: { title: string; body?: string; videoUrl?: string }, @CurrentUser() user: AuthUser) {
    return this.news.create(body, user);
  }

  @Post(':id/video')
  @Roles('ADMIN')
  @UseInterceptors(
    FileInterceptor('file', { storage: videoDiskStorage, fileFilter: videoFileFilter, limits: { fileSize: maxVideoBytes(), files: 1 } }),
  )
  video(
    @Param('id') id: string,
    @UploadedFile() file?: { path: string; filename: string; originalname: string; mimetype: string; size: number },
  ) {
    if (!file?.path) throw new BadRequestException('Chýba súbor (pole "file")');
    return this.news.attachVideo(id, file);
  }

  @Post(':id/publish')
  @Roles('ADMIN')
  publish(@Param('id') id: string, @Body() body: { notify?: boolean }) {
    return this.news.publish(id, body?.notify !== false);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.news.remove(id);
  }
}
