import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';

/** Názov spoločnej skupiny brankárov zo všetkých družstiev. */
export const ALL_GOALKEEPERS_NAME = 'Brankári (všetci)';

const SUBCHANNELS: Array<{ kind: 'TEAM_ANNOUNCEMENTS' | 'TEAM_TRAINING' | 'TEAM_GENERAL' | 'TEAM_EMAIL'; suffix: string }> = [
  { kind: 'TEAM_ANNOUNCEMENTS', suffix: ' · Oznamy' },
  { kind: 'TEAM_TRAINING', suffix: ' · Tréningy' },
  { kind: 'TEAM_GENERAL', suffix: ' · Všeobecné' },
  { kind: 'TEAM_EMAIL', suffix: ' · Hromadný email' },
];

/**
 * Automatické skupiny „Brankári“: ku každému družstvu s aspoň jedným brankárom
 * vznikne skupina „<družstvo> Brankári“ a spoločná „Brankári (všetci)“. Členmi sú
 * hráči so zaškrtnutým Brankár alebo postavením GK. Tréner brankárov (rola
 * GK_COACH) dostane trénerský scope na tieto skupiny, vďaka čomu vidí len ich.
 */
@Injectable()
export class GoalkeepersService implements OnApplicationBootstrap {
  private readonly log = new Logger(GoalkeepersService.name);
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {}

  onApplicationBootstrap() {
    void this.sync().catch((e) => this.log.warn(`Úvodná synchronizácia skupín brankárov zlyhala: ${e instanceof Error ? e.message : e}`));
  }

  /** Poistka: raz denne v noci. */
  @Cron('30 3 * * *')
  nightly() {
    void this.sync().catch((e) => this.log.warn(`Nočná synchronizácia skupín brankárov zlyhala: ${e instanceof Error ? e.message : e}`));
  }

  /** Spustenia sa radia za sebou, aby sa nebili. */
  sync(): Promise<{ changed: boolean }> {
    const next = this.chain.then(() => this.run());
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async run(): Promise<{ changed: boolean }> {
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) return { changed: false };
    let changed = false;

    const baseTeams = await this.prisma.team.findMany({
      where: { isGoalkeeperGroup: false, isDemo: false },
      orderBy: [{ teamCategory: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    });
    const gkRows = await this.prisma.teamMembership.findMany({
      where: {
        seasonId: season.id,
        leftAt: null,
        teamId: { in: baseTeams.map((t) => t.id) },
        member: { status: { not: 'INACTIVE' }, isDemo: false, OR: [{ isGoalkeeper: true }, { position: 'GK' }, { position2: 'GK' }] },
      },
      select: { teamId: true, memberId: true },
    });
    const byTeam = new Map<string, Set<string>>();
    for (const r of gkRows) {
      const s = byTeam.get(r.teamId) ?? new Set<string>();
      s.add(r.memberId);
      byTeam.set(r.teamId, s);
    }

    const existing = await this.prisma.team.findMany({ where: { isGoalkeeperGroup: true, isDemo: false } });
    const key = (categoryId: string, name: string) => `${categoryId}|${name}`;
    const existingByKey = new Map(existing.map((t) => [key(t.teamCategoryId, t.name), t]));

    const ensureTeam = async (categoryId: string, name: string, sortOrder: number) => {
      const found = existingByKey.get(key(categoryId, name));
      if (found) return found;
      const team = await this.prisma.team.create({
        data: { teamCategoryId: categoryId, name, sortOrder, isGoalkeeperGroup: true },
      });
      for (const sc of SUBCHANNELS) {
        await this.prisma.channel.create({ data: { kind: sc.kind, teamId: team.id, name: `${team.name}${sc.suffix}`, isDemo: false } });
      }
      existingByKey.set(key(categoryId, name), team);
      changed = true;
      return team;
    };

    // požadované členstvá: skupina → množina členov
    const desired = new Map<string, Set<string>>();
    const union = new Set<string>();
    let firstCategoryId: string | null = null;
    for (const base of baseTeams) {
      const members = byTeam.get(base.id);
      if (!members?.size) continue;
      firstCategoryId ??= base.teamCategoryId;
      const gk = await ensureTeam(base.teamCategoryId, `${base.name} Brankári`, 1000 + base.sortOrder);
      desired.set(gk.id, new Set(members));
      members.forEach((m) => union.add(m));
    }
    const existingAll = existing.find((t) => t.name === ALL_GOALKEEPERS_NAME);
    if (union.size > 0) {
      const all = existingAll ?? (await ensureTeam(firstCategoryId!, ALL_GOALKEEPERS_NAME, 2000));
      desired.set(all.id, new Set(union));
    }

    // členstvá všetkých skupín brankárov (aj tých, ktoré sa vyprázdnili)
    const allGkTeams = [...existingByKey.values()];
    for (const team of allGkTeams) {
      const want = desired.get(team.id) ?? new Set<string>();
      const current = await this.prisma.teamMembership.findMany({
        where: { teamId: team.id, seasonId: season.id },
        select: { id: true, memberId: true, leftAt: true },
      });
      const have = new Map(current.map((c) => [c.memberId, c]));
      for (const memberId of want) {
        const c = have.get(memberId);
        if (!c) {
          await this.prisma.teamMembership.create({ data: { memberId, seasonId: season.id, teamId: team.id } });
          changed = true;
        } else if (c.leftAt) {
          await this.prisma.teamMembership.update({ where: { id: c.id }, data: { leftAt: null } });
          changed = true;
        }
      }
      const stale = current.filter((c) => !want.has(c.memberId)).map((c) => c.id);
      if (stale.length) {
        await this.prisma.teamMembership.deleteMany({ where: { id: { in: stale } } });
        changed = true;
      }
    }

    // tréneri brankárov dostanú trénerský scope na neprázdne skupiny brankárov
    const gkCoaches = await this.prisma.userRole.findMany({ where: { role: 'GK_COACH' as never }, select: { userId: true } });
    const coachIds = [...new Set(gkCoaches.map((c) => c.userId))];
    const wanted = new Set<string>();
    for (const [teamId, members] of desired) {
      if (!members.size) continue;
      for (const userId of coachIds) wanted.add(`${userId}|${teamId}`);
    }
    // každý tréner bežného družstva smie vytvárať brankárske tréningy: dostane scope na skupinu
    // „<družstvo> Brankári“ svojej kategórie a na spoločnú „Brankári (všetci)“
    const regularCoaches = await this.prisma.userRole.findMany({
      where: { role: 'COACH', team: { isGoalkeeperGroup: false, isDemo: false } },
      select: { userId: true, team: { select: { teamCategoryId: true } } },
    });
    const gkTeamCategory = new Map(allGkTeams.map((t) => [t.id, t.teamCategoryId]));
    for (const [teamId, members] of desired) {
      if (!members.size) continue;
      const isAll = allGkTeams.find((t) => t.id === teamId)?.name === ALL_GOALKEEPERS_NAME;
      for (const rc of regularCoaches) {
        if (isAll || (rc.team && rc.team.teamCategoryId === gkTeamCategory.get(teamId))) wanted.add(`${rc.userId}|${teamId}`);
      }
    }
    const autoRoles = await this.prisma.userRole.findMany({
      where: { role: 'COACH', team: { isGoalkeeperGroup: true } },
      select: { id: true, userId: true, teamId: true },
    });
    const staleRoles = autoRoles.filter((r) => !wanted.has(`${r.userId}|${r.teamId}`)).map((r) => r.id);
    if (staleRoles.length) {
      await this.prisma.userRole.deleteMany({ where: { id: { in: staleRoles } } });
      changed = true;
    }
    const haveRoles = new Set(autoRoles.map((r) => `${r.userId}|${r.teamId}`));
    for (const w of wanted) {
      if (haveRoles.has(w)) continue;
      const [userId, teamId] = w.split('|') as [string, string];
      await this.prisma.userRole.create({ data: { userId, role: 'COACH', teamId } });
      changed = true;
    }

    if (changed) await this.chat.syncCategoryChannels().catch((e) => this.log.warn(`Synchronizácia kanálov zlyhala: ${e instanceof Error ? e.message : e}`));
    return { changed };
  }
}
