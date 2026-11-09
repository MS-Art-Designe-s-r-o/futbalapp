import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { FinanceService, type BankRow } from './finance.service';
import { DunningService } from './dunning.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const createFeePlanSchema = z.object({
  seasonId: z.string(),
  teamCategoryCode: z.string().optional(),
  name: z.string().min(2),
  amountCents: z.number().int().positive(),
  period: z.enum(['MONTHLY', 'QUARTERLY', 'ONE_TIME', 'SEASON']),
  dueDay: z.number().int().min(1).max(28).optional(),
});

const assignSchema = z.object({ memberId: z.string().min(1) });

const updateFeePlanSchema = z.object({
  name: z.string().min(2).optional(),
  amountCents: z.number().int().positive().optional(),
  dueDay: z.number().int().min(1).max(28).optional(),
});

const updateObligationSchema = z.object({
  amountCents: z.number().int().min(0).optional(),
  status: z.enum(['PENDING', 'PAID', 'PARTIAL', 'OVERDUE', 'WAIVED']).optional(),
});

const bankImportSchema = z.object({
  rows: z.array(
    z.object({
      externalId: z.string().min(1),
      date: z.string(),
      amountCents: z.number().int(),
      variableSymbol: z.string().optional(),
      counterpartyIban: z.string().optional(),
      counterpartyName: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
});

@Controller('finance')
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly dunningService: DunningService,
    private readonly prisma: PrismaService,
  ) {}

  /** Manuálne spustenie upomienok (inak bežia denne o 8:00). */
  @Post('dunning/run')
  @Roles('ADMIN', 'MANAGER')
  runDunning() {
    return this.dunningService.run();
  }

  @Get('fee-plans')
  @Roles('ADMIN', 'MANAGER')
  listFeePlans() {
    return this.financeService.listFeePlans();
  }

  @Post('fee-plans')
  @Roles('ADMIN', 'MANAGER')
  createFeePlan(@Body(new ZodValidationPipe(createFeePlanSchema)) body: z.infer<typeof createFeePlanSchema>) {
    return this.financeService.createFeePlan(body);
  }

  @Patch('fee-plans/:id')
  @Roles('ADMIN', 'MANAGER')
  updateFeePlan(@Param('id') id: string, @Body(new ZodValidationPipe(updateFeePlanSchema)) body: z.infer<typeof updateFeePlanSchema>) {
    return this.financeService.updateFeePlan(id, body);
  }

  @Delete('fee-plans/:id')
  @Roles('ADMIN', 'MANAGER')
  deleteFeePlan(@Param('id') id: string) {
    return this.financeService.deleteFeePlan(id);
  }

  @Patch('obligations/:id')
  @Roles('ADMIN', 'MANAGER')
  updateObligation(@Param('id') id: string, @Body(new ZodValidationPipe(updateObligationSchema)) body: z.infer<typeof updateObligationSchema>) {
    return this.financeService.updateObligation(id, body);
  }

  @Delete('obligations/:id')
  @Roles('ADMIN', 'MANAGER')
  deleteObligation(@Param('id') id: string) {
    return this.financeService.deleteObligation(id);
  }

  @Post('obligations/generate')
  @Roles('ADMIN', 'MANAGER')
  generate(@Body() body: { year: number; month: number }) {
    if (!body?.year || !body?.month) throw new BadRequestException('Chýba rok/mesiac');
    return this.financeService.generateObligations(body.year, body.month);
  }

  @Post('bank/import')
  @Roles('ADMIN', 'MANAGER')
  importBank(@Body(new ZodValidationPipe(bankImportSchema)) body: { rows: BankRow[] }) {
    return this.financeService.importBankTransactions(body.rows);
  }

  /** Import bankového výpisu (.xls/.xlsx) — nahranie súboru. */
  @Post('bank/import-file')
  @Roles('ADMIN', 'MANAGER')
  @UseInterceptors(FileInterceptor('file'))
  importBankFile(@UploadedFile() file?: { buffer: Buffer }) {
    if (!file?.buffer) throw new BadRequestException('Chýba súbor (pole "file")');
    return this.financeService.importBankFile(file.buffer);
  }

  @Post('bank/match')
  @Roles('ADMIN', 'MANAGER')
  autoMatch() {
    return this.financeService.autoMatch();
  }

  /** Zoznam bankových pohybov na párovanie (voliteľne podľa stavu). */
  @Get('bank/transactions')
  @Roles('ADMIN', 'MANAGER')
  bankTransactions(@Query('status') status?: string) {
    return this.financeService.listBankTransactions(status);
  }

  /** Ručné priradenie pohybu členovi (naučí IBAN + rozúčtuje). */
  @Post('bank/:txId/assign')
  @Roles('ADMIN', 'MANAGER')
  assign(@Param('txId') txId: string, @Body(new ZodValidationPipe(assignSchema)) body: { memberId: string }) {
    return this.financeService.assignTransaction(txId, body.memberId);
  }

  /** Označí pohyb ako ignorovaný. */
  @Post('bank/:txId/ignore')
  @Roles('ADMIN', 'MANAGER')
  ignore(@Param('txId') txId: string) {
    return this.financeService.ignoreTransaction(txId);
  }

  @Get('overview')
  @Roles('ADMIN', 'MANAGER')
  overview(@Query('year') year?: string) {
    return this.financeService.paymentsOverview(Number(year) || new Date().getFullYear());
  }

  @Get('debtors')
  @Roles('ADMIN', 'MANAGER')
  debtors() {
    return this.financeService.debtors();
  }

  /** Rodič vidí platby len svojich detí; vedenie ľubovoľného člena. */
  @Get('members/:memberId/payments')
  async memberPayments(
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const isStaff = user.roles.some((r) => r.role === 'ADMIN' || r.role === 'MANAGER');
    if (!isStaff) {
      const guardian = await this.prisma.guardian.findUnique({
        where: { userId_memberId: { userId: user.id, memberId } },
      });
      const ownMember = await this.prisma.member.findFirst({ where: { id: memberId, userId: user.id } });
      if (!guardian && !ownMember) throw new ForbiddenException('Nemáte prístup k platbám tohto člena');
    }
    return this.financeService.memberPayments(memberId, from, to);
  }
}
