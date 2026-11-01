import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  createTournamentMatchSchema,
  tournamentNominationSchema,
  tournamentParticipantsSchema,
  updateTournamentMatchSchema,
  type CreateTournamentMatchInput,
  type TournamentNominationInput,
  type TournamentParticipantsInput,
  type UpdateTournamentMatchInput,
} from '@fkknv/shared';
import { TournamentsService } from './tournaments.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod.pipe';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  /** Karta turnaja: údaje, účastníci a zápasy (zoradené podľa poradia, potom času). */
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tournaments.get(id, user);
  }

  @Put(':id/participants')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  setParticipants(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(tournamentParticipantsSchema)) body: TournamentParticipantsInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tournaments.setParticipants(id, body.clubs, user);
  }

  @Post(':id/matches')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  addMatch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createTournamentMatchSchema)) body: CreateTournamentMatchInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tournaments.addMatch(id, body, user);
  }

  @Patch(':id/matches/:eventId')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  updateMatch(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body(new ZodValidationPipe(updateTournamentMatchSchema)) body: UpdateTournamentMatchInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tournaments.updateMatch(id, eventId, body, user);
  }

  @Delete(':id/matches/:eventId')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  removeMatch(@Param('id') id: string, @Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    return this.tournaments.removeMatch(id, eventId, user);
  }

  @Get(':id/candidates')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  candidates(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tournaments.candidates(id, user);
  }

  @Post(':id/nominations')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  nominate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(tournamentNominationSchema)) body: TournamentNominationInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tournaments.nominate(id, body.memberId, user);
  }

  @Delete(':id/nominations/:memberId')
  @Roles('ADMIN', 'MANAGER', 'COACH')
  removeNomination(@Param('id') id: string, @Param('memberId') memberId: string, @CurrentUser() user: AuthUser) {
    return this.tournaments.removeNomination(id, memberId, user);
  }
}
