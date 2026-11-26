import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { MembersModule } from './members/members.module';
import { TransfersModule } from './transfers/transfers.module';
import { TasksModule } from './tasks/tasks.module';
import { SeasonsModule } from './seasons/seasons.module';
import { RegistrationModule } from './registration/registration.module';
import { EventsModule } from './events/events.module';
import { MatchesModule } from './matches/matches.module';
import { ClubsModule } from './clubs/clubs.module';
import { FinanceModule } from './finance/finance.module';
import { ChatModule } from './chat/chat.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { FutbalnetModule } from './integrations/futbalnet/futbalnet.module';
import { FitnessTestsModule } from './fitness-tests/fitness-tests.module';
import { CaptchaModule } from './captcha/captcha.module';
import { PublicModule } from './public/public.module';
import { ArticlesModule } from './articles/articles.module';
import { ClubContentModule } from './club-content/club-content.module';
import { PitchesModule } from './pitches/pitches.module';
import { NominationsModule } from './nominations/nominations.module';
import { GoalkeepersModule } from './goalkeepers/goalkeepers.module';
import { AppNewsModule } from './app-news/app-news.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    NotificationsModule,
    AuthModule,
    MembersModule,
    TransfersModule,
    TasksModule,
    SeasonsModule,
    RegistrationModule,
    EventsModule,
    MatchesModule,
    ClubsModule,
    FinanceModule,
    ChatModule,
    GoalkeepersModule,
    AppNewsModule,
    ReportsModule,
    FutbalnetModule,
    CaptchaModule,
    FitnessTestsModule,
    ArticlesModule,
    ClubContentModule,
    PitchesModule,
    NominationsModule,
    PublicModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
