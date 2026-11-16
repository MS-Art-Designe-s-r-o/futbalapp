import { Module } from '@nestjs/common';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { GoalkeepersModule } from '../goalkeepers/goalkeepers.module';

@Module({
  imports: [GoalkeepersModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
