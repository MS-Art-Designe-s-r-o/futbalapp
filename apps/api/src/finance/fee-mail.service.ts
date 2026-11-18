import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { buildFeeEmail, humanPeriodLabel } from './fee-email';

export interface FeeSendPreviewRow {
  obligationId: string;
  memberId: string;
  name: string;
  emails: string[];
  amountCents: number;
  paidCents: number;
  variableSymbol: string;
  dueDate: Date;
  periodLabel: string;
  emailedAt: Date | null;
}

const memberSelect = {
  firstName: true,
  lastName: true,
  user: { select: { email: true } },
  guardians: { select: { user: { select: { email: true } } } },
} as const;

type MemberInfo = {
  firstName: string;
  lastName: string;
  user: { email: string | null } | null;
  guardians: Array<{ user: { email: string | null } }>;
};

function collectEmails(m: MemberInfo): string[] {
  const set = new Set<string>();
  for (const e of [...m.guardians.map((g) => g.user.email), m.user?.email]) {
    const v = e?.trim().toLowerCase();
    if (v) set.add(v);
  }
  return [...set];
}

@Injectable()
export class FeeMailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  private account() {
    const iban = process.env.CLUB_IBAN?.replace(/\s+/g, '').trim() || undefined;
    const accountName = process.env.CLUB_ACCOUNT_NAME?.trim() || undefined;
    return { iban, accountName };
  }

  private async getPlan(id: string) {
    const plan = await this.prisma.feePlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Predpis neexistuje');
    return plan;
  }

  async preview(planId: string, period?: string) {
    const plan = await this.getPlan(planId);
    const open = { feeAssignment: { feePlanId: planId }, status: { notIn: ['PAID', 'WAIVED'] as ('PAID' | 'WAIVED')[] } };
    const labels = await this.prisma.paymentObligation.findMany({
      where: open,
      select: { periodLabel: true },
      distinct: ['periodLabel'],
      orderBy: { periodLabel: 'desc' },
    });
    const availablePeriods = labels.map((l) => l.periodLabel);
    const selected = period?.trim() || (plan.period === 'MONTHLY' ? (availablePeriods[0] ?? null) : null);
    const obligations = await this.prisma.paymentObligation.findMany({
      where: { ...open, ...(selected ? { periodLabel: selected } : {}) },
      include: { member: { select: memberSelect } },
    });
    const rows: FeeSendPreviewRow[] = obligations
      .map((o) => ({
        obligationId: o.id,
        memberId: o.memberId,
        name: `${o.member.lastName} ${o.member.firstName}`,
        emails: collectEmails(o.member),
        amountCents: o.amountCents,
        paidCents: o.paidCents,
        variableSymbol: o.variableSymbol,
        dueDate: o.dueDate,
        periodLabel: o.periodLabel,
        emailedAt: o.emailedAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'sk'));
    const { iban, accountName } = this.account();
    let sampleHtml: string | null = null;
    if (rows[0]) {
      const r = rows[0];
      const first = obligations.find((o) => o.id === r.obligationId)!;
      sampleHtml = buildFeeEmail({
        memberName: `${first.member.firstName} ${first.member.lastName}`,
        planName: plan.name,
        items: [{ periodLabel: r.periodLabel, amountCents: r.amountCents - r.paidCents > 0 ? r.amountCents - r.paidCents : r.amountCents, dueDate: r.dueDate, variableSymbol: r.variableSymbol }],
        iban,
        accountName,
      }).html;
    }
    return {
      plan: { id: plan.id, name: plan.name, period: plan.period },
      periodLabel: selected ? humanPeriodLabel(selected) : null,
      accountConfigured: !!iban,
      rows,
      sampleHtml,
      availablePeriods,
    };
  }

  async send(planId: string, obligationIds: string[]) {
    const plan = await this.getPlan(planId);
    const ids = [...new Set(obligationIds)];
    const obligations = await this.prisma.paymentObligation.findMany({
      where: { id: { in: ids } },
      include: { feeAssignment: { select: { feePlanId: true } }, member: { select: memberSelect } },
    });
    if (obligations.length !== ids.length || obligations.some((o) => o.feeAssignment.feePlanId !== planId)) {
      throw new BadRequestException('Niektoré povinnosti nepatria k tomuto predpisu.');
    }
    const sendable = obligations.filter((o) => o.status !== 'PAID' && o.status !== 'WAIVED');
    const byMember = new Map<string, typeof sendable>();
    for (const o of sendable) byMember.set(o.memberId, [...(byMember.get(o.memberId) ?? []), o]);

    const { iban, accountName } = this.account();
    let membersNotified = 0;
    let emailsSent = 0;
    let emailError: string | null = null;
    const skippedNoEmail: string[] = [];

    for (const list of byMember.values()) {
      const m = list[0]!.member;
      const name = `${m.firstName} ${m.lastName}`;
      const emails = collectEmails(m);
      if (emails.length === 0) {
        skippedNoEmail.push(name);
        continue;
      }
      list.sort((a, b) => a.periodLabel.localeCompare(b.periodLabel));
      const { subject, html } = buildFeeEmail({
        memberName: name,
        planName: plan.name,
        items: list.map((o) => ({
          periodLabel: o.periodLabel,
          amountCents: Math.max(o.amountCents - o.paidCents, 0) || o.amountCents,
          dueDate: o.dueDate,
          variableSymbol: o.variableSymbol,
        })),
        iban,
        accountName,
      });
      const res = await this.emailService.send(emails, subject, html, 'info@fkknv.sk');
      if (res.sent) {
        membersNotified += 1;
        emailsSent += emails.length;
        await this.prisma.paymentObligation.updateMany({
          where: { id: { in: list.map((o) => o.id) } },
          data: { emailedAt: new Date() },
        });
      } else {
        emailError = res.reason ?? 'Neznáma chyba';
      }
    }
    return { membersNotified, emailsSent, skippedNoEmail, emailError };
  }
}
