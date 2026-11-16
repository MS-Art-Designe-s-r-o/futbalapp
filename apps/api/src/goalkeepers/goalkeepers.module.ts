import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { GoalkeepersService } from './goalkeepers.service';
import { GoalkeepersController } from './goalkeepers.controller';

@Module({
  imports: [ChatModule],
  providers: [GoalkeepersService],
  controllers: [GoalkeepersController],
  exports: [GoalkeepersService],
})
export class GoalkeepersModule {}
