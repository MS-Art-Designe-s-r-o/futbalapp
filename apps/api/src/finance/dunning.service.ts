import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../notifications/push.service';
import { EmailService } from '../notifications/email.service';

/**
 * Upomienky pri nezaplatenom členskom — LEN RUČNE (žiadne automatické odosielanie).
 * Vedenie si pozrie náhľad (preview) a vyberie členov, ktorým sa upomienka pošle (send).
 * Úroveň eskalácie: 1 = deň po splatnosti, 2 = po týždni, 3 = po dvoch týždňoch.
 */
const LEVEL_THRESHOLDS_DAYS: Array<{ level: number; days: number }> = [
  { level: 3, days: 15 },
  { level: 2, days: 8 },
  { level: 1, days: 1 },
];

export interface DunningPreviewRow {
  memberId: string;
  name: string;
  emails: string[];
  hasPushRecipients: boolean;
  totalCents: number;
  periods: string[];
  obligationIds: string[];
  level: number;
  lastLevel: number;
}

@Injectable()
export class DunningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly emailService: EmailService,
  ) {}

  private async collect(): Promise<Array<DunningPreviewRow & { recipients: string[] }>> {
    const now = new Date();
    await this.prisma.paymentObligation.updateMany({
      where: { status: { in: ['PENDING', 'PARTIAL'] }, dueDate: { lt: now } },
      data: { status: 'OVERDUE' },
    });
    const overdue = await this.prisma.paymentObligation.findMany({
      where: { status: 'OVERDUE' },
      orderBy: { dueDate: 'asc' },
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

    const perMember = new Map<string, DunningPreviewRow & { recipients: string[] }>();
    for (const o of overdue) {
      const daysOverdue = Math.floor((now.getTime() - o.dueDate.getTime()) / 86_400_000);
      const targetLevel = LEVEL_THRESHOLDS_DAYS.find((t) => daysOverdue >= t.days)?.level ?? 0;
      const entry = perMember.get(o.memberId) ?? {
        memberId: o.memberId,
        recipients: [...o.member.guardians.map((g) => g.userId), ...(o.member.userId ? [o.member.userId] : [])],
        emails: o.member.guardians.map((g) => g.user.email).filter((e): e is string => !!e),
        hasPushRecipients: false,
        name: `${o.member.firstName} ${o.member.lastName}`,
        totalCents: 0,
        periods: [],
        obligationIds: [],
        level: 0,
        lastLevel: 0,
      };
      entry.totalCents += o.amountCents - o.paidCents;
      entry.periods.push(o.periodLabel);
      entry.obligationIds.push(o.id);
      entry.level = Math.max(entry.level, targetLevel);
      entry.lastLevel = Math.max(entry.lastLevel, o.dunning[0]?.level ?? 0);
      entry.hasPushRecipients = entry.recipients.length > 0;
      perMember.set(o.memberId, entry);
    }
    return [...perMember.values()];
  }

  /** Náhľad: všetci členovia s povinnosťami po splatnosti (nič sa neposiela). */
  async preview(): Promise<DunningPreviewRow[]> {
    const rows = await this.collect();
    return rows
      .map(({ recipients: _r, ...row }) => row)
      .sort((a, b) => b.totalCents - a.totalCents);
  }

  /** Ručné odoslanie upomienky (push + e-mail) LEN vybraným členom. */
  async send(memberIds: string[]) {
    const wanted = new Set(memberIds);
    const rows = (await this.collect()).filter((r) => wanted.has(r.memberId));
    let notified = 0;
    let emailsSent = 0;
    let emailError: string | null = null;
    for (const entry of rows) {
      const level = Math.max(entry.level, 1);
      const amount = (entry.totalCents / 100).toFixed(2);
      const urgency = level >= 3 ? 'Posledná upomienka' : level === 2 ? 'Pripomienka' : 'Upozornenie';
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
      if (email.sent) emailsSent += entry.emails.length;
      else if (entry.emails.length > 0) emailError = email.reason ?? 'Neznáma chyba';
      await this.prisma.dunningNotice.createMany({
        data: entry.obligationIds.flatMap((paymentObligationId) => [
          { paymentObligationId, level, channel: 'PUSH' },
          ...(email.sent ? [{ paymentObligationId, level, channel: 'EMAIL' }] : []),
        ]),
      });
      notified++;
    }
    return { membersNotified: notified, emailsSent, emailError };
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
    return {
      members: r.members.length,
      recipients: r.userIds.length,
      emailsSent: email.sent ? r.emails.length : 0,
      emailError: email.sent ? null : (email.reason ?? 'Neznáma chyba'),
    };
  }
}
