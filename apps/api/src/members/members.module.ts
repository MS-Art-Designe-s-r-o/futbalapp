import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { IssfService } from '../integrations/issf/issf.service';
import { GoalkeepersModule } from '../goalkeepers/goalkeepers.module';

@Module({
  imports: [GoalkeepersModule],
  providers: [MembersService, IssfService],
  controllers: [MembersController],
  exports: [MembersService],
})
export class MembersModule {}
