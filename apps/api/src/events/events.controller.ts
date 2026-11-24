import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createEventSchema,
  createRecurringTrainingSchema,
  markAttendanceSchema,
  type CreateEventInput,
  type CreateRecurringTrainingInput,
  type MarkAttendanceInput,
} from '@fkknv/shared';
import { EventsService } from './events.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { isCoach, isGkCoach, isStaff } from '../auth/scope';
import { ZodValidationPipe } from '../common/zod.pipe';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  private async canManageAll(user: AuthUser, teamIds: string[]): Promise<boolean> {
    for (const id of teamIds) if (!(await this.eventsService.canManage(user, id))) return false;
    return true;
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('category') categoryCode?: string,
    @Query('team') teamId?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('mine') mine?: string,
  ) {
    const range = { from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined };
    // hráč/rodič (alebo mine=true): len družstvá, kde je on/jeho deti + celoklubové.
    // tréner: len jeho pridelené družstvá (+ celoklubové). vedenie: celý kalendár.
    if (mine === 'true' || (!isStaff(user) && !isCoach(user) && !isGkCoach(user))) {
      return this.eventsService.listForUser({ ...range, type }, user);
    }
    if (!isStaff(user) && (isCoach(user) || isGkCoach(user))) {
      return this.eventsService.listForCoach({ teamId, type, ...range }, user);
    }
    return this.eventsService.list({ categoryCode, teamId, type, ...range, isDemo: user.isDemo });
  }

  @Get('locations')
  @Roles('ADMIN', 'MANAGER', 'COACH', 'GK_COACH')
  locations() {
    return this.eventsService.locations();
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'COACH', 'GK_COACH')
  async create(@Body(new ZodValidationPipe(createEventSchema)) body: CreateEventInput, @CurrentUser() user: AuthUser) {
    await this.eventsService.assertGkTeamsOnlyTraining(user, body.type, [body.teamId, ...(body.teamIds ?? []), ...(body.audienceTeamIds ?? [])]);
    if (body.teamId && !(await this.eventsService.canManage(user, body.teamId))) {
      throw new ForbiddenException('Nemôžete vytvárať udalosti pre iné družstvo');
    }
    if (body.teamIds && !(await this.canManageAll(user, body.teamIds))) {
      throw new ForbiddenException('Nemôžete vytvárať udalosti pre iné družstvo');
    }
    // cieľové družstvá (rodičovské združenie): tréner len svoje; celoklubové len vedenie
    const audience = body.audienceTeamIds ?? [];
    if (audience.length) {
      if (!(await this.canManageAll(user, audience))) {
        throw new ForbiddenException('Nemôžete vytvárať udalosti pre iné družstvo');
      }
    } else if (body.type === 'PARENT_MEETING' && !body.teamId && !isStaff(user)) {
      throw new ForbiddenException('Celoklubovú udalosť môže vytvoriť len vedenie klubu');
    }
    return this.eventsService.create(body, user.id, user.isDemo);
  }

  @Post('recurring')
  @Roles('ADMIN', 'MANAGER', 'COACH', 'GK_COACH')
  async createRecurring(
    @Body(new ZodValidationPipe(createRecurringTrainingSchema)) body: CreateRecurringTrainingInput,
    @CurrentUser() user: AuthUser,
  ) {
    if (!(await this.eventsService.canManage(user, body.teamId)) || (body.teamIds && !(await this.canManageAll(user, body.teamIds)))) {
      throw new ForbiddenException('Nemôžete vytvárať tréningy pre iné družstvo');
    }
    return this.eventsService.createRecurring(body, user.id, user.isDemo);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'COACH', 'GK_COACH')
  update(
    @Param('id') eventId: string,
    @Body(new ZodValidationPipe(createEventSchema.partial())) body: Partial<CreateEventInput>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.eventsService.update(eventId, body, user);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER', 'COACH', 'GK_COACH')
  remove(@Param('id') eventId: string, @CurrentUser() user: AuthUser, @Query('scope') scope?: string) {
    return this.eventsService.remove(eventId, scope === 'future' ? 'future' : 'one', user);
  }

  @Get('attendance-stats')
  @Roles('ADMIN', 'MANAGER', 'COACH', 'GK_COACH')
  stats(@Query('team') teamId: string) {
    return this.eventsService.teamAttendanceStats(teamId);
  }

  /** Dochádzkový list družstva za mesiac (YYYY-MM) — vedenie a tréner daného družstva. */
  @Get('attendance-sheet')
  @Roles('ADMIN', 'MANAGER', 'COACH', 'GK_COACH')
  async attendanceSheet(@Query('team') teamId: string, @Query('month') month: string, @CurrentUser() user: AuthUser) {
    if (!teamId) throw new ForbiddenException('Vyberte družstvo');
    if (!(await this.eventsService.canManage(user, teamId))) throw new ForbiddenException('Toto družstvo nemôžete zobraziť');
    return this.eventsService.attendanceSheet(teamId, month);
  }

  @Get(':id/attendance')
  attendance(@Param('id') eventId: string, @CurrentUser() user: AuthUser) {
    return this.eventsService.attendance(eventId, user);
  }

  @Post(':id/attendance')
  @Roles('ADMIN', 'MANAGER', 'COACH', 'GK_COACH')
  markAttendance(
    @Param('id') eventId: string,
    @Body(new ZodValidationPipe(markAttendanceSchema)) body: MarkAttendanceInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.eventsService.markAttendance(eventId, body, user);
  }
}
