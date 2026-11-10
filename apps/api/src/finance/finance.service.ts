import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { BankTransaction } from '@prisma/client';
import { generateVariableSymbol, periodLabel } from '@fkknv/shared';
import { PrismaService } from '../prisma/prisma.service';
import { parseBankStatement } from './bank-statement';
import { buildIndex, suggestMemberId } from './name-match';

export interface BankRow {
  externalId: string;
  date: string; // ISO
  amountCents: number;
  variableSymbol?: string;
  counterpartyIban?: string;
  counterpartyName?: string;
  message?: string;
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  listFeePlans() {
    return this.prisma.feePlan.findMany({
      include: { teamCategory: true, season: true, assignments: { select: { id: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createFeePlan(input: {
    seasonId: string;
    teamCategoryCode?: string;
    name: string;
    amountCents: number;
    period: 'MONTHLY' | 'QUARTERLY' | 'ONE_TIME' | 'SEASON';
    dueDay?: number;
  }) {
    const season = await this.prisma.season.findUnique({ where: { id: input.seasonId } });
    if (!season) throw new NotFoundException('Sezóna neexistuje');
    const category = input.teamCategoryCode
      ? await this.prisma.teamCategory.findUnique({ where: { code: input.teamCategoryCode } })
      : null;

    const plan = await this.prisma.feePlan.create({
      data: {
        seasonId: season.id,
        teamCategoryId: category?.id,
        name: input.name,
        amountCents: input.amountCents,
        period: input.period,
        dueDay: input.dueDay ?? 15,
        activeFrom: season.startDate,
        activeTo: season.endDate,
      },
    });

    // Automaticky priradí predpis všetkým aktívnym členom kategórie (resp. celého klubu)
    const memberships = await this.prisma.teamMembership.findMany({
      where: {
        seasonId: season.id,
        leftAt: null,
        team: category ? { teamCategoryId: category.id } : undefined,
        member: { status: 'ACTIVE', socialCase: false },
      },
    });
    if (memberships.length > 0) {
      await this.prisma.feeAssignment.createMany({
        data: memberships.map((m) => ({ feePlanId: plan.id, memberId: m.memberId })),
        skipDuplicates: true,
      });
    }
    return this.prisma.feePlan.findUnique({
      where: { id: plan.id },
      include: { assignments: { select: { id: true } } },
    });
  }

  /**
   * Vygeneruje platobné povinnosti pre daný mesiac zo všetkých aktívnych
   * mesačných predpisov. Idempotentné — existujúce povinnosti sa preskočia.
   */
  async generateObligations(year: number, month: number) {
    if (month < 1 || month > 12) throw new BadRequestException('Neplatný mesiac');
    const assignments = await this.prisma.feeAssignment.findMany({
      // sociálnym prípadom sa poplatok nevytvára
      where: { active: true, feePlan: { period: 'MONTHLY' }, member: { socialCase: false } },
      include: { feePlan: true, member: { select: { memberSeq: true } } },
    });

    const label = periodLabel(year, month);
    let created = 0;
    for (const assignment of assignments) {
      const amount = assignment.overrideCents ?? assignment.feePlan.amountCents;
      const dueDate = new Date(Date.UTC(year, month - 1, assignment.feePlan.dueDay));
      try {
        await this.prisma.paymentObligation.create({
          data: {
            feeAssignmentId: assignment.id,
            memberId: assignment.memberId,
            periodLabel: label,
            amountCents: amount,
            variableSymbol: generateVariableSymbol(assignment.member.memberSeq, { year, month }),
            dueDate,
          },
        });
        created++;
      } catch {
        // unique constraint (feeAssignmentId, periodLabel) — už vygenerované
      }
    }
    return { period: label, created, total: assignments.length };
  }

  /** Import bankového výpisu (.xls/.xlsx VÚB) + automatické párovanie. */
  async importBankFile(buffer: Buffer) {
    const rows = parseBankStatement(buffer);
    if (rows.length === 0) throw new BadRequestException('Vo výpise sa nenašli žiadne prichádzajúce platby');
    return this.importBankTransactions(rows, 'XLS');
  }

  /** Uloží bankové pohyby (idempotentne podľa externalId) a spustí párovanie. */
  async importBankTransactions(rows: BankRow[], source = 'CSV') {
    let imported = 0;
    for (const row of rows) {
      try {
        await this.prisma.bankTransaction.create({
          data: {
            source,
            externalId: row.externalId,
            date: new Date(row.date),
            amountCents: row.amountCents,
            variableSymbol: row.variableSymbol,
            counterpartyIban: row.counterpartyIban,
            counterpartyName: row.counterpartyName,
            message: row.message,
          },
        });
        imported++;
      } catch {
        // duplicitný externalId — pohyb už bol importovaný
      }
    }
    const matched = await this.autoMatch();
    return { imported, ...matched };
  }

  /**
   * Automatické párovanie prichádzajúcich platieb:
   *  1. naučený IBAN (BankPayerLink) → automaticky priradí členovi,
   *  2. VS = náš variabilný symbol (RRMM + memberSeq) → automaticky,
   *  3. inak fuzzy zhoda mena/zdrobneniny → uloží sa len ako návrh (suggestedMemberId).
   * Priradenie rozúčtuje sumu na otvorené povinnosti člena od najstaršej.
   */
  async autoMatch() {
    const index = buildIndex(
      (
        await this.prisma.member.findMany({
          select: {
            id: true,
            firstName: true,
            lastName: true,
            guardians: { select: { user: { select: { firstName: true, lastName: true } } } },
          },
        })
      ).map((m) => ({
        memberId: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        guardianNames: m.guardians.map((g) => g.user),
      })),
    );

    const unmatched = await this.prisma.bankTransaction.findMany({
      where: { matchStatus: 'UNMATCHED', amountCents: { gt: 0 } },
    });

    let matched = 0;
    let suggested = 0;
    for (const tx of unmatched) {
      // 1. naučený IBAN
      let memberId: string | null = null;
      if (tx.counterpartyIban) {
        const link = await this.prisma.bankPayerLink.findUnique({ where: { iban: tx.counterpartyIban } });
        if (link) memberId = link.memberId;
      }
      // 2. VS = náš variabilný symbol
      if (!memberId && tx.variableSymbol && /^\d{10}$/.test(tx.variableSymbol)) {
        const member = await this.prisma.member.findUnique({ where: { memberSeq: Number(tx.variableSymbol.slice(4)) } });
        if (member) memberId = member.id;
      }
      if (memberId) {
        await this.allocateToMember(tx, memberId, 'AUTO');
        matched++;
        continue;
      }
      // 3. fuzzy meno → návrh (bez auto-priradenia)
      const sug = suggestMemberId(tx.counterpartyName, tx.message, index);
      if (sug) {
        await this.prisma.bankTransaction.update({ where: { id: tx.id }, data: { suggestedMemberId: sug } });
        suggested++;
      }
    }
    return { matchedTransactions: matched, suggestedTransactions: suggested };
  }

  /** Rozúčtuje sumu pohybu na otvorené povinnosti člena (od najstaršej). */
  private async allocateToMember(tx: BankTransaction, memberId: string, matchedBy: 'AUTO' | 'MANUAL') {
    const obligations = await this.prisma.paymentObligation.findMany({
      where: { memberId, status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } },
      orderBy: { dueDate: 'asc' },
    });
    let remaining = tx.amountCents;
    for (const o of obligations) {
      if (remaining <= 0) break;
      const applied = Math.min(o.amountCents - o.paidCents, remaining);
      if (applied <= 0) continue;
      await this.prisma.$transaction([
        this.prisma.paymentMatch.upsert({
          where: { bankTransactionId_paymentObligationId: { bankTransactionId: tx.id, paymentObligationId: o.id } },
          create: { bankTransactionId: tx.id, paymentObligationId: o.id, amountCents: applied, matchedBy },
          update: { amountCents: applied, matchedBy },
        }),
        this.prisma.paymentObligation.update({
          where: { id: o.id },
          data: {
            paidCents: o.paidCents + applied,
            status: o.paidCents + applied >= o.amountCents ? 'PAID' : 'PARTIAL',
          },
        }),
      ]);
      remaining -= applied;
    }
    await this.prisma.bankTransaction.update({
      where: { id: tx.id },
      data: { matchedMemberId: memberId, suggestedMemberId: null, matchStatus: matchedBy === 'MANUAL' ? 'MANUAL' : 'MATCHED' },
    });
    return { allocatedCents: tx.amountCents - remaining, remainingCents: remaining };
  }

  /** Zruší existujúce párovania pohybu (vráti uhradené sumy na povinnostiach). */
  private async clearMatches(txId: string) {
    const matches = await this.prisma.paymentMatch.findMany({
      where: { bankTransactionId: txId },
      include: { paymentObligation: true },
    });
    for (const mt of matches) {
      const paid = mt.paymentObligation.paidCents - mt.amountCents;
      await this.prisma.$transaction([
        this.prisma.paymentObligation.update({
          where: { id: mt.paymentObligationId },
          data: { paidCents: Math.max(0, paid), status: paid <= 0 ? 'PENDING' : 'PARTIAL' },
        }),
        this.prisma.paymentMatch.delete({ where: { id: mt.id } }),
      ]);
    }
  }

  /**
   * Ručné potvrdenie/priradenie pohybu členovi. Naučí sa IBAN (ďalšie platby
   * z toho účtu sa spárujú automaticky) a rozúčtuje sumu na povinnosti člena.
   */
  async assignTransaction(txId: string, memberId: string) {
    const tx = await this.prisma.bankTransaction.findUnique({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Pohyb neexistuje');
    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Člen neexistuje');

    await this.clearMatches(txId); // pri prípadnom preradení
    let alsoMatched = 0;
    if (tx.counterpartyIban) {
      await this.prisma.bankPayerLink.upsert({
        where: { iban: tx.counterpartyIban },
        create: { iban: tx.counterpartyIban, memberId },
        update: { memberId },
      });
      // naučený účet — dotiahni ostatné nespárované platby z toho istého IBAN
      const others = await this.prisma.bankTransaction.findMany({
        where: { counterpartyIban: tx.counterpartyIban, matchStatus: 'UNMATCHED', id: { not: txId }, amountCents: { gt: 0 } },
      });
      for (const other of others) {
        await this.allocateToMember(other, memberId, 'AUTO');
        alsoMatched++;
      }
    }
    const result = await this.allocateToMember(tx, memberId, 'MANUAL');
    return { memberId, learnedIban: tx.counterpartyIban ?? null, alsoMatched, ...result };
  }

  /** Označí pohyb ako ignorovaný (napr. dotácia, nečlenská platba). */
  async ignoreTransaction(txId: string) {
    await this.clearMatches(txId);
    return this.prisma.bankTransaction.update({
      where: { id: txId },
      data: { matchStatus: 'IGNORED', suggestedMemberId: null, matchedMemberId: null },
    });
  }

  /** Zoznam bankových pohybov (prichádzajúcich) pre obrazovku párovania. */
  listBankTransactions(status?: string) {
    return this.prisma.bankTransaction.findMany({
      where: {
        amountCents: { gt: 0 },
        matchStatus: status ? (status as BankTransaction['matchStatus']) : undefined,
      },
      include: {
        suggestedMember: { select: { id: true, firstName: true, lastName: true } },
        matchedMember: { select: { id: true, firstName: true, lastName: true } },
        matches: { select: { amountCents: true, paymentObligation: { select: { periodLabel: true } } } },
      },
      orderBy: { date: 'desc' },
      take: 500,
    });
  }

  /** Úprava platobnej povinnosti (dlhu) — suma a/alebo stav (napr. odpustenie). */
  async updateObligation(id: string, input: { amountCents?: number; status?: string }) {
    const o = await this.prisma.paymentObligation.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Povinnosť neexistuje');
    const amountCents = input.amountCents ?? o.amountCents;
    let status = input.status as typeof o.status | undefined;
    if (!status) {
      // prepočítaj stav podľa novej sumy a uhradenej časti
      status =
        o.paidCents >= amountCents ? 'PAID' : o.paidCents > 0 ? 'PARTIAL' : o.dueDate < new Date() ? 'OVERDUE' : 'PENDING';
    }
    return this.prisma.paymentObligation.update({ where: { id }, data: { amountCents, status } });
  }

  /** Zmazanie platobnej povinnosti (dlhu). */
  async deleteObligation(id: string) {
    await this.prisma.paymentObligation.delete({ where: { id } });
    return { deleted: true };
  }

  /** Úprava predpisu poplatku. */
  async updateFeePlan(id: string, input: { name?: string; amountCents?: number; dueDay?: number }) {
    const plan = await this.prisma.feePlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Predpis neexistuje');
    return this.prisma.feePlan.update({
      where: { id },
      data: { name: input.name, amountCents: input.amountCents, dueDay: input.dueDay },
    });
  }

  /** Zmazanie predpisu poplatku (kaskádovo aj priradenia a povinnosti). */
  async deleteFeePlan(id: string) {
    await this.prisma.feePlan.delete({ where: { id } });
    return { deleted: true };
  }

  /** Prehľad dlžníkov: povinnosti po splatnosti, zoskupené po členoch. */
  async debtors() {
    await this.prisma.paymentObligation.updateMany({
      where: { status: { in: ['PENDING', 'PARTIAL'] }, dueDate: { lt: new Date() } },
      data: { status: 'OVERDUE' },
    });
    const overdue = await this.prisma.paymentObligation.findMany({
      where: { status: 'OVERDUE' },
      include: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            guardians: { include: { user: { select: { email: true, phone: true } } } },
            memberships: {
              where: { leftAt: null, season: { isActive: true } },
              include: { team: { include: { teamCategory: { select: { code: true } } } } },
            },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    const byMember = new Map<string, { member: unknown; owedCents: number; periods: string[] }>();
    for (const o of overdue) {
      const entry = byMember.get(o.memberId) ?? { member: o.member, owedCents: 0, periods: [] };
      entry.owedCents += o.amountCents - o.paidCents;
      entry.periods.push(o.periodLabel);
      byMember.set(o.memberId, entry);
    }
    return [...byMember.values()].sort((a, b) => b.owedCents - a.owedCents);
  }

  /** Stav platieb člena — pre rodiča aj podklad pre športový príspevok. */
  memberPayments(memberId: string, fromLabel?: string, toLabel?: string) {
    return this.prisma.paymentObligation.findMany({
      where: {
        memberId,
        periodLabel: { gte: fromLabel, lte: toLabel },
      },
      include: { matches: { include: { bankTransaction: { select: { date: true } } } } },
      orderBy: { periodLabel: 'asc' },
    });
  }
}
