import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { DunningService } from './dunning.service';
import { FeeMailService } from './fee-mail.service';
import { FinanceController } from './finance.controller';

@Module({
  providers: [FinanceService, DunningService, FeeMailService],
  controllers: [FinanceController],
})
export class FinanceModule {}
