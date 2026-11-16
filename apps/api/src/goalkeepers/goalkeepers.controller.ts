import { Controller, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { GoalkeepersService } from './goalkeepers.service';

@Controller('goalkeepers')
export class GoalkeepersController {
  constructor(private readonly goalkeepers: GoalkeepersService) {}

  /** Ručné prepočítanie skupín brankárov (inak sa robí automaticky pri zmene člena a v noci). */
  @Post('sync')
  @Roles('ADMIN', 'MANAGER')
  sync() {
    return this.goalkeepers.sync();
  }
}
