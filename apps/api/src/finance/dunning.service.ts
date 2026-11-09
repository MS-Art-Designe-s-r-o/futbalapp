import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../notifications/push.service';
import { EmailService } from '../notifications/email.service';

/**
 * Automatické upomienky pri nezaplatenom členskom.
 * Eskalácia: 1. upomienka deň po splatnosti, 2. po týždni, 3. po dvoch týždňoch.
 * Každá úroveň sa pre danú povinnosť pošle len raz (eviduje DunningNotice).
 */
const LEVEL_THRESHOLDS_DAYS: Array<{ level: number; days: number }> = [
  { level: 3, days: 15 },
  { level: 2, days: 8 },
  { level: 1, days: 1 },
];

@Injectable()
export class DunningService {
  private readonly logger = new Logger(DunningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly emailService: EmailService,
  ) {}

  /** Denne o 8:00 — upomienky sa neposielajú v noci. */
  @Cron('0 8 * * *')
  async daily() {
    const result = await this.run();
    this.logger.log(`Upomienky: ${JSON.stringify(result)}`);
  }

  async run() {
    const now = new Date();

    // 1. preklop povinnosti po splatnosti na OVERDUE
    await this.prisma.paymentObligation.updateMany({
      where: { status: { in: ['PENDING', 'PARTIAL'] }, dueDate: { lt: now } },
      data: { status: 'OVERDUE' },
    });

    // 2. zisti, ktoré povinnosti potrebujú (vyššiu) upomienku
    const overdue = await this.prisma.paymentObligation.findMany({
      where: { status: 'OVERDUE' },
      include: {
        dunning: { orderBy: { level: 'desc' }, take: 1 },
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            userId: true,
            guardians: { select: { userId: true, user: { select: { email: true } } } },
          },
        },
      },
    });

    // zoskupenie podľa člena — rodič dostane jednu správu za dieťa, nie za každý mesiac
    const perMember = new Map<
      string,
      {
        recipients: string[];
        emails: string[];
        name: string;
        totalCents: number;
        periods: string[];
        obligationIds: string[];
        level: number;
      }
    >();

    for (const obligation of overdue) {
      const daysOverdue = Math.floor((now.getTime() - obligation.dueDate.getTime()) / 86_400_000);
      const targetLevel = LEVEL_THRESHOLDS_DAYS.find((t) => daysOverdue >= t.days)?.level ?? 0;
      const sentLevel = obligation.dunning[0]?.level ?? 0;
      if (targetLevel <= sentLevel) continue;

      const entry = perMember.get(obligation.memberId) ?? {
        recipients: [
          ...obligation.member.guardians.map((g) => g.userId),
          ...(obligation.member.userId ? [obligation.member.userId] : []),
        ],
        emails: obligation.member.guardians.map((g) => g.user.email),
        name: `${obligation.member.firstName} ${obligation.member.lastName}`,
        totalCents: 0,
        periods: [],
        obligationIds: [],
        level: 0,
      };
      entry.totalCents += obligation.amountCents - obligation.paidCents;
      entry.periods.push(obligation.periodLabel);
      entry.obligationIds.push(obligation.id);
      entry.level = Math.max(entry.level, targetLevel);
      perMember.set(obligation.memberId, entry);
    }

    // 3. pošli a zaeviduj
    let notified = 0;
    for (const entry of perMember.values()) {
      const amount = (entry.totalCents / 100).toFixed(2);
      const urgency = entry.level >= 3 ? 'Posledná upomienka' : entry.level === 2 ? 'Pripomienka' : 'Upozornenie';
      await this.pushService.notifyUsers(entry.recipients, {
        title: `${urgency}: nezaplatené členské`,
        body: `${entry.name} — dlžné ${amount} € za obdobie ${entry.periods.join(', ')}. Prosíme o úhradu.`,
        data: { type: 'dunning' },
      });
      const email = await this.emailService.send(
        entry.emails,
        `${urgency}: nezaplatené členské — ${entry.name}`,
        `<p>Dobrý deň,</p>
         <p>evidujeme nezaplatené členské za hráča <strong>${entry.name}</strong>:
         dlžná suma <strong>${amount} €</strong> za obdobie ${entry.periods.join(', ')}.</p>
         <p>Prosíme o úhradu — platobné údaje s QR kódom nájdete v portáli
         <a href="https://fkknv.sk">fkknv.sk</a> v sekcii Platby.</p>
         <p>Ak ste medzičasom uhradili, správu považujte za bezpredmetnú.</p>
         <p>FK Košická Nová Ves</p>`,
      );
      await this.prisma.dunningNotice.createMany({
        data: entry.obligationIds.flatMap((paymentObligationId) => [
          { paymentObligationId, level: entry.level, channel: 'PUSH' },
          ...(email.sent ? [{ paymentObligationId, level: entry.level, channel: 'EMAIL' }] : []),
        ]),
      });
      notified++;
    }

    return { overdueObligations: overdue.length, membersNotified: notified };
  }

  /** Príjemcovia ospravedlnenia: rodičia (a členovia s účtom), ktorým kedykoľvek odišla upomienka. */
  async apologyRecipients() {
    const members = await this.prisma.member.findMany({
      where: { paymentObligations: { some: { dunning: { some: {} } } } },
      select: {
        firstName: true,
        lastName: true,
        userId: true,
        guardians: { select: { userId: true, user: { select: { email: true } } } },
      },
    });
    const userIds = new Set<string>();
    const emails = new Set<string>();
    for (const m of members) {
      if (m.userId) userIds.add(m.userId);
      for (const g of m.guardians) {
        userIds.add(g.userId);
        if (g.user.email) emails.add(g.user.email);
      }
    }
    return {
      members: members.map((m) => `${m.lastName} ${m.firstName}`).sort((a, b) => a.localeCompare(b, 'sk')),
      userIds: [...userIds],
      emails: [...emails],
    };
  }

  /** Jednorazové ospravedlnenie: upomienky boli len testovacie. Posiela push + e-mail. */
  async sendApology() {
    const r = await this.apologyRecipients();
    await this.pushService.notifyUsers(r.userIds, {
      title: 'Oznam: testovacia správa',
      body: 'Predchádzajúca správa o platbe bola len testovacia a nemá nič spoločné s úhradami. Ďakujeme za pochopenie.',
      data: { type: 'info' },
    });
    const email = await this.emailService.send(
      r.emails,
      'Oznam: predchádzajúca správa o platbe bola testovacia',
      `<p>Dobrý deň,</p>
       <p>správa o platbe členského, ktorú ste dostali, bola <strong>len testovacia</strong>
       a nemá nič spoločné s úhradami. Prosíme, nezohľadňujte ju.</p>
       <p>Ďakujeme za pochopenie.</p>
       <p>FK Košická Nová Ves</p>`,
    );
    return { members: r.members.length, recipients: r.userIds.length, emailsSent: email.sent ? r.emails.length : 0 };
  }
}
