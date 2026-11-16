import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { PushService } from '../notifications/push.service';
import { GoalkeepersService } from '../goalkeepers/goalkeepers.service';
import { coachTeamIds, isStaff } from '../auth/scope';
import type { AuthUser } from '../auth/current-user.decorator';

type TransferMode = 'MOVE' | 'ADD';

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly push: PushService,
    private readonly goalkeepers: GoalkeepersService,
  ) {}

  private async activeSeason() {
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) throw new BadRequestException('Neexistuje aktívna sezóna');
    return season;
  }

  private async currentTeamIds(memberId: string, seasonId: string): Promise<string[]> {
    const rows = await this.prisma.teamMembership.findMany({
      where: { memberId, seasonId, leftAt: null },
      select: { teamId: true },
    });
    return rows.map((r) => r.teamId);
  }

  /** Vykoná presun: MOVE odstráni ostatné družstvá v sezóne, ADD len pridá cieľové. */
  private async applyTransfer(memberId: string, toTeamId: string, mode: TransferMode, seasonId: string) {
    if (mode === 'MOVE') {
      await this.prisma.teamMembership.deleteMany({ where: { memberId, seasonId, teamId: { not: toTeamId }, team: { isGoalkeeperGroup: false } } });
    }
    await this.prisma.teamMembership.upsert({
      where: { memberId_seasonId_teamId: { memberId, seasonId, teamId: toTeamId } },
      create: { memberId, seasonId, teamId: toTeamId, isException: true },
      update: { leftAt: null, isException: true },
    });
    await this.goalkeepers.sync().catch(() => undefined);
  }

  /** Vyhľadá hráčov v klube (na požiadanie o presun). */
  async searchPlayers(q: string, _user: AuthUser) {
    const season = await this.activeSeason();
    const term = (q ?? '').trim();
    const nameFilter = term
      ? {
          OR: [
            { firstName: { contains: term, mode: 'insensitive' as const } },
            { lastName: { contains: term, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const members = await this.prisma.member.findMany({
      where: {
        status: 'ACTIVE',
        AND: [
          {
            OR: [
              { memberships: { some: { seasonId: season.id, leftAt: null } } },
              { user: { roles: { some: { role: 'PLAYER' as never } } } },
            ],
          },
          // nie vedenie/tréner/rodič
          { NOT: { user: { roles: { some: { role: { in: ['ADMIN', 'MANAGER', 'COACH', 'PARENT'] as never } } } } } },
          nameFilter,
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        memberships: {
          where: { seasonId: season.id, leftAt: null },
          select: { team: { select: { id: true, name: true } } },
        },
      },
      take: 40,
    });
    members.sort((a, b) => a.lastName.localeCompare(b.lastName, 'sk') || a.firstName.localeCompare(b.firstName, 'sk'));
    return members.map((m) => ({
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      position: m.position,
      teams: m.memberships.map((ms) => ms.team),
    }));
  }

  /**
   * Cieľový tréner požiada o presun hráča do svojho družstva. Ak hráč nie je v
   * žiadnom družstve, presunie sa priamo. Inak vznikne žiadosť, ktorú schváli
   * tréner pôvodného družstva (alebo vedenie) — ten zvolí, či hráč ostane aj v
   * pôvodnom družstve, alebo nie.
   */
  async request(memberId: string, toTeamId: string, user: AuthUser) {
    const season = await this.activeSeason();
    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Hráč neexistuje');
    const toTeam = await this.prisma.team.findUnique({ where: { id: toTeamId } });
    if (!toTeam) throw new NotFoundException('Cieľové družstvo neexistuje');
    if (toTeam.isGoalkeeperGroup) throw new BadRequestException('Skupina Brankári sa plní automaticky, hráča do nej nemožno presunúť');

    if (!isStaff(user) && !coachTeamIds(user).includes(toTeamId)) {
      throw new ForbiddenException('Presun môžete žiadať len do vlastného družstva');
    }

    const current = await this.currentTeamIds(memberId, season.id);
    if (current.includes(toTeamId)) throw new BadRequestException('Hráč už je v tomto družstve');

    // hráč bez zaradenia → niet od koho pýtať súhlas, priraď priamo
    if (current.length === 0) {
      await this.applyTransfer(memberId, toTeamId, 'ADD', season.id);
      return { applied: true, pending: false };
    }

    const existing = await this.prisma.teamTransferRequest.findFirst({
      where: { memberId, toTeamId, status: 'PENDING' },
    });
    if (existing) return { applied: false, pending: true, requestId: existing.id };

    const req = await this.prisma.teamTransferRequest.create({
      data: { memberId, toTeamId, fromTeamId: current[0] ?? null, requestedById: user.id },
    });
    this.notifyCurrentCoaches(memberId, current, toTeam.name, user.id).catch((e) =>
      this.logger.warn(`Notifikácia presunu zlyhala: ${e instanceof Error ? e.message : e}`),
    );
    return { applied: false, pending: true, requestId: req.id };
  }

  /** Upozorní trénerov pôvodného družstva (e-mail + push) na žiadosť o presun. */
  private async notifyCurrentCoaches(memberId: string, currentTeamIds: string[], toTeamName: string, requesterId: string) {
    const coaches = await this.prisma.userRole.findMany({
      where: { role: 'COACH', teamId: { in: currentTeamIds } },
      select: { userId: true },
    });
    const userIds = [...new Set(coaches.map((c) => c.userId).filter((id) => id !== requesterId))];
    if (userIds.length === 0) return;

    const [member, requester, users] = await Promise.all([
      this.prisma.member.findUnique({ where: { id: memberId }, select: { firstName: true, lastName: true } }),
      this.prisma.user.findUnique({ where: { id: requesterId }, select: { firstName: true, lastName: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { email: true } }),
    ]);
    const playerName = member ? `${member.firstName} ${member.lastName}` : 'hráč';
    const requesterName = requester ? `${requester.firstName} ${requester.lastName}` : 'tréner';
    const emails = [...new Set(users.map((u) => u.email).filter((e): e is string => !!e))];

    void this.push.notifyUsers(userIds, {
      title: 'Žiadosť o presun hráča',
      body: `${playerName} → ${toTeamName} (žiada ${requesterName})`,
      data: { type: 'transfer' },
    });
    if (emails.length > 0) {
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#16223c">
          <h2 style="color:#1a2848">Žiadosť o presun hráča</h2>
          <p><strong>${playerName}</strong> — žiadosť o presun do družstva <strong>${toTeamName}</strong>.</p>
          <p style="color:#6b7280">Žiada: ${requesterName}</p>
          <p>Žiadosť schválite (a zvolíte, či hráč ostane aj vo vašom družstve) alebo zamietnete v portáli:</p>
          <p><a href="https://fkknv.sk/portal/presuny" style="color:#2b4278">Otvoriť presuny →</a></p>
        </div>`;
      await this.email.send(emails, `Žiadosť o presun: ${playerName}`, html);
    }
  }

  /** Žiadosti relevantné pre používateľa: na schválenie (canApprove) aj vlastné odoslané (mine). */
  async pending(user: AuthUser) {
    const season = await this.activeSeason();
    const staff = isStaff(user);
    const myTeams = coachTeamIds(user);

    const requests = await this.prisma.teamTransferRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });

    const visible: Array<{ req: (typeof requests)[number]; canApprove: boolean; mine: boolean }> = [];
    for (const req of requests) {
      const current = await this.currentTeamIds(req.memberId, season.id);
      const approver = staff || current.some((t) => myTeams.includes(t));
      const mine = req.requestedById === user.id;
      if (approver || mine) visible.push({ req, canApprove: approver, mine });
    }

    const memberIds = [...new Set(visible.map((v) => v.req.memberId))];
    const teamIds = [
      ...new Set(visible.flatMap((v) => [v.req.toTeamId, v.req.fromTeamId].filter((x): x is string => !!x))),
    ];
    const [members, teams, requesters] = await Promise.all([
      this.prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(visible.map((v) => v.req.requestedById))] } },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    const mMap = new Map(members.map((m) => [m.id, m]));
    const tMap = new Map(teams.map((t) => [t.id, t.name]));
    const uMap = new Map(requesters.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

    return visible.map(({ req, canApprove, mine }) => {
      const m = mMap.get(req.memberId);
      return {
        id: req.id,
        memberName: m ? `${m.lastName} ${m.firstName}` : '—',
        fromTeamName: req.fromTeamId ? tMap.get(req.fromTeamId) ?? null : null,
        toTeamName: tMap.get(req.toTeamId) ?? '—',
        requestedBy: uMap.get(req.requestedById) ?? '—',
        createdAt: req.createdAt,
        canApprove,
        mine,
      };
    });
  }

  /** Schválenie so zvoleným módom (MOVE = vyradiť z pôvodného, ADD = ponechať v oboch). */
  async approve(id: string, mode: TransferMode, user: AuthUser) {
    const req = await this.prisma.teamTransferRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Žiadosť neexistuje');
    if (req.status !== 'PENDING') throw new BadRequestException('Žiadosť už bola spracovaná');
    const season = await this.activeSeason();
    const current = await this.currentTeamIds(req.memberId, season.id);
    if (!isStaff(user) && !current.some((t) => coachTeamIds(user).includes(t))) {
      throw new ForbiddenException('Túto žiadosť nemôžete schváliť');
    }
    await this.applyTransfer(req.memberId, req.toTeamId, mode, season.id);
    await this.prisma.teamTransferRequest.update({
      where: { id },
      data: { status: 'APPROVED', mode, resolvedById: user.id, resolvedAt: new Date() },
    });
    return { status: 'APPROVED' };
  }

  async reject(id: string, user: AuthUser) {
    const req = await this.prisma.teamTransferRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Žiadosť neexistuje');
    if (req.status !== 'PENDING') throw new BadRequestException('Žiadosť už bola spracovaná');
    const season = await this.activeSeason();
    const current = await this.currentTeamIds(req.memberId, season.id);
    if (!isStaff(user) && !current.some((t) => coachTeamIds(user).includes(t))) {
      throw new ForbiddenException('Túto žiadosť nemôžete zamietnuť');
    }
    await this.prisma.teamTransferRequest.update({
      where: { id },
      data: { status: 'REJECTED', resolvedById: user.id, resolvedAt: new Date() },
    });
    return { status: 'REJECTED' };
  }
}
