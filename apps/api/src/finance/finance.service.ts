import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { BankTransaction, Prisma } from '@prisma/client';
import { generateVariableSymbol, parsePaymentVariableSymbol, paymentVariableSymbol, periodLabel } from '@fkknv/shared';
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

/** Rozsah dátumov [od, do) pre rok (a voliteľne mesiac), UTC. */
export function periodRange(year: number, month?: number | null): { gte: Date; lt: Date } {
  return month
    ? { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) }
    : { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
}

const normText = (s?: string | null) =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normIban = (s?: string | null) => (s ?? '').replace(/\s+/g, '').toUpperCase();

/** Vyberie z kandidátov (rovnaká suma) výdavok pre odchádzajúci pohyb: VS → IBAN → názov príjemcu. */
export function pickExpenseMatch<
  E extends { variableSymbol: string | null; iban: string | null; payee: string },
>(
  cands: E[],
  tx: { variableSymbol?: string | null; counterpartyIban?: string | null; counterpartyName?: string | null },
): E | undefined {
  const vs = (tx.variableSymbol ?? '').replace(/^0+/, '');
  if (vs) {
    const hit = cands.find((e) => (e.variableSymbol ?? '').replace(/^0+/, '') === vs);
    if (hit) return hit;
  }
  const iban = normIban(tx.counterpartyIban);
  if (iban) {
    const hit = cands.find((e) => normIban(e.iban) === iban);
    if (hit) return hit;
  }
  const name = normText(tx.counterpartyName);
  if (name.length >= 3) {
    return cands.find((e) => {
      const p = normText(e.payee);
      return p.length >= 3 && (name.includes(p) || p.includes(name));
    });
  }
  return undefined;
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

  /** VS povinnosti: nový formát (reg. číslo + MMRR), inak starý (RRMM + memberSeq). */
  private obligationVs(member: { memberSeq: number; registrationNumber: string | null }, year: number, month: number) {
    return (
      paymentVariableSymbol(member.registrationNumber, { year, month }) ??
      generateVariableSymbol(member.memberSeq, { year, month })
    );
  }

  /** Jednorazový predpis: jedna povinnosť na každé priradenie (idempotentné). */
  private async generateOneTimeObligations(planId: string) {
    const plan = await this.prisma.feePlan.findUnique({ where: { id: planId } });
    if (!plan || plan.period !== 'ONE_TIME' || !plan.dueDate) return 0;
    const year = plan.dueDate.getUTCFullYear();
    const month = plan.dueDate.getUTCMonth() + 1;
    const label = `JEDNORAZOVO-${periodLabel(year, month)}`;
    const assignments = await this.prisma.feeAssignment.findMany({
      where: { feePlanId: planId, active: true },
      include: { member: { select: { memberSeq: true, registrationNumber: true } } },
    });
    let created = 0;
    for (const a of assignments) {
      try {
        await this.prisma.paymentObligation.create({
          data: {
            feeAssignmentId: a.id,
            memberId: a.memberId,
            periodLabel: label,
            amountCents: a.overrideCents ?? plan.amountCents,
            variableSymbol: this.obligationVs(a.member, year, month),
            dueDate: plan.dueDate,
          },
        });
        created++;
      } catch {
        // už existuje (feeAssignmentId, periodLabel)
      }
    }
    return created;
  }

  async createFeePlan(input: {
    seasonId: string;
    teamCategoryCode?: string;
    memberIds?: string[];
    name: string;
    amountCents: number;
    period: 'MONTHLY' | 'QUARTERLY' | 'ONE_TIME' | 'SEASON';
    dueDay?: number;
    dueDate?: string;
  }) {
    const season = await this.prisma.season.findUnique({ where: { id: input.seasonId } });
    if (!season) throw new NotFoundException('Sezóna neexistuje');
    let dueDate: Date | undefined;
    if (input.dueDate) {
      dueDate = new Date(input.dueDate);
      if (Number.isNaN(dueDate.getTime())) throw new BadRequestException('Neplatný dátum splatnosti');
    }
    if (input.period === 'ONE_TIME' && !dueDate) {
      throw new BadRequestException('Jednorazový predpis vyžaduje dátum splatnosti');
    }
    const category = input.teamCategoryCode
      ? await this.prisma.teamCategory.findUnique({ where: { code: input.teamCategoryCode } })
      : null;
    if (input.teamCategoryCode && !category) throw new NotFoundException('Kategória neexistuje');
    const explicitIds = [...new Set(input.memberIds ?? [])];

    const plan = await this.prisma.feePlan.create({
      data: {
        seasonId: season.id,
        teamCategoryId: category?.id,
        name: input.name,
        amountCents: input.amountCents,
        period: input.period,
        dueDay: input.dueDay ?? 15,
        dueDate: input.period === 'ONE_TIME' ? dueDate : null,
        activeFrom: season.startDate,
        activeTo: season.endDate,
      },
    });

    const memberIds = new Set<string>(explicitIds); // explicitní členovia sa pridajú vždy
    // Kategória (alebo celý klub, ak nie je zadaná ani kategória ani členovia): aktívni, bez sociálnych prípadov
    if (category || explicitIds.length === 0) {
      const memberships = await this.prisma.teamMembership.findMany({
        where: {
          seasonId: season.id,
          leftAt: null,
          team: category ? { teamCategoryId: category.id } : undefined,
          member: { status: 'ACTIVE', socialCase: false },
        },
        select: { memberId: true },
      });
      for (const m of memberships) memberIds.add(m.memberId);
    }
    if (memberIds.size > 0) {
      await this.prisma.feeAssignment.createMany({
        data: [...memberIds].map((memberId) => ({ feePlanId: plan.id, memberId })),
        skipDuplicates: true,
      });
    }
    if (plan.period === 'ONE_TIME') await this.generateOneTimeObligations(plan.id);
    return this.prisma.feePlan.findUnique({
      where: { id: plan.id },
      include: { assignments: { select: { id: true } } },
    });
  }

  /** Doplní hráčov do existujúceho predpisu (jednorazový → hneď vytvorí povinnosti). */
  async assignMembers(planId: string, memberIds: string[]) {
    const plan = await this.prisma.feePlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Predpis neexistuje');
    const existing = await this.prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true } });
    const r = await this.prisma.feeAssignment.createMany({
      data: existing.map((m) => ({ feePlanId: planId, memberId: m.id })),
      skipDuplicates: true,
    });
    if (plan.period === 'ONE_TIME') await this.generateOneTimeObligations(planId);
    return { assigned: r.count };
  }

  /** Odoberie hráča z predpisu (zmaže aj jeho povinnosti z tohto predpisu). */
  async unassignMember(planId: string, memberId: string) {
    const r = await this.prisma.feeAssignment.deleteMany({ where: { feePlanId: planId, memberId } });
    if (r.count === 0) throw new NotFoundException('Priradenie neexistuje');
    return { deleted: true };
  }

  /**
   * Vygeneruje platobné povinnosti pre daný mesiac zo všetkých aktívnych
   * mesačných predpisov (jednorazové sa ignorujú). Idempotentné.
   */
  async generateObligations(year: number, month: number) {
    if (month < 1 || month > 12) throw new BadRequestException('Neplatný mesiac');
    const assignments = await this.prisma.feeAssignment.findMany({
      // sociálnym prípadom sa poplatok nevytvára
      where: { active: true, feePlan: { period: 'MONTHLY' }, member: { socialCase: false } },
      include: { feePlan: true, member: { select: { memberSeq: true, registrationNumber: true } } },
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
            variableSymbol: this.obligationVs(assignment.member, year, month),
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
    const newDebits: BankTransaction[] = [];
    for (const row of rows) {
      try {
        const tx = await this.prisma.bankTransaction.create({
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
        if (tx.amountCents < 0) newDebits.push(tx);
      } catch {
        // duplicitný externalId — pohyb už bol importovaný
      }
    }
    const matched = await this.autoMatch();
    const expenses = await this.matchExpenses(newDebits);
    return { imported, ...matched, ...expenses };
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

    // index registračných čísel (len číslice, bez núl zľava) → člen
    const regIndex = new Map<string, string>();
    for (const m of await this.prisma.member.findMany({
      where: { registrationNumber: { not: null } },
      select: { id: true, registrationNumber: true },
    })) {
      const d = (m.registrationNumber ?? '').replace(/\D/g, '').replace(/^0+/, '');
      if (d && !regIndex.has(d)) regIndex.set(d, m.id);
    }

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
      // 2. VS = náš variabilný symbol (nový: reg. číslo + MMRR; starý: RRMM + memberSeq)
      if (!memberId && tx.variableSymbol) {
        const vs = tx.variableSymbol.trim();
        const parsedNew = parsePaymentVariableSymbol(vs);
        if (parsedNew) memberId = regIndex.get(parsedNew.registrationDigits) ?? null;
        if (!memberId && /^\d{10}$/.test(vs)) {
          const member = await this.prisma.member.findUnique({ where: { memberSeq: Number(vs.slice(4)) } });
          if (member) memberId = member.id;
        }
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

  /**
   * Úprava platobnej povinnosti (dlhu) — suma a/alebo stav.
   * PAID = ručne uhradené (paidCents = amountCents); návrat z PAID vráti paidCents
   * na sumu pridelenú z bankových pohybov.
   */
  async updateObligation(id: string, input: { amountCents?: number; status?: string }) {
    const o = await this.prisma.paymentObligation.findUnique({ where: { id }, include: { matches: true } });
    if (!o) throw new NotFoundException('Povinnosť neexistuje');
    const amountCents = input.amountCents ?? o.amountCents;
    let status = input.status as typeof o.status | undefined;
    let paidCents = o.paidCents;
    if (status === 'PAID') {
      paidCents = amountCents;
    } else if (status && o.status === 'PAID' && status !== 'WAIVED') {
      paidCents = Math.min(
        o.matches.reduce((sum, m) => sum + m.amountCents, 0),
        amountCents,
      );
      if (paidCents > 0 && paidCents < amountCents && (status === 'PENDING' || status === 'OVERDUE')) status = 'PARTIAL';
    }
    if (!status) {
      // prepočítaj stav podľa novej sumy a uhradenej časti
      status =
        paidCents >= amountCents ? 'PAID' : paidCents > 0 ? 'PARTIAL' : o.dueDate < new Date() ? 'OVERDUE' : 'PENDING';
    }
    return this.prisma.paymentObligation.update({ where: { id }, data: { amountCents, status, paidCents } });
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

  /**
   * Stav platieb člena. Pre vedenie (staff) aj s výsledkami párovania (`matches`),
   * pre ostatných (hráč, rodič) len periodLabel, sumy, stav, splatnosť, VS a planName.
   */
  async memberPayments(memberId: string, fromLabel?: string, toLabel?: string, staff = true) {
    const rows = await this.prisma.paymentObligation.findMany({
      where: {
        memberId,
        periodLabel: { gte: fromLabel, lte: toLabel },
      },
      include: {
        matches: { include: { bankTransaction: { select: { date: true } } } },
        feeAssignment: { select: { feePlan: { select: { name: true } } } },
      },
      orderBy: { periodLabel: 'asc' },
    });
    return rows.map(({ feeAssignment, matches, ...o }) => {
      const planName = feeAssignment.feePlan.name;
      if (staff) return { ...o, matches, planName };
      return {
        id: o.id,
        periodLabel: o.periodLabel,
        amountCents: o.amountCents,
        paidCents: o.paidCents,
        status: o.status,
        dueDate: o.dueDate,
        variableSymbol: o.variableSymbol,
        planName,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Výdavky
  // -------------------------------------------------------------------------

  async listExpenses(q: { status?: string; year?: number; month?: number }) {
    const where: Prisma.ExpenseWhereInput = {};
    if (q.status === 'PLANNED' || q.status === 'PAID') where.status = q.status;
    if (q.year) {
      const range = periodRange(q.year, q.month);
      where.OR = [
        { paidAt: range },
        { paidAt: null, dueDate: range },
        { paidAt: null, dueDate: null, createdAt: range },
      ];
    }
    const rows = await this.prisma.expense.findMany({ where });
    const eff = (e: { paidAt: Date | null; dueDate: Date | null; createdAt: Date }) =>
      (e.paidAt ?? e.dueDate ?? e.createdAt).getTime();
    return rows.sort((a, b) => eff(b) - eff(a));
  }

  createExpense(input: {
    payee: string;
    amountCents: number;
    variableSymbol?: string;
    dueDate?: string;
    iban?: string;
    description?: string;
  }) {
    return this.prisma.expense.create({
      data: {
        payee: input.payee,
        amountCents: input.amountCents,
        variableSymbol: input.variableSymbol || null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        iban: input.iban || null,
        description: input.description || null,
      },
    });
  }

  async updateExpense(
    id: string,
    input: {
      payee?: string;
      amountCents?: number;
      variableSymbol?: string | null;
      dueDate?: string | null;
      iban?: string | null;
      description?: string | null;
      status?: 'PLANNED' | 'PAID';
    },
  ) {
    const e = await this.prisma.expense.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Výdavok neexistuje');
    const data: Prisma.ExpenseUpdateInput = {
      payee: input.payee,
      amountCents: input.amountCents,
      variableSymbol: input.variableSymbol,
      iban: input.iban,
      description: input.description,
      dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
    };
    if (input.status === 'PAID' && e.status !== 'PAID') {
      data.status = 'PAID';
      data.paidAt = new Date();
    } else if (input.status === 'PLANNED' && e.status !== 'PLANNED') {
      data.status = 'PLANNED';
      data.paidAt = null;
    }
    return this.prisma.expense.update({ where: { id }, data });
  }

  async deleteExpense(id: string) {
    const r = await this.prisma.expense.deleteMany({ where: { id } });
    if (r.count === 0) throw new NotFoundException('Výdavok neexistuje');
    return { deleted: true };
  }

  async payExpense(id: string) {
    const e = await this.prisma.expense.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Výdavok neexistuje');
    if (e.status === 'PAID') return e;
    return this.prisma.expense.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
  }

  /**
   * Párovanie odchádzajúcich pohybov s plánovanými výdavkami (VS+suma → IBAN+suma → suma+názov);
   * nespárované debety sa založia ako uhradené výdavky.
   */
  async matchExpenses(debits: BankTransaction[]) {
    let expensesMatched = 0;
    let expensesCreated = 0;
    if (debits.length === 0) return { expensesMatched, expensesCreated };
    const planned = await this.prisma.expense.findMany({ where: { status: 'PLANNED', bankTransactionId: null } });
    const used = new Set<string>();
    for (const tx of debits) {
      const abs = -tx.amountCents;
      const cands = planned.filter((e) => !used.has(e.id) && e.amountCents === abs);
      const found = pickExpenseMatch(cands, tx);
      if (found) {
        used.add(found.id);
        await this.prisma.expense.update({
          where: { id: found.id },
          data: { status: 'PAID', paidAt: tx.date, bankTransactionId: tx.id },
        });
        expensesMatched++;
      } else {
        await this.prisma.expense.create({
          data: {
            payee: tx.counterpartyName || tx.counterpartyIban || 'Neznámy príjemca',
            description: tx.message,
            amountCents: abs,
            variableSymbol: tx.variableSymbol,
            iban: tx.counterpartyIban,
            status: 'PAID',
            paidAt: tx.date,
            bankTransactionId: tx.id,
          },
        });
        expensesCreated++;
      }
    }
    return { expensesMatched, expensesCreated };
  }

  // -------------------------------------------------------------------------
  // Prehľad
  // -------------------------------------------------------------------------

  /** Prehľad financií za rok (alebo mesiac): predpisy, platby, ostatné príjmy, výdavky, bilancia. */
  async overview(year: number, month?: number | null) {
    const range = periodRange(year, month);
    const now = new Date();
    const m = month ?? null;
    const bucketOf = (d: Date) => (m ? d.getUTCDate() : d.getUTCMonth() + 1);
    const size = m ? new Date(Date.UTC(year, m, 0)).getUTCDate() : 12;
    const buckets = Array.from({ length: size }, (_, i) => ({
      key: i + 1,
      prescribedCents: 0,
      paidCents: 0,
      otherIncomeCents: 0,
      expensesCents: 0,
    }));
    const bucket = (d: Date) => buckets[bucketOf(d) - 1]!;

    const obligations = await this.prisma.paymentObligation.findMany({
      where: { dueDate: range },
      include: {
        member: {
          select: {
            firstName: true,
            lastName: true,
            memberships: {
              where: { leftAt: null, season: { isActive: true } },
              select: { team: { select: { name: true } } },
              take: 1,
            },
          },
        },
      },
    });

    const emptyCount = () => ({ count: 0, cents: 0 });
    const statusCounts = {
      PAID: emptyCount(),
      PARTIAL: emptyCount(),
      PENDING: emptyCount(),
      OVERDUE: emptyCount(),
      WAIVED: emptyCount(),
    };
    let prescribed = 0;
    let paid = 0;
    let outstanding = 0;
    let overdue = 0;
    const byTeam = new Map<string, { teamName: string; prescribedCents: number; paidCents: number }>();
    const debtors = new Map<string, { memberId: string; name: string; owedCents: number }>();

    for (const o of obligations) {
      const rest = Math.max(0, o.amountCents - o.paidCents);
      const effective =
        (o.status === 'PENDING' || o.status === 'PARTIAL') && o.dueDate < now ? 'OVERDUE' : o.status;
      statusCounts[effective].count++;
      statusCounts[effective].cents += o.amountCents;
      if (o.status === 'WAIVED') continue;
      prescribed += o.amountCents;
      paid += o.paidCents;
      const b = bucket(o.dueDate);
      b.prescribedCents += o.amountCents;
      b.paidCents += o.paidCents;
      if (effective !== 'PAID') outstanding += rest;
      if (effective === 'OVERDUE') {
        overdue += rest;
        const d = debtors.get(o.memberId) ?? {
          memberId: o.memberId,
          name: `${o.member.firstName} ${o.member.lastName}`,
          owedCents: 0,
        };
        d.owedCents += rest;
        debtors.set(o.memberId, d);
      }
      const teamName = o.member.memberships[0]?.team.name ?? 'Bez družstva';
      const t = byTeam.get(teamName) ?? { teamName, prescribedCents: 0, paidCents: 0 };
      t.prescribedCents += o.amountCents;
      t.paidCents += o.paidCents;
      byTeam.set(teamName, t);
    }

    // ostatné príjmy: kladné pohyby (alebo ich nespárovaný zvyšok) mimo povinností
    const txs = await this.prisma.bankTransaction.findMany({
      where: { amountCents: { gt: 0 }, date: range },
      select: { date: true, amountCents: true, matches: { select: { amountCents: true } } },
    });
    let otherIncome = 0;
    for (const tx of txs) {
      const rest = Math.max(0, tx.amountCents - tx.matches.reduce((sum, mt) => sum + mt.amountCents, 0));
      otherIncome += rest;
      bucket(tx.date).otherIncomeCents += rest;
    }

    const paidExpenses = await this.prisma.expense.findMany({ where: { status: 'PAID', paidAt: range } });
    const plannedExpenses = await this.prisma.expense.findMany({
      where: {
        status: 'PLANNED',
        OR: [{ dueDate: range }, { dueDate: null, createdAt: range }],
      },
    });
    let expensesPaid = 0;
    const byPayee = new Map<string, number>();
    for (const e of paidExpenses) {
      expensesPaid += e.amountCents;
      bucket(e.paidAt!).expensesCents += e.amountCents;
      byPayee.set(e.payee, (byPayee.get(e.payee) ?? 0) + e.amountCents);
    }
    const expensesPlanned = plannedExpenses.reduce((sum, e) => sum + e.amountCents, 0);

    const series = buckets.map(({ key, ...rest }) => (m ? { day: key, ...rest } : { month: key, ...rest }));
    return {
      period: { year, month: m },
      totals: {
        prescribedCents: prescribed,
        paidCents: paid,
        outstandingCents: outstanding,
        overdueCents: overdue,
        otherIncomeCents: otherIncome,
        expensesPaidCents: expensesPaid,
        expensesPlannedCents: expensesPlanned,
        balanceCents: paid + otherIncome - expensesPaid,
      },
      byMonth: m ? [] : series,
      byDay: m ? series : [],
      statusCounts,
      byTeam: [...byTeam.values()].sort((a, b) => b.prescribedCents - a.prescribedCents),
      topDebtors: [...debtors.values()].sort((a, b) => b.owedCents - a.owedCents).slice(0, 5),
      expensesByPayee: [...byPayee.entries()]
        .map(([payee, cents]) => ({ payee, cents }))
        .sort((a, b) => b.cents - a.cents)
        .slice(0, 8),
    };
  }
}
