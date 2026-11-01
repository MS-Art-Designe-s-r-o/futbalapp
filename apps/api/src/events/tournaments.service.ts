import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateTournamentMatchInput, UpdateTournamentMatchInput } from '@fkknv/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from '../clubs/clubs.service';
import { canManageTeam } from '../auth/scope';
import type { AuthUser } from '../auth/current-user.decorator';
import { resolveParticipantClubs } from './tournament-clubs';

const lower = (v: string) => v.trim().toLocaleLowerCase('sk');

const TOURNAMENT_INCLUDE = Prisma.validator<Prisma.EventInclude>()({
  team: { select: { id: true, name: true } },
  match: { select: { id: true } },
  tournamentParticipants: { orderBy: [{ sortOrder: 'asc' }, { clubName: 'asc' }] },
  children: {
    include: {
      match: {
        select: {
          id: true,
          opponent: true,
          opponentLogo: true,
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
    };
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
        location: input.location ?? t.location,
        address: input.address !== undefined ? input.address : t.address,
        // plochu (pitchId) obsadzuje turnaj; zápas turnaja ju nedrží, aby sa nekolidoval s turnajom
        surface: t.surface,
        source: 'INTERNAL',
        parentEventId: t.id,
        tournamentOrder: order,
        createdById: user.id,
        match: {
          create: { opponent: participant.clubName, opponentLogo, isHome: false, isFriendly: false },
        },
      },
      include: { match: { select: { id: true } } },
    });
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
        location: input.location,
        address: input.address,
      },
    });
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
