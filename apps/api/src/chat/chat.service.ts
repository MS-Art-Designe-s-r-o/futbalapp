import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { PushService } from '../notifications/push.service';
import { ChatGateway } from './chat.gateway';
import type { AuthUser } from '../auth/current-user.decorator';
import { isDemoScope, isStaff } from '../auth/scope';

/** Do týchto kanálov píše iba vedenie / tréner (moderátor); ostatní len čítajú. */
const READ_ONLY_FOR_MEMBERS = new Set(['TEAM_ANNOUNCEMENTS', 'CLUB_ANNOUNCEMENT']);

const MESSAGE_INCLUDE = {
  sender: { select: { id: true, firstName: true, lastName: true } },
  attachment: { select: { id: true, filename: true, mimeType: true, size: true } },
  replyTo: {
    select: {
      id: true,
      body: true,
      sender: { select: { id: true, firstName: true, lastName: true } },
      attachment: { select: { filename: true } },
    },
  },
} as const;
/** Interné kanály len pre daný okruh. */
const STAFF_ONLY = new Set(['COACHES', 'BOARD']);

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Smie používateľ spravovať hromadné e-maily daného družstva (admin/vedúci, tréner družstva)? */
function canUseTeamEmail(user: AuthUser, teamId: string | null) {
  if (isStaff(user)) return true;
  return user.roles.some((r) => r.role === 'COACH' && (!r.teamId || r.teamId === teamId));
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly email: EmailService,
    @Inject(forwardRef(() => ChatGateway)) private readonly chatGateway: ChatGateway,
  ) {}

  /** Družstvá relevantné pre používateľa: jeho vlastné (hráč) + jeho detí (rodič). */
  private async relevantTeamIds(userId: string): Promise<string[]> {
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) return [];
    const memberships = await this.prisma.teamMembership.findMany({
      where: {
        seasonId: season.id,
        leftAt: null,
        member: { OR: [{ userId }, { guardians: { some: { userId } } }] },
      },
      select: { teamId: true },
    });
    return [...new Set(memberships.map((m) => m.teamId))];
  }

  /** Podmienka: ktoré kanály smie používateľ vidieť (spoločné pre zoznam kanálov aj počítadlo neprečítaných). */
  private async visibleChannelWhere(user: AuthUser) {
    const staff = isStaff(user);
    const coach = user.roles.some((r) => r.role === 'COACH');
    // hráč/rodič: len kanály svojich družstiev (a detí); tréner: všetky
    const relevant = !staff && !coach ? await this.relevantTeamIds(user.id) : [];
    const demo = isDemoScope(user); // demo konto: len demo kanály; ostatní: bez demo
    const coachTeamIds = user.roles.filter((r) => r.role === 'COACH' && r.teamId).map((r) => r.teamId!);
    const coachAll = user.roles.some((r) => r.role === 'COACH' && !r.teamId);
    return staff
      ? { isDemo: demo }
      : {
          isDemo: demo,
          // „Hromadný email" vidí len tréner družstva a vedenie (nie hráči/rodičia)
          AND: coachAll ? [] : [{ NOT: { kind: 'TEAM_EMAIL' as const, teamId: { notIn: coachTeamIds } } }],
          OR: [
            { kind: 'CLUB_ANNOUNCEMENT' as const }, // celoklubové oznamy číta každý prihlásený
            { members: { some: { userId: user.id } } },
            // tréner vidí komunikáciu v každom družstve + interný kanál trénerov/vedenia
            ...(coach
              ? [{ teamId: { not: null } }, { kind: 'COACHES' as const }]
              : [{ teamId: { in: relevant } }]), // hráč/rodič: kanály svojich/detských družstiev
          ],
        };
  }

  /**
   * Súhrn neprečítaných správ pre ikonku pri „Komunikácia“ v menu/aplikácii: počet kanálov a správ
   * (správy od iných odosielateľov novšie než posledné prečítanie). Jeden dotaz na správy, nie N.
   */
  async unreadSummary(user: AuthUser): Promise<{ channels: number; messages: number }> {
    const channels = await this.prisma.channel.findMany({
      where: await this.visibleChannelWhere(user),
      select: { id: true },
    });
    if (channels.length === 0) return { channels: 0, messages: 0 };
    const reads = await this.prisma.channelRead.findMany({
      where: { userId: user.id, channelId: { in: channels.map((c) => c.id) } },
      select: { channelId: true, lastReadAt: true },
    });
    const lastRead = new Map(reads.map((r) => [r.channelId, r.lastReadAt]));
    const rows = await this.prisma.message.findMany({
      where: {
        senderId: { not: user.id },
        OR: channels.map((c) => ({ channelId: c.id, createdAt: { gt: lastRead.get(c.id) ?? new Date(0) } })),
      },
      select: { channelId: true },
      take: 500,
    });
    return { channels: new Set(rows.map((r) => r.channelId)).size, messages: rows.length };
  }

  /** Kanály, do ktorých má používateľ prístup, zoskupené podľa družstva. */
  async myChannels(user: AuthUser) {
    const channels = await this.prisma.channel.findMany({
      where: await this.visibleChannelWhere(user),
      include: {
        team: { include: { teamCategory: { select: { code: true, sortOrder: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, createdAt: true } },
      },
    });

    // stav prečítania pre zvýraznenie neprečítaných správ
    const reads = await this.prisma.channelRead.findMany({
      where: { userId: user.id, channelId: { in: channels.map((c) => c.id) } },
      select: { channelId: true, lastReadAt: true },
    });
    const lastReadByChannel = new Map(reads.map((r) => [r.channelId, r.lastReadAt]));
    // počet neprečítaných (od cudzieho odosielateľa) pre každý kanál
    const unreadByChannel = new Map<string, number>();
    await Promise.all(
      channels.map(async (channel) => {
        const lastReadAt = lastReadByChannel.get(channel.id) ?? new Date(0);
        const count = await this.prisma.message.count({
          where: { channelId: channel.id, senderId: { not: user.id }, createdAt: { gt: lastReadAt } },
        });
        unreadByChannel.set(channel.id, count);
      }),
    );

    return channels
      .map((channel) => ({
        id: channel.id,
        kind: channel.kind,
        name: channel.name,
        teamId: channel.teamId,
        teamName: channel.team?.name ?? null,
        categoryCode: channel.team?.teamCategory.code ?? null,
        categorySort: channel.team?.teamCategory.sortOrder ?? -1,
        lastMessage: channel.messages[0] ?? null,
        unreadCount: unreadByChannel.get(channel.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          a.categorySort - b.categorySort ||
          (a.teamName ?? '').localeCompare(b.teamName ?? '') ||
          a.name.localeCompare(b.name),
      );
  }

  private async assertAccess(channelId: string, user: AuthUser, forPosting: boolean) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { members: { where: { userId: user.id } } },
    });
    if (!channel) throw new NotFoundException('Kanál neexistuje');
    // demo izolácia: demo konto len demo kanály a naopak
    if (channel.isDemo !== isDemoScope(user)) throw new ForbiddenException('Nemáte prístup k tomuto kanálu');

    const membership = channel.members[0];
    const staff = isStaff(user);
    const coach = user.roles.some((r) => r.role === 'COACH');

    if (channel.kind === 'COACHES') {
      // interný kanál trénerov a vedenia
      if (!staff && !coach && !membership) throw new ForbiddenException('Nemáte prístup k tomuto kanálu');
      return channel;
    }
    if (channel.kind === 'TEAM_EMAIL') {
      if (!canUseTeamEmail(user, channel.teamId)) throw new ForbiddenException('Hromadný email môže používať len tréner družstva alebo vedenie');
      return channel;
    }
    if (STAFF_ONLY.has(channel.kind)) {
      if (!staff && !membership) throw new ForbiddenException('Nemáte prístup k tomuto kanálu');
      return channel;
    }

    if (channel.kind === 'CLUB_ANNOUNCEMENT') {
      if (forPosting && !staff) throw new ForbiddenException('Do oznamov klubu môže písať len vedenie');
      return channel; // čítať môže každý prihlásený
    }

    // tímové kanály: vedenie/tréner (vidí každé družstvo), člen kanála, alebo
    // hráč/rodič družstva (jeho alebo jeho dieťaťa)
    if (!staff && !coach && !membership) {
      const relevant = channel.teamId ? await this.relevantTeamIds(user.id) : [];
      if (!channel.teamId || !relevant.includes(channel.teamId)) {
        throw new ForbiddenException('Nie ste členom tohto kanála');
      }
    }

    if (forPosting && READ_ONLY_FOR_MEMBERS.has(channel.kind) && !staff && !coach && !membership?.isModerator) {
      throw new ForbiddenException('Do oznamov družstva môže písať len tréner alebo vedenie');
    }
    return channel;
  }

  async messages(channelId: string, user: AuthUser, before?: string) {
    await this.assertAccess(channelId, user, false);
    const messages = await this.prisma.message.findMany({
      where: { channelId, createdAt: before ? { lt: new Date(before) } : undefined },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    // otvorenie kanála (nie stránkovanie histórie) označí správy za prečítané
    if (!before) await this.markRead(channelId, user.id);
    return messages.reverse();
  }

  /** Označí kanál za prečítaný po prihlásenom používateľovi (lastReadAt = teraz). */
  async markRead(channelId: string, userId: string) {
    await this.prisma.channelRead.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: { channelId, userId, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
    return { ok: true };
  }

  /** Overí, že správa, na ktorú sa odpovedá, patrí do rovnakého kanála. */
  private async validReplyTo(channelId: string, replyToId?: string | null) {
    if (!replyToId) return null;
    const target = await this.prisma.message.findFirst({ where: { id: replyToId, channelId }, select: { id: true } });
    if (!target) throw new NotFoundException('Správa, na ktorú odpovedáte, neexistuje');
    return target.id;
  }

  async post(channelId: string, user: AuthUser, body: string, replyToId?: string) {
    const channel = await this.assertAccess(channelId, user, true);
    const replyTo = await this.validReplyTo(channelId, replyToId);
    const message = await this.prisma.message.create({
      data: { channelId, senderId: user.id, body, replyToId: replyTo },
      include: MESSAGE_INCLUDE,
    });

    this.chatGateway.broadcastMessage(channelId, message);
    if (channel.kind === 'TEAM_EMAIL') {
      const emailed = await this.sendTeamEmail(channel, user, message.sender, body);
      return { ...message, emailedTo: emailed };
    }
    await this.notifyMembers(channel, user.id, `${message.sender.firstName} ${message.sender.lastName}: ${body.slice(0, 120)}`);
    return message;
  }

  /** Rozošle text správy e-mailom hráčom a rodičom družstva (aktuálna sezóna). Vráti počet adries. */
  private async sendTeamEmail(
    channel: { teamId: string | null; name: string },
    user: AuthUser,
    sender: { firstName: string; lastName: string },
    body: string,
  ) {
    if (!channel.teamId) return 0;
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) return 0;
    const team = await this.prisma.team.findUnique({ where: { id: channel.teamId }, select: { name: true } });
    const memberships = await this.prisma.teamMembership.findMany({
      where: { seasonId: season.id, teamId: channel.teamId, leftAt: null },
      select: {
        member: {
          select: {
            user: { select: { email: true } },
            guardians: { select: { user: { select: { email: true } } } },
          },
        },
      },
    });
    const emails = new Set<string>();
    for (const { member } of memberships) {
      if (member.user?.email) emails.add(member.user.email.trim().toLowerCase());
      for (const g of member.guardians) if (g.user.email) emails.add(g.user.email.trim().toLowerCase());
    }
    emails.delete(user.email.trim().toLowerCase()); // odosielateľ dostane len kópiu nižšie
    const teamName = team?.name ?? channel.name;
    const senderName = `${sender.firstName} ${sender.lastName}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#16223c">
        <h2 style="color:#1a2848">${escapeHtml(teamName)} — správa od trénera</h2>
        <div style="margin:12px 0;font-size:15px;line-height:1.5">${escapeHtml(body).replace(/\n/g, '<br>')}</div>
        <p style="color:#6b7280;font-size:13px">Odosielateľ: ${escapeHtml(senderName)}. Na tento e-mail môžete odpovedať priamo odosielateľovi.</p>
      </div>`;
    const subject = `${teamName} — správa od ${senderName}`;
    // každému zvlášť, aby si príjemcovia navzájom nevideli adresy
    for (const to of [...emails, user.email]) {
      await this.email.send([to], subject, html, user.email);
    }
    return emails.size;
  }

  private async notifyMembers(channel: { id: string; name: string }, senderId: string, body: string) {
    const members = await this.prisma.channelMember.findMany({
      where: { channelId: channel.id, userId: { not: senderId }, muted: false },
      select: { userId: true },
    });
    await this.pushService.notifyUsers(
      members.map((m) => m.userId),
      { title: channel.name, body, data: { type: 'chat', channelId: channel.id } },
    );
  }

  /** Odošle správu s prílohou (obrázok/dokument). Voliteľný text ako popis. */
  async postAttachment(
    channelId: string,
    user: AuthUser,
    body: string,
    replyToId: string | undefined,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    const channel = await this.assertAccess(channelId, user, true);
    if (channel.kind === 'TEAM_EMAIL') throw new BadRequestException('Do hromadného emailu nie je možné vkladať prílohy');
    const replyTo = await this.validReplyTo(channelId, replyToId);
    const message = await this.prisma.message.create({
      data: { channelId, senderId: user.id, body: body?.trim() ?? '', replyToId: replyTo },
    });
    await this.prisma.chatAttachment.create({
      data: {
        messageId: message.id,
        filename: file.originalname || 'príloha',
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
        data: file.buffer,
      },
    });
    const full = await this.prisma.message.findUniqueOrThrow({ where: { id: message.id }, include: MESSAGE_INCLUDE });

    this.chatGateway.broadcastMessage(channelId, full);
    await this.notifyMembers(channel, user.id, `${full.sender.firstName} ${full.sender.lastName}: 📎 ${full.attachment?.filename ?? 'príloha'}`);
    return full;
  }

  /** Vymaže správu — iba jej autor. */
  async deleteMessage(messageId: string, user: AuthUser) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Správa neexistuje');
    if (message.senderId !== user.id) throw new ForbiddenException('Vymazať môžete iba vlastnú správu');
    await this.prisma.message.delete({ where: { id: messageId } });
    this.chatGateway.broadcastDeleted(message.channelId, messageId);
    return { ok: true };
  }

  /** Bajty prílohy na servírovanie (obrázok inline / dokument na stiahnutie). */
  getAttachment(id: string) {
    return this.prisma.chatAttachment.findUnique({ where: { id } });
  }

  /**
   * Prepočíta členstvo v tímových kanáloch podľa aktuálnej sezóny:
   * rodičia hráčov družstva + hráči s vlastným účtom + tréneri družstva
   * (ako moderátori). Volá sa po zmene súpisiek alebo prechode na novú sezónu.
   */
  async syncCategoryChannels() {
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) return { synced: 0 };

    // Doplň chýbajúce podkanály pre všetky družstvá (napr. nové družstvo pridané
    // v Nastaveniach, ktorému kanály ešte nevznikli).
    const teams = await this.prisma.team.findMany();
    const subKinds: Array<{ kind: 'TEAM_ANNOUNCEMENTS' | 'TEAM_TRAINING' | 'TEAM_GENERAL' | 'TEAM_EMAIL'; suffix: string }> = [
      { kind: 'TEAM_ANNOUNCEMENTS', suffix: ' · Oznamy' },
      { kind: 'TEAM_TRAINING', suffix: ' · Tréningy' },
      { kind: 'TEAM_GENERAL', suffix: ' · Všeobecné' },
      { kind: 'TEAM_EMAIL', suffix: ' · Hromadný email' },
    ];
    for (const team of teams) {
      for (const sc of subKinds) {
        const exists = await this.prisma.channel.findFirst({ where: { teamId: team.id, kind: sc.kind } });
        if (!exists) {
          await this.prisma.channel.create({
            data: { kind: sc.kind, teamId: team.id, name: `${team.name}${sc.suffix}`, isDemo: team.isDemo },
          });
        }
      }
    }

    // „Hromadný email" nemá členov — prístup určuje rola (tréner družstva / admin)
    const channels = await this.prisma.channel.findMany({
      where: { teamId: { not: null }, kind: { not: 'TEAM_EMAIL' } },
    });

    let synced = 0;
    for (const channel of channels) {
      const memberships = await this.prisma.teamMembership.findMany({
        where: { seasonId: season.id, teamId: channel.teamId!, leftAt: null },
        include: { member: { include: { guardians: true } } },
      });

      const userIds = new Map<string, boolean>(); // userId -> isModerator
      for (const m of memberships) {
        if (m.member.userId) userIds.set(m.member.userId, false);
        for (const guardian of m.member.guardians) userIds.set(guardian.userId, false);
      }
      const coaches = await this.prisma.userRole.findMany({
        where: { role: 'COACH', teamId: channel.teamId },
      });
      for (const coach of coaches) userIds.set(coach.userId, true);

      for (const [userId, isModerator] of userIds) {
        await this.prisma.channelMember.upsert({
          where: { channelId_userId: { channelId: channel.id, userId } },
          create: { channelId: channel.id, userId, isModerator },
          update: { isModerator },
        });
        synced++;
      }
    }

    // Interný kanál pre trénerov a vedenie (všetci tréneri + vedúci + admini)
    let coachesChannel = await this.prisma.channel.findFirst({ where: { kind: 'COACHES' } });
    if (!coachesChannel) {
      coachesChannel = await this.prisma.channel.create({ data: { kind: 'COACHES', name: 'Tréneri a vedenie' } });
    }
    const staffRoles = await this.prisma.userRole.findMany({
      where: { role: { in: ['COACH', 'MANAGER', 'ADMIN'] } },
      select: { userId: true },
    });
    for (const userId of new Set(staffRoles.map((r) => r.userId))) {
      await this.prisma.channelMember.upsert({
        where: { channelId_userId: { channelId: coachesChannel.id, userId } },
        create: { channelId: coachesChannel.id, userId, isModerator: true },
        update: { isModerator: true },
      });
      synced++;
    }

    return { channels: channels.length, synced };
  }
}
