import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { createTeamSchema, type CreateTeamInput } from '@fkknv/shared';
import { SeasonsService } from './seasons.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod.pipe';

@Controller('seasons')
export class SeasonsController {
  constructor(private readonly seasonsService: SeasonsService) {}

  @Get()
  list() {
    return this.seasonsService.list();
  }

  @Get('active')
  active() {
    return this.seasonsService.active();
  }

  @Get('categories')
  categories(@CurrentUser() user: AuthUser) {
    return this.seasonsService.categories(user.isDemo);
  }

  @Get('teams')
  teams(@CurrentUser() user: AuthUser, @Query('withGk') withGk?: string) {
    return this.seasonsService.teams(user.isDemo, withGk === '1');
  }

  @Post('teams')
  @Roles('ADMIN', 'MANAGER')
  createTeam(@Body(new ZodValidationPipe(createTeamSchema)) body: CreateTeamInput) {
    return this.seasonsService.createTeam(body.teamCategoryCode, body.name);
  }

  @Patch('teams/:id')
  @Roles('ADMIN', 'MANAGER')
  renameTeam(@Param('id') id: string, @Body() body: { name: string }) {
    return this.seasonsService.renameTeam(id, body.name);
  }

  @Delete('teams/:id')
  @Roles('ADMIN', 'MANAGER')
  removeTeam(@Param('id') id: string) {
    return this.seasonsService.removeTeam(id);
  }

  @Post(':id/assign-memberships')
  @Roles('ADMIN', 'MANAGER')
  assign(@Param('id') seasonId: string) {
    return this.seasonsService.assignMemberships(seasonId);
  }

  @Post(':id/memberships/override')
  @Roles('ADMIN', 'MANAGER')
  override(@Param('id') seasonId: string, @Body() body: { memberId: string; teamId: string }) {
    return this.seasonsService.overrideMembership(seasonId, body.memberId, body.teamId);
  }
}
