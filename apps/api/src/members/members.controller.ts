import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  coachUpdateMemberSchema,
  createMemberSchema,
  publicConsentSchema,
  type CoachUpdateMemberInput,
  type CreateMemberInput, type PublicConsentInput,
} from '@fkknv/shared';
import { stripRegistrationForCoach } from './registration-visibility';
import { MembersService } from './members.service';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { coachTeamIds, isStaff } from '../auth/scope';
import { ZodValidationPipe } from '../common/zod.pipe';

@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'COACH')
  async list(
    @CurrentUser() user: AuthUser,
    @Query('category') categoryCode?: string,
    @Query('team') teamId?: string,
    @Query('season') seasonId?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
    @Query('hideInactive') hideInactive?: string,
  ) {
    // tréner vidí len hráčov svojich družstiev
    const teamIds = isStaff(user) ? undefined : coachTeamIds(user);
    const rows = await this.membersService.list({
      categoryCode,
      teamId,
      teamIds,
      seasonId,
      status,
      role,
      hideInactive: hideInactive === 'true',
      isDemo: user.isDemo,
    });
    return stripRegistrationForCoach(user, rows);
  }

  /** Platnosť registračných preukazov (scope podľa roly) — pre dashboard. */
  @Get('registration-cards')
  @Roles('ADMIN', 'MANAGER', 'COACH', 'PLAYER', 'PARENT')
  registrationCards(@CurrentUser() user: AuthUser) {
    return this.membersService.registrationCards(user);
  }

  /** Zoznam rodičov na priradenie k dieťaťu. */
  @Get('parents')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  parents(@CurrentUser() user: AuthUser) {
    return this.membersService.listParents(user.isDemo);
  }

  /** Import hráčov z Excelu (idempotentný upsert podľa reg. čísla / mena+dátumu). */
  @Post('import')
  @Roles('ADMIN', 'MANAGER')
  @UseInterceptors(FileInterceptor('file'))
  importRoster(@UploadedFile() file?: { buffer: Buffer }) {
    if (!file?.buffer) throw new BadRequestException('Chýba súbor (pole "file")');
    return this.membersService.importRoster(file.buffer);
  }

  /** Náhľad synchronizácie z ISSF: stiahne zoznam hráčov a vráti rozdiely (nič nemení). */
  @Post('issf-sync/preview')
  @Roles('ADMIN', 'MANAGER')
  issfSyncPreview() {
    return this.membersService.issfSyncPreview();
  }

  /** Potvrdenie synchronizácie z ISSF: vytvorí nových + prepíše potvrdených členov. */
  @Post('issf-sync/apply')
  @Roles('ADMIN', 'MANAGER')
  issfSyncApply(@Body() body: { overwriteMemberIds?: string[]; createNew?: boolean }) {
    return this.membersService.issfSyncApply(body ?? {});
  }

  /** Fotka hráča (obrázok) — verejné podľa neuhádnuteľného ID. */
  @Public()
  @Get(':id/photo')
  async photo(@Param('id') id: string, @Res() res: Response) {
    const dataUrl = await this.membersService.getPhoto(id);
    const match = dataUrl ? /^data:(.+?);base64,(.*)$/.exec(dataUrl) : null;
    if (!match) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', match[1]!);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(Buffer.from(match[2]!, 'base64'));
  }

  /** Nahranie/výmena fotky hráča — len vedenie (tréner hráča needituje). */
  @Post(':id/photo')
  @Roles('ADMIN', 'MANAGER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 4 * 1024 * 1024 } }))
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string },
  ) {
    if (!file?.buffer) throw new BadRequestException('Chýba súbor (pole "file")');
    if (!file.mimetype?.startsWith('image/')) throw new BadRequestException('Nahrajte obrázok');
    const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    return this.membersService.setPhoto(id, dataUrl);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    if (!isStaff(user) && !(await this.membersService.memberInTeams(id, coachTeamIds(user)))) {
      throw new ForbiddenException('Hráč nie je vo vašom družstve');
    }
    const member = await this.membersService.get(id);
    // demo izolácia: demo konto vidí len demo členov a naopak
    if (member.isDemo !== user.isDemo) throw new ForbiddenException('Člen neexistuje');
    return stripRegistrationForCoach(user, member);
  }

  /**
   * Úprava hráča trénerom: postavenie, sociálny prípad, zdravotné poznámky a hráčske
   * skupiny (len z jeho družstiev). Vedenie môže nastaviť ľubovoľné nebrankárske družstvá.
   */
  @Patch(':id/coach-update')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  async coachUpdate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(coachUpdateMemberSchema)) body: CoachUpdateMemberInput,
  ) {
    const updated = await this.membersService.coachUpdate(id, body, user);
    return stripRegistrationForCoach(user, updated);
  }

  /** Dochádzka hráča (karta hráča) — vedenie, tréner družstva hráča. */
  @Get(':id/attendance')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  async attendance(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    if (!isStaff(user) && !(await this.membersService.memberInTeams(id, coachTeamIds(user)))) {
      throw new ForbiddenException('Hráč nie je vo vašom družstve');
    }
    const member = await this.membersService.get(id);
    if (member.isDemo !== user.isDemo) throw new ForbiddenException('Člen neexistuje');
    return this.membersService.attendanceOf(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER')
  create(
    @Body(new ZodValidationPipe(createMemberSchema)) body: CreateMemberInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.membersService.create(body, user.roles.map((r) => r.role), user.isDemo);
  }

  /** Úprava člena — len vedenie. Tréner hráča needituje (okrem presunu cez /transfers). */
  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createMemberSchema.partial())) body: Partial<CreateMemberInput>,
  ) {
    return this.membersService.update(id, body, user.roles.map((r) => r.role));
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  remove(@Param('id') id: string) {
    return this.membersService.remove(id);
  }

  /** Súhlas so zverejnením na verejnom webe (meno / fotografia) — len vedenie. */
  @Patch(':id/public-consent')
  @Roles('ADMIN', 'MANAGER')
  setPublicConsent(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(publicConsentSchema)) body: PublicConsentInput,
  ) {
    return this.membersService.setPublicConsent(id, body, user.id);
  }

  /** Admin: vygeneruje nové jednorazové heslo pre konto člena. */
  @Post(':id/reset-password')
  @Roles('ADMIN')
  resetPassword(@Param('id') id: string) {
    return this.membersService.resetAccountPassword(id);
  }

  /** Priradí rodiča k dieťaťu — vedenie, alebo tréner družstva, v ktorom je dieťa. */
  @Post(':id/guardians')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  async addGuardian(
    @Param('id') childId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { parentMemberId: string; relation?: string },
  ) {
    if (!isStaff(user) && !(await this.membersService.memberInTeams(childId, coachTeamIds(user)))) {
      throw new ForbiddenException('Dieťa nie je vo vašom družstve');
    }
    if (!body?.parentMemberId) throw new BadRequestException('Chýba rodič');
    return this.membersService.addGuardian(childId, body.parentMemberId, body.relation ?? 'GUARDIAN');
  }

  /** Zruší väzbu rodič ↔ dieťa. */
  @Delete(':id/guardians/:userId')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  async removeGuardian(
    @Param('id') childId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (!isStaff(user) && !(await this.membersService.memberInTeams(childId, coachTeamIds(user)))) {
      throw new ForbiddenException('Dieťa nie je vo vašom družstve');
    }
    return this.membersService.removeGuardian(childId, userId);
  }
}
