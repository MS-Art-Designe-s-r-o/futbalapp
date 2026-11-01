import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  matchEventSchema,
  matchTimerActionSchema,
  type MatchEventInput,
  type MatchTimerActionInput,
} from '@fkknv/shared';
import { MatchesService } from './matches.service';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod.pipe';

@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get('stats')
  stats(@CurrentUser() user: AuthUser, @Query('category') categoryCode?: string, @Query('team') teamId?: string) {
    return this.matchesService.playerStats({ categoryCode, teamId, isDemo: user.isDemo });
  }

  /** Moje (a detí) nominácie na potvrdenie účasti (U17/U19/Muži). */
  @Get('my/nominations')
  myNominations(@CurrentUser() user: AuthUser) {
    return this.matchesService.myNominations(user.id);
  }

  /** Zápasy, na ktoré je prihlásený (alebo jeho deti) nominovaný — pre kalendár/dashboard. */
  @Get('my/nominated')
  myNominated(@CurrentUser() user: AuthUser) {
    return this.matchesService.myNominatedMatches(user.id);
  }

  /** Hráč/rodič potvrdí alebo odmietne účasť na zápase. */
  @Post('nominations/:nominationId/respond')
  respond(
    @Param('nominationId') nominationId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { status: 'CONFIRMED' | 'DECLINED' },
  ) {
    return this.matchesService.respondNomination(nominationId, user.id, body.status);
  }

  /** Doteraz zadaní súperi pre našepkávač. */
  @Get('opponents')
  opponents() {
    return this.matchesService.opponents();
  }

  /** Odohrané zápasy (archív s videom a fotkami), od najnovšieho. */
  @Get('played')
  played(@CurrentUser() user: AuthUser, @Query('mine') mine?: string, @Query('limit') limit?: string) {
    const n = Number(limit);
    return this.matchesService.playedMatches(user, {
      mine: mine === 'true',
      limit: Number.isInteger(n) && n > 0 && n <= 200 ? n : undefined,
    });
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.matchesService.get(id, user);
  }

  @Post(':id/nominations')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  nominate(@Param('id') matchId: string, @Body() body: { memberId: string }, @CurrentUser() user: AuthUser) {
    return this.matchesService.nominate(matchId, body.memberId, user);
  }

  @Delete(':id/nominations/:memberId')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  removeNomination(@Param('id') matchId: string, @Param('memberId') memberId: string, @CurrentUser() user: AuthUser) {
    return this.matchesService.removeNomination(matchId, memberId, user);
  }

  /** Rozposlať oznam o nominácii e-mailom hráčom/rodičom. */
  @Post(':id/notify-nomination')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  notifyNomination(@Param('id') matchId: string, @CurrentUser() user: AuthUser) {
    return this.matchesService.emailNomination(matchId, user);
  }

  @Post(':id/score')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  setScore(
    @Param('id') matchId: string,
    @Body() body: { scoreUs: number; scoreThem: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.matchesService.setScore(matchId, body.scoreUs, body.scoreThem, user);
  }

  /** Čas zrazu a poznámky k zápasu — tréner družstva alebo vedenie. */
  @Post(':id/details')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  setDetails(
    @Param('id') matchId: string,
    @Body()
    body: {
      meetAt?: string | null;
      notes?: string | null;
      jerseyColor?: 'DARK' | 'LIGHT' | null;
      jerseyColors?: ('DARK' | 'LIGHT')[];
      halfLengthMin?: number | null;
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.matchesService.setDetails(matchId, body, user);
  }

  @Post(':id/state')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  setState(
    @Param('id') matchId: string,
    @Body() body: { state: 'PLANNED' | 'LIVE' | 'FINISHED' | 'CANCELLED' },
    @CurrentUser() user: AuthUser,
  ) {
    return this.matchesService.setState(matchId, body.state, user);
  }

  /** Časomiera: výkop / prestávka / 2. polčas / koniec / späť / vynulovať. */
  @Post(':id/timer')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  timer(
    @Param('id') matchId: string,
    @Body(new ZodValidationPipe(matchTimerActionSchema)) body: MatchTimerActionInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.matchesService.timerAction(matchId, body.action, user);
  }

  @Post(':id/events')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  addEvent(
    @Param('id') matchId: string,
    @Body(new ZodValidationPipe(matchEventSchema)) body: MatchEventInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.matchesService.addMatchEvent(matchId, body, user);
  }

  @Delete(':id/events/:eventId')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  deleteEvent(@Param('id') matchId: string, @Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    return this.matchesService.deleteMatchEvent(matchId, eventId, user);
  }

  /** Nastaviť/odstrániť odkaz na video zo zápasu. */
  @Post(':id/video')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  setVideo(@Param('id') matchId: string, @Body() body: { url: string | null }, @CurrentUser() user: AuthUser) {
    return this.matchesService.setVideo(matchId, body.url, user);
  }

  /** Nastaviť/odstrániť odkaz na highlighty zo zápasu. */
  @Post(':id/highlights')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  setHighlights(@Param('id') matchId: string, @Body() body: { url: string | null }, @CurrentUser() user: AuthUser) {
    return this.matchesService.setHighlights(matchId, body.url, user);
  }

  /** Automaticky nájsť kandidátov na Veo video podľa dátumu a tímov. */
  @Get(':id/video/candidates')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  videoCandidates(@Param('id') matchId: string, @CurrentUser() user: AuthUser) {
    return this.matchesService.findVideoCandidates(matchId, user);
  }

  /** Nahrať fotku zo zápasu. */
  @Post(':id/photos')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  addPhoto(
    @Param('id') matchId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    if (!file?.buffer) throw new BadRequestException('Chýba súbor (pole "file")');
    return this.matchesService.addPhoto(matchId, file, user);
  }

  /** Servírovanie fotky zo zápasu (neuhádnuteľné ID). */
  @Public()
  @Get('photos/:photoId')
  async photo(@Param('photoId') photoId: string, @Res() res: Response) {
    const photo = await this.matchesService.getPhoto(photoId);
    if (!photo) throw new NotFoundException('Fotka neexistuje');
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(Buffer.from(photo.data));
  }

  @Delete(':id/photos/:photoId')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  deletePhoto(@Param('id') matchId: string, @Param('photoId') photoId: string, @CurrentUser() user: AuthUser) {
    return this.matchesService.deletePhoto(matchId, photoId, user);
  }
}
