import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  generateOccurrences,
  resolveJerseys,
  formatEventDateTimeSk,
  formatEventTimeSk,
  type CreateEventInput,
  type CreateRecurringTrainingInput,
  type MarkAttendanceInput,
} from '@fkknv/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClubsService } from '../clubs/clubs.service';
import { EmailService } from '../notifications/email.service';
import { bySlovakName } from '../members/members.service';
import { resolveParticipantClubs } from './tournament-clubs';
import { canManageTeam, coachBlockedFromTeam, coachTeamIds, isDemoScope, isStaff } from '../auth/scope';
import type { AuthUser } from '../auth/current-user.decorator';

/** Tréning iného družstva na rovnakej ploche v rovnakom čase. */
interface SharedClash {
  teamId: string;
  teamName: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
}

/** Spoločné pripojenia pri načítaní udalostí (družstvo, zápas, cieľové družstvá). */
const EVENT_INCLUDE = {
  team: { include: { teamCategory: true } },
  match: true,
  pitch: { select: { id: true, name: true, surface: true } },
  audienceTeams: { select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } },
  /// zápas turnaja → odkaz späť na turnaj
  parent: { select: { id: true, title: true } },
} as const;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubs: ClubsService,
    private readonly email: EmailService,
  ) {}

  list(params: { categoryCode?: string; teamId?: string; from?: Date; to?: Date; type?: string; isDemo?: boolean }) {
    return this.prisma.event.findMany({
      where: {
        isDemo: params.isDemo ?? false,
        team: {
          id: params.teamId ? params.teamId : undefined,
          teamCategory: params.categoryCode ? { code: params.categoryCode } : undefined,
        },
        type: params.type ? (params.type as never) : undefined,
        startAt: { gte: params.from, lte: params.to },
      },
      include: EVENT_INCLUDE,
      orderBy: { startAt: 'asc' },
    });
  }

  /** Družstvá relevantné pre používateľa: trénerske + jeho vlastné (hráč) + jeho detí (rodič). */
  private async relevantTeamIds(user: AuthUser): Promise<string[]> {
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    const ids = new Set<string>(coachTeamIds(user));
    if (season) {
      const memberships = await this.prisma.teamMembership.findMany({
        where: {
          seasonId: season.id,
          leftAt: null,
          member: {
            OR: [{ userId: user.id }, { guardians: { some: { userId: user.id } } }],
          },
        },
        select: { teamId: true },
      });
      for (const m of memberships) ids.add(m.teamId);
    }
    return [...ids];
  }

  /** Udalosti relevantné pre používateľa: vedenie vidí všetko; ostatní svoje družstvá + celoklubové. */
  async listForUser(params: { from?: Date; to?: Date; type?: string }, user: AuthUser) {
    if (isStaff(user)) return this.list({ ...params, isDemo: isDemoScope(user) });
    const teamIds = await this.relevantTeamIds(user);
    return this.prisma.event.findMany({
      where: {
        isDemo: isDemoScope(user),
        OR: [
          { teamId: { in: teamIds } },
          // celoklubová udalosť bez cielenia na konkrétne družstvá
          { AND: [{ teamId: null }, { audienceTeams: { none: {} } }] },
          // udalosť cielená na moje družstvá (napr. rodičovské združenie)
          { audienceTeams: { some: { id: { in: teamIds } } } },
        ],
        type: params.type ? (params.type as never) : undefined,
        startAt: { gte: params.from, lte: params.to },
      },
      include: EVENT_INCLUDE,
      orderBy: { startAt: 'asc' },
    });
  }

  /**
   * Kalendár trénera: vidí LEN svoje pridelené družstvá. Bez konkrétneho výberu
   * („Všetky") = všetky jeho družstvá + celoklubové udalosti; s výberom teamId =
   * len to družstvo (musí byť jeho, inak prázdne). Žiadne iné družstvá.
   */
  async listForCoach(params: { teamId?: string; from?: Date; to?: Date; type?: string }, user: AuthUser) {
    const coachIds = coachTeamIds(user);
    const teamFilter =
      params.teamId
        ? coachIds.includes(params.teamId)
          ? { teamId: params.teamId }
          : { teamId: '__none__' } // cudzie družstvo → nič
        : { OR: [{ teamId: { in: coachIds } }, { teamId: null }] }; // všetky jeho + celoklubové
    return this.prisma.event.findMany({
      where: {
        isDemo: isDemoScope(user),
        ...teamFilter,
        type: params.type ? (params.type as never) : undefined,
        startAt: { gte: params.from, lte: params.to },
      },
      include: EVENT_INCLUDE,
      orderBy: { startAt: 'asc' },
    });
  }

  /** Zoznam doteraz použitých miest (ihrísk) pre našepkávač — bez duplicít. */
  async locations(): Promise<string[]> {
    const rows = await this.prisma.event.findMany({
      where: { location: { not: null } },
      distinct: ['location'],
      select: { location: true },
      orderBy: { location: 'asc' },
    });
    return rows.map((r) => r.location).filter((l): l is string => !!l && l.trim().length > 0);
  }

  /** Hracia plocha → miesto a povrch udalosti (pri zadanom pitchId prepíšu textové polia). */
  private async resolvePitch(pitchId?: string | null) {
    if (!pitchId) return null;
    const pitch = await this.prisma.pitch.findUnique({ where: { id: pitchId } });
    if (!pitch) throw new BadRequestException('Hracia plocha neexistuje');
    return pitch;
  }

  /** Koniec musí byť po začiatku; pri vybranej hracej ploche je povinný. */
  private assertEndAfterStart(startAt: Date, endAt: Date | null | undefined, pitchSelected: boolean) {
    if (!endAt) {
      if (pitchSelected) throw new BadRequestException('Pri vybranej hracej ploche zadajte koniec');
      return;
    }
    if (endAt.getTime() <= startAt.getTime()) throw new BadRequestException('Koniec musí byť po začiatku');
  }

  /**
   * Overí, či je plocha v danom čase voľná (bez koncového času sa počíta 90 min).
   * Prekryv s tréningom iného družstva pri tréningu sa dá potvrdiť (`allowShared`) — inak 409
   * so zoznamom družstiev; ostatné prekryvy (zápas, nezdieľateľné) sa odmietnu vždy.
   * Vráti tréningy, s ktorými sa plocha zdieľa.
   */
  private async assertPitchFree(
    pitchId: string,
    slots: Array<{ startAt: Date; endAt?: Date | null }>,
    opts: { excludeId?: string; shareable?: boolean; allowShared?: boolean } = {},
  ): Promise<SharedClash[]> {
    const DEFAULT_MS = 90 * 60_000;
    const range = slots.map((s) => ({ s: s.startAt.getTime(), e: (s.endAt ?? new Date(s.startAt.getTime() + DEFAULT_MS)).getTime() }));
    const from = new Date(Math.min(...range.map((r) => r.s)) - 24 * 3600_000);
    const to = new Date(Math.max(...range.map((r) => r.e)));
    const existing = await this.prisma.event.findMany({
      where: { pitchId, id: opts.excludeId ? { not: opts.excludeId } : undefined, startAt: { gte: from, lt: to } },
      select: { id: true, type: true, teamId: true, team: { select: { name: true } }, title: true, startAt: true, endAt: true },
    });
    const clashes = new Map<string, (typeof existing)[number]>();
    for (const r of range) {
      for (const x of existing) {
        const xs = x.startAt.getTime();
        const xe = (x.endAt ?? new Date(xs + DEFAULT_MS)).getTime();
        if (xs < r.e && xe > r.s) clashes.set(x.id, x);
      }
    }
    if (clashes.size === 0) return [];
    const list = [...clashes.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const sharable = opts.shareable && list.every((c) => c.type === 'TRAINING' && c.teamId);
    if (!sharable) {
      const c = list[0]!;
      throw new BadRequestException(`Plocha je v tom čase obsadená (${c.title}, ${formatEventDateTimeSk(c.startAt)})`);
    }
    const result: SharedClash[] = list.map((c) => ({
      teamId: c.teamId!,
      teamName: c.team?.name ?? c.title,
      title: c.title,
      startAt: c.startAt,
      endAt: c.endAt,
    }));
    if (!opts.allowShared) {
      const names = [...new Set(result.map((c) => c.teamName))];
      throw new ConflictException({
        statusCode: 409,
        code: 'PITCH_SHARED',
        message: `V tom čase je plocha rezervovaná pre: ${names.join(', ')}. Chcete ju napriek tomu rezervovať?`,
        conflicts: result.slice(0, 20).map((c) => ({
          teamName: c.teamName,
          title: c.title,
          startAt: c.startAt.toISOString(),
          endAt: c.endAt ? c.endAt.toISOString() : null,
        })),
      });
    }
    return result;
  }

  /** Tréneri družstiev, ktoré už mali plochu rezervovanú, dostanú info o ďalšom družstve na ploche. */
  private async notifySharedPitch(
    clashes: SharedClash[],
    pitchName: string,
    newTeamIds: string[],
    slots: Array<{ startAt: Date; endAt?: Date | null }>,
  ) {
    if (clashes.length === 0) return;
    const newTeams = await this.prisma.team.findMany({ where: { id: { in: newTeamIds } }, select: { name: true } });
    const teamIds = [...new Set(clashes.map((c) => c.teamId))].filter((id) => !newTeamIds.includes(id));
    if (teamIds.length === 0) return;
    const coaches = await this.prisma.userRole.findMany({
      where: { role: 'COACH', teamId: { in: teamIds } },
      select: { teamId: true, user: { select: { email: true } } },
    });
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const range = (a: Date, b?: Date | null) => formatEventDateTimeSk(a) + (b ? `–${formatEventTimeSk(b)}` : '');
    const when = slots.slice(0, 10).map((s) => esc(range(s.startAt, s.endAt))).join('<br>') + (slots.length > 10 ? `<br>… (+${slots.length - 10})` : '');
    const names = newTeams.map((t) => t.name).join(', ');
    const sent = new Set<string>();
    for (const c of coaches) {
      const to = c.user.email?.trim().toLowerCase();
      if (!to || sent.has(to)) continue;
      sent.add(to);
      const own = clashes.find((x) => x.teamId === c.teamId);
      const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#16223c">
        <h2 style="color:#1a2848">Na vašej ploche trénuje aj ďalšie družstvo</h2>
        <p>Plocha <strong>${esc(pitchName)}</strong>, ktorú má vaše družstvo${own ? ` (${esc(own.teamName)})` : ''} rezervovanú, bola rezervovaná aj pre: <strong>${esc(names)}</strong>.</p>
        <p style="margin:10px 0">${when}</p>
        <p><a href="https://fkknv.sk/prihlasenie" style="display:inline-block;background:#2b4278;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Otvoriť portál</a></p>
      </div>`;
      await this.email.send([to], `Plocha ${pitchName} — tréning aj pre ${names}`, html);
    }
  }

  private async resolveTeam(teamId?: string) {
    if (!teamId) return null;
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new BadRequestException('Družstvo neexistuje');
    return team;
  }

  /**
   * Členovia družstva, ktorí v danej sezóne z družstva neodišli (kľúč `sezóna:člen`).
   * Hráč vyradený z družstva sa v dochádzke nezobrazuje — okrem už zapísaných
   * (označených) záznamov, ktoré ostávajú ako história.
   */
  private async activeMemberKeys(teamId: string, seasonIds: string[]): Promise<Set<string>> {
    if (seasonIds.length === 0) return new Set();
    const rows = await this.prisma.teamMembership.findMany({
      where: { teamId, seasonId: { in: seasonIds }, leftAt: null },
      select: { seasonId: true, memberId: true },
    });
    return new Set(rows.map((r) => `${r.seasonId}:${r.memberId}`));
  }

  /** Predpripraví dochádzku pre všetkých hráčov družstva (vedenie/tréner/rodič sa nezahŕňa). */
  private async prepareAttendance(eventId: string, teamId: string, seasonId: string) {
    const memberships = await this.prisma.teamMembership.findMany({
      where: {
        seasonId,
        teamId,
        leftAt: null,
        member: { NOT: { user: { roles: { some: { role: { in: ['ADMIN', 'MANAGER', 'COACH', 'PARENT'] as never } } } } } },
      },
    });
    if (memberships.length > 0) {
      await this.prisma.attendance.createMany({
        data: memberships.map((m) => ({ eventId, memberId: m.memberId })),
        skipDuplicates: true,
      });
    }
  }

  /**
   * Vytvorí jednu udalosť; pri TRAINING predpripraví dochádzku družstva,
   * pri MATCH/TOURNAMENT vytvorí Match záznam.
   */
  async create(input: CreateEventInput, createdById: string, isDemo = false) {
    const ids = input.type === 'TRAINING' ? [...new Set(input.teamIds?.length ? input.teamIds : input.teamId ? [input.teamId] : [])] : [];
    if (ids.length <= 1) return this.createOne({ ...input, teamId: ids[0] ?? input.teamId }, createdById, isDemo);
    // tréning pre viac družstiev: každé má vlastnú udalosť (dochádzka, e-maily); plocha sa overí raz
    for (const id of ids) await this.resolveTeam(id);
    const pitch = await this.resolvePitch(input.pitchId);
    this.assertEndAfterStart(input.startAt, input.endAt, !!pitch);
    const slots = [{ startAt: input.startAt, endAt: input.endAt }];
    const clashes = pitch ? await this.assertPitchFree(pitch.id, slots, { shareable: true, allowShared: input.allowSharedPitch }) : [];
    let first;
    for (const id of ids) {
      const ev = await this.createOne({ ...input, teamId: id, teamIds: undefined }, createdById, isDemo, true);
      first ??= ev;
    }
    if (pitch) void this.notifySharedPitch(clashes, pitch.name, ids, slots).catch(() => undefined);
    return first;
  }

  private async createOne(input: CreateEventInput, createdById: string, isDemo = false, skipPitchCheck = false) {
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) throw new BadRequestException('Neexistuje aktívna sezóna');
    const team = await this.resolveTeam(input.teamId);
    // Turnaj nemá vlastný Match (zápasy turnaja sú samostatné udalosti MATCH s parentEventId).
    // Spätná kompatibilita: starý klient posielal turnaj so súperom → vznikne Match ako doteraz.
    const legacyTournament = input.type === 'TOURNAMENT' && !!input.opponent?.trim() && !input.participants?.length;
    const isMatch = input.type === 'MATCH' || legacyTournament;
    if (input.type === 'TOURNAMENT' && !legacyTournament && !team) throw new BadRequestException('Vyberte družstvo turnaja');
    const pitch = await this.resolvePitch(input.pitchId);
    this.assertEndAfterStart(input.startAt, input.endAt, !!pitch);
    const slots = [{ startAt: input.startAt, endAt: input.endAt }];
    // zdieľanie plochy sa ponúka len pri tréningu; zápas pri obsadenej ploche odmietnuť
    const clashes =
      pitch && !skipPitchCheck
        ? await this.assertPitchFree(pitch.id, slots, { shareable: input.type === 'TRAINING', allowShared: input.allowSharedPitch })
        : [];

    // logo súpera z registra klubov + doplnenie nového súpera do registra
    let opponentLogo: string | null = null;
    if (isMatch && input.opponent) {
      opponentLogo = await this.clubs.logoForName(input.opponent);
      await this.clubs.ensure(input.opponent);
    }

    // cieľové družstvá (rodičovské združenie a pod.) — prázdne = celoklubová udalosť
    const audienceTeamIds = [...new Set(input.audienceTeamIds ?? [])];
    const event = await this.prisma.event.create({
      data: {
        type: input.type,
        seasonId: season.id,
        teamId: team?.id,
        isDemo,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        location: pitch ? pitch.name : input.location,
        address: pitch ? (input.address ?? pitch.address) : input.address,
        surface: pitch ? pitch.surface : input.surface,
        pitchId: pitch?.id,
        isPublic: input.type === 'TRAINING' ? (input.isPublic ?? false) : false,
        createdById,
        match: isMatch
          ? {
              create: {
                opponent: input.opponent ?? 'Neznámy súper',
                isHome: input.isHome ?? true,
                // priateľský zápas: vždy interný (source INTERNAL, bez futbalnetId) — sync ho nemení
                isFriendly: input.type === 'MATCH' && !!input.friendly,
                ...(resolveJerseys(input) ?? { jerseyColors: [], jerseyColor: null }),
                opponentLogo,
              },
            }
          : undefined,
        audienceTeams: audienceTeamIds.length ? { connect: audienceTeamIds.map((id) => ({ id })) } : undefined,
      },
      include: { match: true },
    });

    if (input.type === 'TOURNAMENT' && input.participants?.length) {
      const rows = await resolveParticipantClubs(this.prisma, this.clubs, input.participants);
      await this.prisma.tournamentParticipant.createMany({
        data: rows.map((r, i) => ({ eventId: event.id, clubName: r.clubName, logoUrl: r.logoUrl, sortOrder: i })),
        skipDuplicates: true,
      });
    }

    if (input.type === 'TRAINING' && team) {
      await this.prepareAttendance(event.id, team.id, season.id);
    }
    if (pitch && team && clashes.length > 0) void this.notifySharedPitch(clashes, pitch.name, [team.id], slots).catch(() => undefined);
    return event;
  }

  /**
   * Vytvorí sériu opakovaných tréningov (napr. utorky+piatky 16:00–17:00)
   * ako samostatné udalosti so spoločným recurrenceGroupId.
   */
  async createRecurring(input: CreateRecurringTrainingInput, createdById: string, isDemo = false) {
    const ids = [...new Set(input.teamIds?.length ? input.teamIds : [input.teamId])];
    if (ids.length <= 1) return this.createRecurringOne({ ...input, teamId: ids[0]! }, createdById, isDemo);
    for (const id of ids) await this.resolveTeam(id);
    let created = 0;
    let recurrenceGroupId = '';
    for (const [i, id] of ids.entries()) {
      const r = await this.createRecurringOne({ ...input, teamId: id, teamIds: undefined }, createdById, isDemo, i > 0, ids);
      created += r.created;
      recurrenceGroupId ||= r.recurrenceGroupId;
    }
    return { recurrenceGroupId, created };
  }

  private async createRecurringOne(input: CreateRecurringTrainingInput, createdById: string, isDemo = false, skipPitchCheck = false, groupTeamIds?: string[]) {
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) throw new BadRequestException('Neexistuje aktívna sezóna');
    const team = await this.resolveTeam(input.teamId);
    if (!team) throw new BadRequestException('Vyberte družstvo');

    const occurrences = generateOccurrences({
      weekdays: input.weekdays,
      startTime: input.startTime,
      endTime: input.endTime,
      from: input.from,
      until: input.until,
    });
    if (occurrences.length === 0) {
      throw new BadRequestException('V zadanom období nevznikol žiadny tréning');
    }
    const pitch = await this.resolvePitch(input.pitchId);
    if (pitch && !input.endTime) throw new BadRequestException('Pri vybranej hracej ploche zadajte koniec');
    for (const occ of occurrences) this.assertEndAfterStart(occ.startAt, occ.endAt, !!pitch);
    const clashes =
      pitch && !skipPitchCheck
        ? await this.assertPitchFree(pitch.id, occurrences, { shareable: true, allowShared: input.allowSharedPitch })
        : [];
    const recurrenceGroupId = randomUUID();

    for (const occ of occurrences) {
      const event = await this.prisma.event.create({
        data: {
          type: 'TRAINING',
          seasonId: season.id,
          teamId: team.id,
          isDemo,
          title: input.title,
          startAt: occ.startAt,
          endAt: occ.endAt,
          location: pitch ? pitch.name : input.location,
          address: pitch ? (input.address ?? pitch.address) : input.address,
          surface: pitch ? pitch.surface : input.surface,
          pitchId: pitch?.id,
          recurrenceGroupId,
          isPublic: input.isPublic ?? false,
          createdById,
        },
      });
      await this.prepareAttendance(event.id, team.id, season.id);
    }
    if (pitch && clashes.length > 0) void this.notifySharedPitch(clashes, pitch.name, groupTeamIds ?? [team.id], occurrences).catch(() => undefined);
    return { recurrenceGroupId, created: occurrences.length };
  }

  async update(eventId: string, input: Partial<CreateEventInput>, user: AuthUser) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Udalosť neexistuje');
    if (!canManageTeam(user, event.teamId)) throw new ForbiddenException('Túto udalosť nemôžete upravovať');
    const pitch = await this.resolvePitch(input.pitchId);
    const effectivePitchId = pitch ? pitch.id : input.pitchId === undefined ? event.pitchId : null;
    const newStart = input.startAt ?? event.startAt;
    const newEnd = input.endAt ?? event.endAt;
    // starý klient mení len začiatok → koniec sa nesmie ocitnúť pred novým začiatkom
    if (input.startAt && !input.endAt && newEnd && newEnd.getTime() <= newStart.getTime()) {
      throw new BadRequestException('Koniec musí byť po začiatku');
    }
    this.assertEndAfterStart(newStart, newEnd, !!effectivePitchId && (input.endAt !== undefined || input.pitchId !== undefined));
    // zápas turnaja zdieľa plochu s turnajom (rodič ju rezervuje) → kontrola obsadenosti sa preskočí
    if (effectivePitchId && !event.parentEventId) {
      const clashes = await this.assertPitchFree(effectivePitchId, [{ startAt: newStart, endAt: newEnd }], {
        excludeId: eventId,
        shareable: event.type === 'TRAINING',
        allowShared: input.allowSharedPitch,
      });
      if (clashes.length > 0 && event.teamId) {
        const p = pitch ?? (await this.prisma.pitch.findUnique({ where: { id: effectivePitchId } }));
        if (p) void this.notifySharedPitch(clashes, p.name, [event.teamId], [{ startAt: newStart, endAt: newEnd }]).catch(() => undefined);
      }
    }
    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        location: pitch ? pitch.name : input.location,
        address: pitch ? (input.address ?? pitch.address) : input.address,
        surface: pitch ? pitch.surface : input.surface,
        pitchId: pitch ? pitch.id : undefined,
        // verejnosť len pre tréning; pri iných typoch ignoruj
        isPublic: event.type === 'TRAINING' ? input.isPublic : undefined,
      },
    });
    // priateľský zápas sa dá prepnúť len pri internom zápase (futbalnet zápas je vždy súťažný)
    if (input.friendly !== undefined && event.type === 'MATCH' && event.source === 'INTERNAL') {
      await this.prisma.match.updateMany({ where: { eventId }, data: { isFriendly: input.friendly } });
    }
    // zmena termínu → e-mail dotknutým (chyba pri odosielaní nesmie zhodiť uloženie)
    const time = (d: Date | null) => (d ? d.getTime() : null);
    if (time(event.startAt) !== time(updated.startAt) || time(event.endAt) !== time(updated.endAt)) {
      void this.notifyRescheduled(event, updated).catch(() => undefined);
    }
    return updated;
  }

  /**
   * Oznam o zmene termínu: tréning → hráči družstva, ich rodičia a tréneri družstva;
   * zápas/turnaj → nominovaní hráči, ich rodičia a tréneri družstva.
   */
  private async notifyRescheduled(
    before: { startAt: Date; endAt: Date | null; type: string; teamId: string | null },
    after: { id: string; startAt: Date; endAt: Date | null; type: string; teamId: string | null; title: string; location: string | null },
  ) {
    if (!after.teamId || after.startAt.getTime() < Date.now()) return;
    const isMatch = after.type === 'MATCH' || after.type === 'TOURNAMENT';
    if (!isMatch && after.type !== 'TRAINING') return;

    const memberSelect = {
      user: { select: { email: true } },
      guardians: { select: { user: { select: { email: true } } } },
    } as const;
    let members: Array<{ user: { email: string | null } | null; guardians: Array<{ user: { email: string | null } }> }>;
    let heading: string;
    if (isMatch) {
      const match = await this.prisma.match.findUnique({
        where: { eventId: after.id },
        select: {
          nominations: { where: { status: { not: 'REMOVED' } }, select: { member: { select: memberSelect } } },
        },
      });
      members = (match?.nominations ?? []).map((n) => n.member);
      heading = 'Zmena termínu zápasu';
    } else {
      members = await this.prisma.member.findMany({
        where: { memberships: { some: { teamId: after.teamId, season: { isActive: true }, leftAt: null } } },
        select: memberSelect,
      });
      heading = 'Zmena termínu tréningu';
    }
    const coaches = await this.prisma.userRole.findMany({
      where: { role: 'COACH', teamId: after.teamId },
      select: { user: { select: { email: true } } },
    });

    const emails = new Set<string>();
    const add = (e?: string | null) => e && emails.add(e.trim().toLowerCase());
    for (const m of members) {
      add(m.user?.email);
      for (const g of m.guardians) add(g.user.email);
    }
    for (const c of coaches) add(c.user.email);
    if (emails.size === 0) return;

    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const range = (a: Date, b: Date | null) => formatEventDateTimeSk(a) + (b ? `–${formatEventTimeSk(b)}` : '');
    const row = (k: string, v: string) => `<tr><td style="color:#6b7280;padding:2px 8px 2px 0">${k}</td><td>${v}</td></tr>`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#16223c">
        <h2 style="color:#1a2848">${heading}</h2>
        <table style="margin:10px 0;font-size:15px">
          ${row('Udalosť:', `<strong>${esc(after.title)}</strong>`)}
          ${row('Pôvodný termín:', `<s>${esc(range(before.startAt, before.endAt))}</s>`)}
          ${row('Nový termín:', `<strong>${esc(range(after.startAt, after.endAt))}</strong>`)}
          ${after.location ? row('Kde:', esc(after.location)) : ''}
        </table>
        <p><a href="https://fkknv.sk/prihlasenie" style="display:inline-block;background:#2b4278;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Otvoriť portál</a></p>
      </div>`;
    const subject = `${heading} — ${after.title}`;
    for (const to of emails) await this.email.send([to], subject, html);
  }

  /** Zmaže udalosť; pre opakovaný tréning voliteľne celú budúcu sériu. */
  async remove(eventId: string, scope: 'one' | 'future', user: AuthUser) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Udalosť neexistuje');
    if (!canManageTeam(user, event.teamId)) throw new ForbiddenException('Túto udalosť nemôžete odstrániť');
    if (scope === 'future' && event.recurrenceGroupId) {
      const res = await this.prisma.event.deleteMany({
        where: { recurrenceGroupId: event.recurrenceGroupId, startAt: { gte: event.startAt } },
      });
      return { deleted: res.count };
    }
    await this.prisma.event.delete({ where: { id: eventId } });
    return { deleted: 1 };
  }

  async attendance(eventId: string, user: AuthUser) {
    // Aktuálny zoznam hráčov: doplní do dochádzky členov, ktorí pribudli do
    // družstva po vytvorení udalosti (chýbajúce riadky sa pridajú, existujúce
    // ostanú aj s už zaznamenaným stavom). Nikoho neodstraňuje.
    const base = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, teamId: true, seasonId: true },
    });
    if (!base) throw new NotFoundException('Udalosť neexistuje');
    // Detail tréningu (dochádzku) smie otvoriť len vedenie klubu a tréner daného
    // družstva — rodič/hráč nemá vidieť dochádzku iných detí.
    if (!canManageTeam(user, base.teamId)) throw new ForbiddenException('Dochádzka je len pre tréner družstva a vedenie');
    if (base.teamId) await this.prepareAttendance(base.id, base.teamId, base.seasonId);

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        team: { include: { teamCategory: true } },
        attendances: {
          include: { member: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!event) throw new NotFoundException('Udalosť neexistuje');
    // zoradenie podľa slovenskej abecedy (databáza radí Š/Č/Ž podľa kódu znaku, nie abecedy)
    event.attendances.sort((a, b) => bySlovakName(a.member, b.member));
    // vyradení hráči (už nie sú v družstve) sa v nezapísanej dochádzke nezobrazujú
    if (event.teamId) {
      const active = await this.activeMemberKeys(event.teamId, [event.seasonId]);
      event.attendances = event.attendances.filter(
        (a) => a.status !== 'UNKNOWN' || active.has(`${event.seasonId}:${a.memberId}`),
      );
    }
    return event;
  }

  async markAttendance(eventId: string, input: MarkAttendanceInput, user: AuthUser) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { teamId: true } });
    if (!event) throw new NotFoundException('Udalosť neexistuje');
    if (coachBlockedFromTeam(user, event.teamId)) throw new ForbiddenException('Dochádzku môžete zapisovať len svojmu družstvu');
    return this.prisma.attendance.upsert({
      where: { eventId_memberId: { eventId, memberId: input.memberId } },
      create: { eventId, memberId: input.memberId, status: input.status, markedById: user.id, markedAt: new Date() },
      update: { status: input.status, markedById: user.id, markedAt: new Date() },
    });
  }

  /** Dochádzková štatistika hráča v družstve (počet a % prítomnosti na tréningoch). */
  async teamAttendanceStats(teamId: string) {
    const events = await this.prisma.event.findMany({
      where: { teamId, type: 'TRAINING' },
      select: { id: true, seasonId: true },
    });
    const eventIds = events.map((e) => e.id);
    if (eventIds.length === 0) return [];
    const seasonOf = new Map(events.map((e) => [e.id, e.seasonId]));
    const active = await this.activeMemberKeys(teamId, [...new Set(events.map((e) => e.seasonId))]);
    const attendances = (
      await this.prisma.attendance.findMany({
        where: { eventId: { in: eventIds } },
        include: { member: { select: { id: true, firstName: true, lastName: true } } },
      })
    ).filter((a) => a.status !== 'UNKNOWN' || active.has(`${seasonOf.get(a.eventId)}:${a.memberId}`));
    const byMember = new Map<string, { name: string; present: number; counted: number }>();
    for (const a of attendances) {
      const entry = byMember.get(a.memberId) ?? {
        name: `${a.member.lastName} ${a.member.firstName}`,
        present: 0,
        counted: 0,
      };
      if (a.status !== 'UNKNOWN') {
        entry.counted++;
        if (a.status === 'PRESENT') entry.present++;
      }
      byMember.set(a.memberId, entry);
    }
    return [...byMember.entries()]
      .map(([memberId, s]) => ({
        memberId,
        name: s.name,
        present: s.present,
        counted: s.counted,
        pct: s.counted > 0 ? Math.round((s.present / s.counted) * 100) : 0,
      }))
      .sort((a, b) => b.pct - a.pct);
  }

  /**
   * Dochádzkový list družstva za zvolený mesiac: stĺpce = tréningy (dátumy),
   * riadky = hráči, bunka = stav na tréningu; posledný stĺpec = súhrn počtov.
   * `month` je vo formáte "YYYY-MM"; čas tréningov je vedený ako UTC wall-clock.
   */
  async attendanceSheet(teamId: string, month: string) {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) throw new BadRequestException('Neplatný mesiac (očakáva YYYY-MM)');
    const year = Number(match[1]);
    const mon = Number(match[2]); // 1-12
    const from = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0));
    const to = new Date(Date.UTC(year, mon, 1, 0, 0, 0)); // začiatok ďalšieho mesiaca

    const trainings = await this.prisma.event.findMany({
      where: { teamId, type: 'TRAINING', startAt: { gte: from, lt: to } },
      select: { id: true, startAt: true, seasonId: true },
      orderBy: { startAt: 'asc' },
    });

    const eventIds = trainings.map((t) => t.id);
    const seasonOf = new Map(trainings.map((t) => [t.id, t.seasonId]));
    const active = await this.activeMemberKeys(teamId, [...new Set(trainings.map((t) => t.seasonId))]);
    const attendances = (
      eventIds.length
        ? await this.prisma.attendance.findMany({
            where: { eventId: { in: eventIds } },
            include: { member: { select: { id: true, firstName: true, lastName: true } } },
          })
        : []
    ).filter((a) => a.status !== 'UNKNOWN' || active.has(`${seasonOf.get(a.eventId)}:${a.memberId}`));

    const STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED', 'INJURED', 'SICK'] as const;
    const members = new Map<
      string,
      { id: string; firstName: string; lastName: string; cells: Record<string, string>; summary: Record<string, number> }
    >();
    for (const a of attendances) {
      let m = members.get(a.memberId);
      if (!m) {
        m = {
          id: a.member.id,
          firstName: a.member.firstName,
          lastName: a.member.lastName,
          cells: {},
          summary: Object.fromEntries(STATUSES.map((s) => [s, 0])),
        };
        members.set(a.memberId, m);
      }
      m.cells[a.eventId] = a.status;
      if (a.status !== 'UNKNOWN' && a.status in m.summary) m.summary[a.status]!++;
    }

    const rows = [...members.values()].sort((x, y) =>
      `${x.lastName} ${x.firstName}`.localeCompare(`${y.lastName} ${y.firstName}`, 'sk'),
    );
    return { trainings: trainings.map(({ id, startAt }) => ({ id, startAt })), rows };
  }
}
