import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AppNewsService } from './app-news.service';
import { AppNewsController } from './app-news.controller';

@Module({
  imports: [NotificationsModule],
  providers: [AppNewsService],
  controllers: [AppNewsController],
})
export class AppNewsModule {}
