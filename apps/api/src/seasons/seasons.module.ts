import { Module } from '@nestjs/common';
import { SeasonsService } from './seasons.service';
import { SeasonsController } from './seasons.controller';
import { GoalkeepersModule } from '../goalkeepers/goalkeepers.module';

@Module({
  imports: [GoalkeepersModule],
  providers: [SeasonsService],
  controllers: [SeasonsController],
  exports: [SeasonsService],
})
export class SeasonsModule {}
