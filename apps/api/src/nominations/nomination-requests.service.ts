import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { categoryForBirthDate, formatEventDateTimeSk, type CategoryCode } from '@fkknv/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../notifications/push.service';
import { EmailService } from '../notifications/email.service';
import { canManageTeam, coachTeamIds, isStaff } from '../auth/scope';
import type { AuthUser } from '../auth/current-user.decorator';

interface RuleRow {
  birthYearFrom: number;
  birthYearTo: number | null;
  teamCategory: { code: string; sortOrder: number };
}

interface CandidateTeam {
  id: string;
  name: string;
  teamCategory: { code: string; sortOrder: number };
}

/**
 * Poradie vekovej kategórie hráča (TeamCategory.sortOrder; menšie = mladší).
 * Primárne podľa ročníka narodenia a pravidiel aktívnej sezóny (CategoryRule);
 * ak dátum narodenia chýba alebo nespadá do pravidla, berie sa konzervatívne
 * NAJSTARŠIA kategória družstiev, v ktorých hráč je.
 */
export function playerCategoryOrder(
  birthDate: Date | null,
  rules: RuleRow[],
  teams: CandidateTeam[],
): number | null {
  if (birthDate) {
    const code = categoryForBirthDate(
      birthDate,
      rules.map((r) => ({
        categoryCode: r.teamCategory.code as CategoryCode,
        birthYearFrom: r.birthYearFrom,
        birthYearTo: r.birthYearTo,
      })),
    );
    const rule = code ? rules.find((r) => r.teamCategory.code === code) : undefined;
    if (rule) return rule.teamCategory.sortOrder;
  }
  if (teams.length === 0) return null;
  return Math.max(...teams.map((t) => t.teamCategory.sortOrder));
}

/** Smie hráča nominovať do zápasu kategórie `matchOrder`? (rovnaká alebo mladšia kategória) */
export function isAgeEligible(playerOrder: number | null, matchOrder: number): boolean {
  return playerOrder !== null && playerOrder <= matchOrder;
}

/** Hráč = konto (ak existuje) nie je vedenie/tréner/rodič — rovnako ako filter role=PLAYER v členoch. */
const PLAYER_ONLY = {
  NOT: { user: { roles: { some: { role: { in: ['ADMIN', 'MANAGER', 'COACH', 'PARENT'] as never } } } } },
};

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

@Injectable()
export class NominationRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly email: EmailService,
  ) {}

  /** Zápas + kategória jeho družstva; overí, že používateľ smie spravovať nomináciu. */
  private async loadMatchForManager(matchId: string, user: AuthUser) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { event: { include: { team: { include: { teamCategory: true } } } } },
    });
    if (!match || match.event.isDemo !== !!user.isDemo) throw new NotFoundException('Zápas neexistuje');
    if (!match.event.team) throw new BadRequestException('Zápas nemá priradené družstvo');
    if (!canManageTeam(user, match.event.team.id)) {
      throw new ForbiddenException('Nomináciu môžete spravovať len pre svoje družstvo');
    }
    return match as typeof match & { event: { team: NonNullable<typeof match.event.team> } };
  }

  private async activeRules(): Promise<RuleRow[]> {
    return this.prisma.categoryRule.findMany({
      where: { season: { isActive: true } },
      select: {
        birthYearFrom: true,
        birthYearTo: true,
        teamCategory: { select: { code: true, sortOrder: true } },
      },
      orderBy: { teamCategory: { sortOrder: 'asc' } },
    });
  }

  /** Aktívni hráči mimo družstva zápasu (aktívne zaradenie v aktívnej sezóne). */
  private async otherTeamPlayers(teamId: string, isDemo: boolean, memberId?: string) {
    return this.prisma.member.findMany({
      where: {
        AND: [
          memberId ? { id: memberId } : {},
          { isDemo, status: 'ACTIVE' },
          { memberships: { some: { leftAt: null, season: { isActive: true } } } },
          { NOT: { memberships: { some: { teamId, leftAt: null, season: { isActive: true } } } } },
          PLAYER_ONLY,
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        birthDate: true,
        memberships: {
          where: { leftAt: null, season: { isActive: true } },
          select: {
            team: { select: { id: true, name: true, teamCategory: { select: { code: true, sortOrder: true } } } },
          },
        },
      },
    });
  }

  /**
   * Menný zoznam hráčov z iných družstiev, ktorých možno nominovať (rovnaká alebo
   * mladšia veková kategória). Ku každému: či je už nominovaný, stav žiadosti
   * a či ho môže používateľ nominovať priamo (trénuje niektoré jeho družstvo).
   */
  async candidates(matchId: string, user: AuthUser, q?: string) {
    const match = await this.loadMatchForManager(matchId, user);
    const matchOrder = match.event.team.teamCategory.sortOrder;
    const [rules, players, nominations, requests] = await Promise.all([
      this.activeRules(),
      this.otherTeamPlayers(match.event.team.id, !!user.isDemo),
      this.prisma.matchNomination.findMany({
        where: { matchId, status: { not: 'REMOVED' } },
        select: { memberId: true },
      }),
      this.prisma.nominationRequest.findMany({ where: { matchId }, select: { memberId: true, status: true } }),
    ]);
    const nominated = new Set(nominations.map((n) => n.memberId));
    const requestStatus = new Map(requests.map((r) => [r.memberId, r.status]));
    const myTeams = new Set(coachTeamIds(user));
    const needle = q?.trim().toLowerCase();

    return players
      .map((p) => {
        const teams = p.memberships.map((m) => m.team);
        const order = playerCategoryOrder(p.birthDate, rules, teams);
        const code =
          rules.find((r) => r.teamCategory.sortOrder === order)?.teamCategory.code ??
          teams.find((t) => t.teamCategory.sortOrder === order)?.teamCategory.code ??
          null;
        return {
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          position: p.position,
          birthYear: p.birthDate ? p.birthDate.getUTCFullYear() : null,
          categoryCode: code,
          order,
          teams: teams.map((t) => ({ id: t.id, name: t.name })),
          nominated: nominated.has(p.id),
          requestStatus: requestStatus.get(p.id) ?? null,
          direct: isStaff(user) || teams.some((t) => myTeams.has(t.id)),
        };
      })
      .filter((c) => isAgeEligible(c.order, matchOrder))
      .filter((c) => !needle || `${c.firstName} ${c.lastName}`.toLowerCase().includes(needle) || `${c.lastName} ${c.firstName}`.toLowerCase().includes(needle))
      // nominovaní hráči najprv, potom ostatní; v oboch skupinách abecedne (slovenské radenie)
      .sort(
        (a, b) =>
          Number(b.nominated) - Number(a.nominated) ||
          a.lastName.localeCompare(b.lastName, 'sk') ||
          a.firstName.localeCompare(b.firstName, 'sk'),
      )
      .map(({ order: _order, ...rest }) => rest);
  }

  /**
   * Nominácia hráča z iného družstva. Ak nominujúci hráča trénuje (alebo je
   * vedenie), nominácia vznikne hneď; inak sa vytvorí žiadosť pre trénera/ov
   * družstva hráča.
   */
  async nominate(matchId: string, memberId: string, user: AuthUser, note?: string) {
    const match = await this.loadMatchForManager(matchId, user);
    const [rules, [player]] = await Promise.all([
      this.activeRules(),
      this.otherTeamPlayers(match.event.team.id, !!user.isDemo, memberId),
    ]);
    if (!player) throw new BadRequestException('Hráč nie je aktívny hráč iného družstva v aktuálnej sezóne');
    const teams = player.memberships.map((m) => m.team);
    if (!isAgeEligible(playerCategoryOrder(player.birthDate, rules, teams), match.event.team.teamCategory.sortOrder)) {
      throw new BadRequestException('Nominovať možno len hráča rovnakej alebo mladšej vekovej kategórie');
    }
    await this.assertNotNominated(matchId, memberId);

    const myTeams = new Set(coachTeamIds(user));
    if (isStaff(user) || teams.some((t) => myTeams.has(t.id))) {
      const nomination = await this.createNomination(matchId, memberId);
      return { result: 'NOMINATED' as const, nomination };
    }

    const existing = await this.prisma.nominationRequest.findUnique({
      where: { matchId_memberId: { matchId, memberId } },
    });
    if (existing?.status === 'PENDING') throw new BadRequestException('Žiadosť o tohto hráča už čaká na schválenie');
    const data = {
      requestedById: user.id,
      status: 'PENDING' as const,
      decidedById: null,
      decidedAt: null,
      note: note?.trim() || null,
    };
    const request = existing
      ? await this.prisma.nominationRequest.update({ where: { id: existing.id }, data })
      : await this.prisma.nominationRequest.create({ data: { matchId, memberId, ...data } });

    void this.notifyApprovers(request.id, teams.map((t) => t.id)).catch(() => undefined);
    return { result: 'REQUESTED' as const, request };
  }

  /**
   * Zrušenie nominácie hráča z iného družstva: odoberie ho z nominácie zápasu
   * (záznam ostáva pre históriu ako REMOVED) a čakajúcu žiadosť o povolenie zruší
   * (zmaže). Smie to rovnaký používateľ, ktorý môže nomináciu spravovať
   * (tréner družstva zápasu alebo vedenie).
   */
  async cancel(matchId: string, memberId: string, user: AuthUser) {
    await this.loadMatchForManager(matchId, user);
    const nomination = await this.prisma.matchNomination.findUnique({
      where: { matchId_memberId: { matchId, memberId } },
    });
    const request = await this.prisma.nominationRequest.findUnique({
      where: { matchId_memberId: { matchId, memberId } },
    });
    const hasNomination = !!nomination && nomination.status !== 'REMOVED';
    const hasPending = request?.status === 'PENDING';
    if (!hasNomination && !hasPending) throw new NotFoundException('Nominácia ani čakajúca žiadosť neexistuje');
    if (hasNomination) {
      await this.prisma.matchNomination.update({
        where: { matchId_memberId: { matchId, memberId } },
        data: { status: 'REMOVED' },
      });
    }
    if (hasPending && request) await this.prisma.nominationRequest.delete({ where: { id: request.id } });
    return { result: hasNomination ? ('REMOVED' as const) : ('CANCELLED' as const) };
  }

  /** Žiadosti, o ktorých môže používateľ rozhodnúť, a žiadosti, ktoré sám podal. */
  async list(user: AuthUser, matchId?: string) {
    const include = {
      member: { select: { id: true, firstName: true, lastName: true, position: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
      decidedBy: { select: { firstName: true, lastName: true } },
      match: {
        select: {
          id: true,
          opponent: true,
          event: { select: { title: true, startAt: true, team: { select: { id: true, name: true } } } },
        },
      },
    } as const;
    const base = { match: { event: { isDemo: !!user.isDemo } }, ...(matchId ? { matchId } : {}) };
    const teamIds = coachTeamIds(user);
    const decidable = isStaff(user)
      ? {}
      : { member: { memberships: { some: { teamId: { in: teamIds }, leftAt: null, season: { isActive: true } } } } };
    const [toDecide, mine] = await Promise.all([
      isStaff(user) || teamIds.length
        ? this.prisma.nominationRequest.findMany({
            where: { ...base, status: 'PENDING', ...decidable, NOT: { requestedById: user.id } },
            include,
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
      this.prisma.nominationRequest.findMany({
        where: { ...base, requestedById: user.id },
        include,
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
    ]);
    return { toDecide, mine };
  }

  /** Schválenie / zamietnutie žiadosti trénerom družstva hráča (alebo vedením). */
  async decide(requestId: string, user: AuthUser, approve: boolean, note?: string) {
    const request = await this.prisma.nominationRequest.findUnique({
      where: { id: requestId },
      include: {
        member: {
          select: {
            status: true,
            isDemo: true,
            memberships: { where: { leftAt: null, season: { isActive: true } }, select: { teamId: true } },
          },
        },
      },
    });
    if (!request || request.member.isDemo !== !!user.isDemo) throw new NotFoundException('Žiadosť neexistuje');
    const teamIds = request.member.memberships.map((m) => m.teamId);
    if (!isStaff(user) && !teamIds.some((t) => coachTeamIds(user).includes(t))) {
      throw new ForbiddenException('O žiadosti rozhoduje tréner družstva hráča');
    }
    if (request.status !== 'PENDING') throw new BadRequestException('O žiadosti už bolo rozhodnuté');

    if (approve) {
      if (request.member.status !== 'ACTIVE') throw new BadRequestException('Hráč nie je aktívny');
      const already = await this.prisma.matchNomination.findUnique({
        where: { matchId_memberId: { matchId: request.matchId, memberId: request.memberId } },
      });
      if (!already || already.status === 'REMOVED') await this.createNomination(request.matchId, request.memberId);
    }
    const updated = await this.prisma.nominationRequest.update({
      where: { id: requestId },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedById: user.id,
        decidedAt: new Date(),
        note: note?.trim() || request.note,
      },
    });
    void this.notifyRequester(requestId).catch(() => undefined);
    return updated;
  }

  private async assertNotNominated(matchId: string, memberId: string) {
    const nomination = await this.prisma.matchNomination.findUnique({
      where: { matchId_memberId: { matchId, memberId } },
    });
    if (nomination && nomination.status !== 'REMOVED') throw new BadRequestException('Hráč už je v nominácii');
  }

  /** Vytvorí (obnoví) nomináciu a pošle push hráčovi a rodičom — rovnako ako bežná nominácia. */
  private async createNomination(matchId: string, memberId: string) {
    const nomination = await this.prisma.matchNomination.upsert({
      where: { matchId_memberId: { matchId, memberId } },
      create: { matchId, memberId },
      update: { status: 'NOMINATED' },
    });
    const [match, member] = await Promise.all([
      this.prisma.match.findUnique({ where: { id: matchId }, include: { event: true } }),
      this.prisma.member.findUnique({ where: { id: memberId }, include: { guardians: { select: { userId: true } } } }),
    ]);
    if (match && member) {
      const recipients = member.guardians.map((g) => g.userId);
      if (member.userId) recipients.push(member.userId);
      void this.push
        .notifyUsers(recipients, {
          title: 'Nominácia na zápas',
          body: `${member.firstName} ${member.lastName} je v nominácii: ${match.event.title}, ${formatEventDateTimeSk(match.event.startAt)}${match.event.location ? `, ${match.event.location}` : ''}`,
          data: { type: 'nomination', matchId },
        })
        .catch(() => undefined);
    }
    return nomination;
  }

  private async requestDetail(requestId: string) {
    return this.prisma.nominationRequest.findUnique({
      where: { id: requestId },
      include: {
        member: { select: { firstName: true, lastName: true } },
        requestedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
        decidedBy: { select: { firstName: true, lastName: true } },
        match: { include: { event: { include: { team: { select: { name: true } } } } } },
      },
    });
  }

  private emailHtml(heading: string, rows: Array<[string, string]>, text: string) {
    const row = ([k, v]: [string, string]) =>
      `<tr><td style="color:#6b7280;padding:2px 8px 2px 0">${k}</td><td>${v}</td></tr>`;
    return `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#16223c">
        <h2 style="color:#1a2848">${heading}</h2>
        <p>${text}</p>
        <table style="margin:10px 0;font-size:15px">${rows.map(row).join('')}</table>
        <p><a href="https://fkknv.sk/portal" style="display:inline-block;background:#2b4278;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Otvoriť portál</a></p>
      </div>`;
  }

  /** Oznam trénerom družstva hráča (bez trénerov → vedeniu): push + e-mail. */
  private async notifyApprovers(requestId: string, playerTeamIds: string[]) {
    const r = await this.requestDetail(requestId);
    if (!r) return;
    let approvers = await this.prisma.userRole.findMany({
      where: { role: 'COACH', teamId: { in: playerTeamIds }, userId: { not: r.requestedById } },
      select: { user: { select: { id: true, email: true } } },
    });
    if (approvers.length === 0) {
      approvers = await this.prisma.userRole.findMany({
        where: { role: { in: ['ADMIN', 'MANAGER'] }, user: { isDemo: r.match.event.isDemo } },
        select: { user: { select: { id: true, email: true } } },
      });
    }
    const users = new Map(approvers.map((a) => [a.user.id, a.user.email]));
    if (users.size === 0) return;
    const player = `${r.member.firstName} ${r.member.lastName}`;
    const who = `${r.requestedBy.firstName} ${r.requestedBy.lastName}`;
    const when = formatEventDateTimeSk(r.match.event.startAt);
    await this.push.notifyUsers([...users.keys()], {
      title: 'Žiadosť o nomináciu hráča',
      body: `${who} žiada nominovať ${player}: ${r.match.event.title}, ${when}`,
      data: { type: 'nomination-request', matchId: r.matchId, requestId },
    });
    const html = this.emailHtml(
      'Žiadosť o nomináciu hráča',
      [
        ['Hráč:', `<strong>${esc(player)}</strong>`],
        ['Zápas:', esc(r.match.event.title)],
        ['Družstvo:', esc(r.match.event.team?.name ?? '')],
        ['Termín:', esc(when)],
        ...(r.note ? ([['Poznámka:', esc(r.note)]] as Array<[string, string]>) : []),
      ],
      `Tréner ${esc(who)} žiada o povolenie nominovať vášho hráča na zápas iného družstva. Žiadosť schválite alebo zamietnete v portáli na nástenke.`,
    );
    const emails = new Set([...users.values()].filter(Boolean).map((e) => e.trim().toLowerCase()));
    for (const to of emails) await this.email.send([to], `Žiadosť o nomináciu — ${player}`, html);
  }

  /** Oznam žiadateľovi o rozhodnutí: push + e-mail. */
  private async notifyRequester(requestId: string) {
    const r = await this.requestDetail(requestId);
    if (!r) return;
    const approved = r.status === 'APPROVED';
    const player = `${r.member.firstName} ${r.member.lastName}`;
    const verdict = approved ? 'schválená' : 'zamietnutá';
    const when = formatEventDateTimeSk(r.match.event.startAt);
    await this.push.notifyUsers([r.requestedBy.id], {
      title: approved ? 'Nominácia schválená' : 'Nominácia zamietnutá',
      body: `Žiadosť o nomináciu ${player} (${r.match.event.title}) bola ${verdict}.`,
      data: { type: 'nomination-request', matchId: r.matchId, requestId },
    });
    if (!r.requestedBy.email) return;
    const decider = r.decidedBy ? `${r.decidedBy.firstName} ${r.decidedBy.lastName}` : '';
    const html = this.emailHtml(
      approved ? 'Nominácia schválená' : 'Nominácia zamietnutá',
      [
        ['Hráč:', `<strong>${esc(player)}</strong>`],
        ['Zápas:', esc(r.match.event.title)],
        ['Termín:', esc(when)],
        ...(decider ? ([['Rozhodol:', esc(decider)]] as Array<[string, string]>) : []),
        ...(r.note ? ([['Poznámka:', esc(r.note)]] as Array<[string, string]>) : []),
      ],
      approved
        ? 'Vaša žiadosť bola schválená — hráč je zaradený do nominácie.'
        : 'Vaša žiadosť o nomináciu hráča bola zamietnutá.',
    );
    await this.email.send([r.requestedBy.email], `Nominácia ${verdict} — ${player}`, html);
  }
}
