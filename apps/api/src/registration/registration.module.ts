import { Module } from '@nestjs/common';
import { SeasonsModule } from '../seasons/seasons.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CaptchaModule } from '../captcha/captcha.module';
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';

@Module({
  imports: [SeasonsModule, CaptchaModule, NotificationsModule],
  providers: [RegistrationService],
  controllers: [RegistrationController],
})
export class RegistrationModule {}
