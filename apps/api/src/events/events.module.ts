import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';
import { EventMediaService } from './event-media.service';
import { EventMediaController } from './event-media.controller';
import { ClubsModule } from '../clubs/clubs.module';

@Module({
  imports: [ClubsModule],
  providers: [EventsService, TournamentsService, EventMediaService],
  controllers: [EventsController, EventMediaController, TournamentsController],
})
export class EventsModule {}
