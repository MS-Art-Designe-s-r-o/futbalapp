import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  registrationInfoSchema,
  registrationRequestSchema,
  type RegistrationInfoInput,
  type RegistrationRequestInput,
} from '@fkknv/shared';
import { RegistrationService } from './registration.service';
import { CaptchaService } from '../captcha/captcha.service';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod.pipe';

@Controller('registration')
export class RegistrationController {
  constructor(
    private readonly registrationService: RegistrationService,
    private readonly captcha: CaptchaService,
  ) {}

  /** Verejný registračný formulár na fkknv.sk (chránený CAPTCHA) */
  @Public()
  @Post()
  submit(
    @Body(new ZodValidationPipe(registrationRequestSchema)) body: RegistrationRequestInput,
    @Body('captcha') captcha?: { token?: string; answer?: string },
  ) {
    this.captcha.assertValid(captcha?.token, captcha?.answer);
    return this.registrationService.submit(body);
  }

  /** Verejný formulár doplnenia údajov (odkaz z e-mailu) — poradie pred ':id' trasami */
  @Public()
  @Get('info/:token')
  getInfo(@Param('token') token: string) {
    return this.registrationService.getInfoForm(token);
  }

  @Public()
  @Post('info/:token')
  submitInfo(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(registrationInfoSchema)) body: RegistrationInfoInput,
  ) {
    this.captcha.assertValid(body.captcha.token, body.captcha.answer);
    return this.registrationService.submitInfo(token, body);
  }

  @Get(':id/request-info/preview')
  @Roles('ADMIN', 'MANAGER')
  previewRequestInfo(@Param('id') id: string, @Query('message') message?: string) {
    return this.registrationService.previewInfoRequest(id, message);
  }

  @Post(':id/request-info')
  @Roles('ADMIN', 'MANAGER')
  requestInfo(@Param('id') id: string, @Body() body?: { message?: string }) {
    return this.registrationService.requestInfo(id, body?.message);
  }

  /** História: ?status=APPROVED|REJECTED|PENDING (bez = všetky) &q=hľadaný text */
  @Get('history')
  @Roles('ADMIN', 'MANAGER')
  history(@Query('status') status?: string, @Query('q') q?: string) {
    return this.registrationService.listHistory(status, q);
  }

  @Get('pending')
  @Roles('ADMIN', 'MANAGER')
  listPending() {
    return this.registrationService.listPending();
  }

  @Post(':id/approve')
  @Roles('ADMIN', 'MANAGER')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body?: { childMemberIds?: string[] },
  ) {
    return this.registrationService.approve(id, user.id, { childMemberIds: body?.childMemberIds });
  }

  /** Z údajov dieťaťa v prihláške vytvorí člena (zaradí do zvolenej skupiny a naviaže na rodiča, ak má konto). */
  @Post(':id/create-child')
  @Roles('ADMIN', 'MANAGER')
  createChild(@Param('id') id: string) {
    return this.registrationService.createChildFromRequest(id);
  }

  @Post(':id/reject')
  @Roles('ADMIN', 'MANAGER')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.registrationService.reject(id, user.id);
  }
}
