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
  dueDate: z.string().optional(),
  memberIds: z.array(z.string().min(1)).optional(),
});

const assignMembersSchema = z.object({ memberIds: z.array(z.string().min(1)).min(1) });

const dunningSendSchema = z.object({ memberIds: z.array(z.string().min(1)).min(1) });

const createExpenseSchema = z.object({
  payee: z.string().min(1),
  amountCents: z.number().int().positive(),
  variableSymbol: z.string().optional(),
  dueDate: z.string().optional(),
  iban: z.string().optional(),
  description: z.string().optional(),
});

const updateExpenseSchema = z.object({
  payee: z.string().min(1).optional(),
  amountCents: z.number().int().positive().optional(),
  variableSymbol: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  iban: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(['PLANNED', 'PAID']).optional(),
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

  /** Náhľad príjemcov ospravedlnenia za testovacie upomienky. */
  @Get('dunning/apology')
  @Roles('ADMIN')
  apologyPreview() {
    return this.dunningService.apologyRecipients();
  }

  /** Odošle rodičom, ktorým prišla upomienka, oznam že išlo o testovaciu správu. */
  @Post('dunning/apology')
  @Roles('ADMIN')
  sendApology() {
    return this.dunningService.sendApology();
  }

  /** Náhľad upomienok: všetci členovia s povinnosťami po splatnosti (nič sa neposiela). */
  @Get('dunning/preview')
  @Roles('ADMIN', 'MANAGER')
  dunningPreview() {
    return this.dunningService.preview();
  }

  /** Ručné odoslanie upomienky (push + e-mail) len vybraným členom. */
  @Post('dunning/send')
  @Roles('ADMIN', 'MANAGER')
  dunningSend(@Body(new ZodValidationPipe(dunningSendSchema)) body: z.infer<typeof dunningSendSchema>) {
    return this.dunningService.send(body.memberIds);
  }

  @Get('overview')
  @Roles('ADMIN', 'MANAGER')
  overview(@Query('year') year?: string, @Query('month') month?: string) {
    const y = year ? Number(year) : new Date().getUTCFullYear();
    const m = month ? Number(month) : null;
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException('Neplatný rok');
    if (m !== null && (!Number.isInteger(m) || m < 1 || m > 12)) throw new BadRequestException('Neplatný mesiac');
    return this.financeService.overview(y, m);
  }

  @Get('expenses')
  @Roles('ADMIN', 'MANAGER')
  listExpenses(@Query('status') status?: string, @Query('year') year?: string, @Query('month') month?: string) {
    return this.financeService.listExpenses({
      status,
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
    });
  }

  @Post('expenses')
  @Roles('ADMIN', 'MANAGER')
  createExpense(@Body(new ZodValidationPipe(createExpenseSchema)) body: z.infer<typeof createExpenseSchema>) {
    return this.financeService.createExpense(body);
  }

  @Patch('expenses/:id')
  @Roles('ADMIN', 'MANAGER')
  updateExpense(@Param('id') id: string, @Body(new ZodValidationPipe(updateExpenseSchema)) body: z.infer<typeof updateExpenseSchema>) {
    return this.financeService.updateExpense(id, body);
  }

  @Delete('expenses/:id')
  @Roles('ADMIN', 'MANAGER')
  deleteExpense(@Param('id') id: string) {
    return this.financeService.deleteExpense(id);
  }

  @Post('expenses/:id/pay')
  @Roles('ADMIN', 'MANAGER')
  payExpense(@Param('id') id: string) {
    return this.financeService.payExpense(id);
  }

  @Post('fee-plans/:id/assign-members')
  @Roles('ADMIN', 'MANAGER')
  assignMembers(@Param('id') id: string, @Body(new ZodValidationPipe(assignMembersSchema)) body: z.infer<typeof assignMembersSchema>) {
    return this.financeService.assignMembers(id, body.memberIds);
  }

  @Delete('fee-plans/:id/assign/:memberId')
  @Roles('ADMIN', 'MANAGER')
  unassignMember(@Param('id') id: string, @Param('memberId') memberId: string) {
    return this.financeService.unassignMember(id, memberId);
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

  @Get('debtors')
  @Roles('ADMIN', 'MANAGER')
  debtors() {
    return this.financeService.debtors();
  }

  /**
   * Vedenie (ADMIN/MANAGER) vidí všetko vrátane výsledkov párovania; hráč (vlastné platby)
   * a rodič (platby svojho dieťaťa) len periodLabel, sumy, stav, splatnosť, VS a planName.
   */
  @Get('members/:memberId/payments')
  async memberPayments(
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const isStaff = user.roles.some((r) => r.role === 'ADMIN' || r.role === 'MANAGER');
    if (!isStaff) {
      const [ownMember, guardian] = await Promise.all([
        this.prisma.member.findFirst({ where: { id: memberId, userId: user.id } }),
        this.prisma.guardian.findUnique({ where: { userId_memberId: { userId: user.id, memberId } } }),
      ]);
      if (!ownMember && !guardian) throw new ForbiddenException('Nemáte prístup k platbám tohto člena');
    }
    return this.financeService.memberPayments(memberId, from, to, isStaff);
  }
}
