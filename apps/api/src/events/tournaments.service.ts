import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { formatEventDateTimeSk, type CreateTournamentMatchInput, type UpdateTournamentMatchInput } from '@fkknv/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from '../clubs/clubs.service';
import { PushService } from '../notifications/push.service';
import { canManageTeam } from '../auth/scope';
import type { AuthUser } from '../auth/current-user.decorator';
import { resolveParticipantClubs } from './tournament-clubs';

const lower = (v: string) => v.trim().toLocaleLowerCase('sk');
const byName = (a: { firstName: string; lastName: string }, b: { firstName: string; lastName: string }) =>
  a.lastName.localeCompare(b.lastName, 'sk') || a.firstName.localeCompare(b.firstName, 'sk');

const TOURNAMENT_INCLUDE = Prisma.validator<Prisma.EventInclude>()({
  team: { select: { id: true, name: true } },
  match: { select: { id: true } },
  tournamentParticipants: { orderBy: [{ sortOrder: 'asc' }, { clubName: 'asc' }] },
  tournamentNominations: { include: { member: { select: { id: true, firstName: true, lastName: true } } } },
  children: {
    include: {
      match: {
        select: {
          id: true,
          opponent: true,
          opponentLogo: true,
          jerseyColor: true,
          opponentJerseyColor: true,
          state: true,
          scoreUs: true,
          scoreThem: true,
          timerPhase: true,
          _count: { select: { events: true, nominations: true } },
        },
      },
    },
  },
});

/**
 * Turnaj = udalosť TOURNAMENT bez vlastného Match; má zoznam zúčastnených mužstiev
 * (TournamentParticipant) a zápasy = samostatné udalosti MATCH s parentEventId,
 * ktoré sa vedú ako bežné zápasy (nominácie, časomiera, góly).
 */
@Injectable()
export class TournamentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubs: ClubsService,
    private readonly push: PushService,
  ) {}

  private async load(id: string, user: AuthUser) {
    const t = await this.prisma.event.findUnique({ where: { id }, include: TOURNAMENT_INCLUDE });
    if (!t || t.type !== 'TOURNAMENT' || t.isDemo !== !!user.isDemo) throw new NotFoundException('Turnaj neexistuje');
    return t;
  }

  private async loadForManage(id: string, user: AuthUser) {
    const t = await this.load(id, user);
    if (!canManageTeam(user, t.teamId)) throw new ForbiddenException('Tento turnaj nemôžete upravovať');
    return t;
  }

  async get(id: string, user: AuthUser) {
    const t = await this.load(id, user);
    const matches = t.children
      .filter((c) => c.match)
      .map((c) => ({
        eventId: c.id,
        matchId: c.match!.id,
        order: c.tournamentOrder,
        opponent: c.match!.opponent,
        opponentLogo: c.match!.opponentLogo,
        startAt: c.startAt,
        endAt: c.endAt,
        location: c.location,
        pitchId: c.pitchId,
        jerseyColor: c.match!.jerseyColor,
        opponentJerseyColor: c.match!.opponentJerseyColor,
        state: c.match!.state,
        scoreUs: c.match!.scoreUs,
        scoreThem: c.match!.scoreThem,
      }))
      .sort(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
          a.startAt.getTime() - b.startAt.getTime(),
      );
    return {
      event: {
        id: t.id,
        title: t.title,
        startAt: t.startAt,
        endAt: t.endAt,
        location: t.location,
        address: t.address,
        surface: t.surface,
        pitchId: t.pitchId,
        teamId: t.teamId,
        team: t.team,
        /// starý turnaj s vlastným Match (pred zavedením zápasov turnaja)
        legacyMatchId: t.match?.id ?? null,
      },
      participants: t.tournamentParticipants.map((p) => ({
        id: p.id,
        clubName: p.clubName,
        logoUrl: p.logoUrl,
        sortOrder: p.sortOrder,
      })),
      matches,
      nominations: t.tournamentNominations
        .map((n) => n.member)
        .sort(byName)
        .map((m) => ({ memberId: m.id, firstName: m.firstName, lastName: m.lastName })),
    };
  }

  /** Aktívni hráči družstva turnaja v aktívnej sezóne; nominovaní najprv. */
  async candidates(id: string, user: AuthUser) {
    const t = await this.loadForManage(id, user);
    if (!t.teamId) return [];
    const members = await this.prisma.member.findMany({
      where: {
        status: 'ACTIVE',
        isDemo: t.isDemo,
        memberships: { some: { teamId: t.teamId, leftAt: null, season: { isActive: true } } },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    const nominated = new Set(t.tournamentNominations.map((n) => n.memberId));
    const rows = members.sort(byName).map((m) => ({ ...m, nominated: nominated.has(m.id) }));
    return [...rows.filter((r) => r.nominated), ...rows.filter((r) => !r.nominated)];
  }

  /** Pridá hráča do nominácie turnaja a prenesie ho do zápasov PLANNED/LIVE (jeden push). */
  async nominate(id: string, memberId: string, user: AuthUser) {
    const t = await this.loadForManage(id, user);
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: {
        guardians: { select: { userId: true } },
        memberships: { where: { teamId: t.teamId ?? '', leftAt: null, season: { isActive: true } }, select: { id: true } },
      },
    });
    if (!member || member.isDemo !== t.isDemo) throw new NotFoundException('Hráč neexistuje');
    if (member.status !== 'ACTIVE' || !t.teamId || member.memberships.length === 0) {
      throw new BadRequestException('Hráč musí byť aktívny člen družstva turnaja v aktívnej sezóne');
    }
    await this.prisma.tournamentNomination.upsert({
      where: { eventId_memberId: { eventId: t.id, memberId } },
      create: { eventId: t.id, memberId },
      update: {},
    });
    let matchesUpdated = 0;
    for (const c of t.children) {
      if (!c.match || !['PLANNED', 'LIVE'].includes(c.match.state)) continue;
      await this.upsertMatchNomination(c.match.id, memberId);
      matchesUpdated++;
    }
    const recipients = member.guardians.map((g) => g.userId);
    if (member.userId) recipients.push(member.userId);
    void this.push
      .notifyUsers(recipients, {
        title: 'Nominácia na turnaj',
        body: `Nominácia na turnaj: ${t.title}, ${formatEventDateTimeSk(t.startAt)}`,
        data: { type: 'nomination', eventId: t.id },
      })
      .catch(() => undefined);
    return { memberId, matchesUpdated };
  }

  /** Obnoví REMOVED / vytvorí; už nominovanému nemení číslo dresu ani základnú zostavu. */
  private async upsertMatchNomination(matchId: string, memberId: string) {
    await this.prisma.matchNomination.upsert({
      where: { matchId_memberId: { matchId, memberId } },
      create: { matchId, memberId, status: 'NOMINATED' },
      update: {},
    });
    await this.prisma.matchNomination.updateMany({ where: { matchId, memberId, status: 'REMOVED' }, data: { status: 'NOMINATED' } });
  }

  /** Odoberie hráča z nominácie turnaja; v zápasoch PLANNED/LIVE nastaví REMOVED (história ostáva). */
  async removeNomination(id: string, memberId: string, user: AuthUser) {
    const t = await this.loadForManage(id, user);
    await this.prisma.tournamentNomination.deleteMany({ where: { eventId: t.id, memberId } });
    const matchIds = t.children.filter((c) => c.match && ['PLANNED', 'LIVE'].includes(c.match.state)).map((c) => c.match!.id);
    let matchesUpdated = 0;
    if (matchIds.length) {
      const r = await this.prisma.matchNomination.updateMany({
        where: { memberId, matchId: { in: matchIds }, status: { not: 'REMOVED' } },
        data: { status: 'REMOVED' },
      });
      matchesUpdated = r.count;
    }
    return { memberId, matchesUpdated };
  }

  /** Nahradí zoznam účastníkov; účastníka, ktorý už má zápas, nemožno odstrániť. */
  async setParticipants(id: string, clubs: string[], user: AuthUser) {
    const t = await this.loadForManage(id, user);
    const rows = await resolveParticipantClubs(this.prisma, this.clubs, clubs);
    const keep = new Set(rows.map((r) => lower(r.clubName)));
    const removed = t.tournamentParticipants.filter((p) => !keep.has(lower(p.clubName)));
    for (const p of removed) {
      const used = t.children.some((c) => c.match && lower(c.match.opponent) === lower(p.clubName));
      if (used) {
        throw new BadRequestException(`Mužstvo „${p.clubName}" už má v turnaji zápas — najprv zmažte jeho zápas.`);
      }
    }
    const existing = new Map(t.tournamentParticipants.map((p) => [lower(p.clubName), p]));
    await this.prisma.$transaction([
      ...(removed.length
        ? [this.prisma.tournamentParticipant.deleteMany({ where: { id: { in: removed.map((p) => p.id) } } })]
        : []),
      ...rows.map((r, i) => {
        const cur = existing.get(lower(r.clubName));
        return cur
          ? this.prisma.tournamentParticipant.update({
              where: { id: cur.id },
              data: { sortOrder: i, logoUrl: r.logoUrl ?? cur.logoUrl },
            })
          : this.prisma.tournamentParticipant.create({
              data: { eventId: t.id, clubName: r.clubName, logoUrl: r.logoUrl, sortOrder: i },
            });
      }),
    ]);
    return this.get(id, user);
  }

  /** Plocha z nastavení (iná než plocha turnaja) → miesto/povrch/adresa zápasu. */
  private async resolvePitch(pitchId: string) {
    const p = await this.prisma.pitch.findUnique({ where: { id: pitchId } });
    if (!p) throw new BadRequestException('Zvolená hracia plocha neexistuje');
    return p;
  }

  private participantFor(t: Awaited<ReturnType<TournamentsService['load']>>, opponent: string) {
    const p = t.tournamentParticipants.find((x) => lower(x.clubName) === lower(opponent));
    if (!p) throw new BadRequestException(`Mužstvo „${opponent.trim()}" nie je medzi účastníkmi turnaja`);
    return p;
  }

  private assertOrderFree(t: Awaited<ReturnType<TournamentsService['load']>>, order: number, exceptEventId?: string) {
    if (t.children.some((c) => c.id !== exceptEventId && c.tournamentOrder === order)) {
      throw new ConflictException(`${order}. zápas už v turnaji existuje — zvoľte iné poradie`);
    }
  }

  private static assertRange(startAt: Date, endAt: Date | null | undefined) {
    if (endAt && endAt.getTime() <= startAt.getTime()) throw new BadRequestException('Koniec musí byť po začiatku');
  }

  async addMatch(id: string, input: CreateTournamentMatchInput, user: AuthUser) {
    const t = await this.loadForManage(id, user);
    const participant = this.participantFor(t, input.opponent);
    const maxOrder = Math.max(0, ...t.children.map((c) => c.tournamentOrder ?? 0));
    const order = input.order ?? maxOrder + 1;
    this.assertOrderFree(t, order);
    const pitch = input.pitchId && input.pitchId !== t.pitchId ? await this.resolvePitch(input.pitchId) : null;
    const startAt = input.startAt ?? t.startAt;
    const endAt = input.endAt ?? null;
    TournamentsService.assertRange(startAt, endAt);
    const opponentLogo = participant.logoUrl ?? (await this.clubs.logoForName(participant.clubName));
    const event = await this.prisma.event.create({
      data: {
        type: 'MATCH',
        seasonId: t.seasonId,
        teamId: t.teamId,
        isDemo: t.isDemo,
        title: `${t.title}: ${order}. zápas`,
        startAt,
        endAt,
        // zápas turnaja dedí plochu turnaja (kontrola obsadenosti sa nerobí — plochu rezervuje turnaj)
        location: pitch ? pitch.name : (input.location ?? t.location),
        address: input.address !== undefined ? input.address : pitch ? (pitch.address ?? t.address) : t.address,
        surface: pitch ? pitch.surface : t.surface,
        pitchId: pitch ? pitch.id : (t.pitchId ?? undefined),
        source: 'INTERNAL',
        parentEventId: t.id,
        tournamentOrder: order,
        createdById: user.id,
        match: {
          create: {
            opponent: participant.clubName,
            opponentLogo,
            isHome: false,
            isFriendly: false,
            jerseyColor: input.jerseyColor ?? null,
            opponentJerseyColor: input.opponentJerseyColor ?? null,
          },
        },
      },
      include: { match: { select: { id: true } } },
    });
    for (const n of t.tournamentNominations) await this.upsertMatchNomination(event.match!.id, n.memberId);
    return { eventId: event.id, matchId: event.match!.id, order };
  }

  async updateMatch(id: string, eventId: string, input: UpdateTournamentMatchInput, user: AuthUser) {
    const t = await this.loadForManage(id, user);
    const child = t.children.find((c) => c.id === eventId);
    if (!child || !child.match) throw new NotFoundException('Zápas turnaja neexistuje');
    let order = child.tournamentOrder;
    if (input.order !== undefined && input.order !== order) {
      this.assertOrderFree(t, input.order, eventId);
      order = input.order;
    }
    const pitch = input.pitchId && input.pitchId !== child.pitchId ? await this.resolvePitch(input.pitchId) : null;
    const startAt = input.startAt ?? child.startAt;
    const endAt = input.endAt !== undefined ? input.endAt : child.endAt;
    TournamentsService.assertRange(startAt, endAt);
    if (input.opponent !== undefined) {
      const p = this.participantFor(t, input.opponent);
      if (p.clubName !== child.match.opponent) {
        const opponentLogo = p.logoUrl ?? (await this.clubs.logoForName(p.clubName));
        await this.prisma.match.update({ where: { id: child.match.id }, data: { opponent: p.clubName, opponentLogo } });
      }
    }
    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        tournamentOrder: order,
        title: order !== child.tournamentOrder ? `${t.title}: ${order}. zápas` : undefined,
        startAt: input.startAt,
        endAt: input.endAt,
        location: pitch ? pitch.name : input.location,
        address: input.address !== undefined ? input.address : pitch ? (pitch.address ?? undefined) : undefined,
        surface: pitch ? pitch.surface : undefined,
        pitchId: pitch ? pitch.id : undefined,
      },
    });
    if (input.jerseyColor !== undefined || input.opponentJerseyColor !== undefined) {
      await this.prisma.match.update({
        where: { id: child.match.id },
        data: {
          ...(input.jerseyColor !== undefined ? { jerseyColor: input.jerseyColor } : {}),
          ...(input.opponentJerseyColor !== undefined ? { opponentJerseyColor: input.opponentJerseyColor } : {}),
        },
      });
    }
    return { eventId, matchId: child.match.id, order };
  }

  /** Zápas turnaja možno zmazať len kým nezačal a nemá žiadne záznamy (nominácie, udalosti). */
  async removeMatch(id: string, eventId: string, user: AuthUser) {
    const t = await this.loadForManage(id, user);
    const child = t.children.find((c) => c.id === eventId);
    if (!child) throw new NotFoundException('Zápas turnaja neexistuje');
    const m = child.match;
    if (m && (m.state !== 'PLANNED' || m.timerPhase !== 'NOT_STARTED' || m._count.events > 0 || m._count.nominations > 0)) {
      throw new BadRequestException('Zápas už prebieha / má záznamy (nominácie, góly) — nemožno ho zmazať');
    }
    await this.prisma.event.delete({ where: { id: eventId } });
    return { deleted: 1 };
  }
}
