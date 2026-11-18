import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  categoryForBirthDate,
  ROLES,
  type CategoryCode,
  type CoachUpdateMemberInput,
  type CreateMemberInput,
  type MemberStatus,
  type Role,
} from '@fkknv/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../auth/accounts.service';
import { GoalkeepersService } from '../goalkeepers/goalkeepers.service';
import { PushService } from '../notifications/push.service';
import { IssfService } from '../integrations/issf/issf.service';
import { parseRosterXlsx, type RosterRow } from './roster-import';
import type { Member as MemberRecord } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';
import { coachTeamIds, isStaff } from '../auth/scope';

/** Pravidlo zaradenia do kategórie + predvolené družstvo (pre import). */
interface AssignRule {
  categoryCode: CategoryCode;
  birthYearFrom: number;
  birthYearTo: number | null;
  teamCategoryId: string;
  defaultTeamId: string | null;
  defaultTeamName: string | null;
}

const activeMembership = {
  where: { leftAt: null, season: { isActive: true } },
  include: { team: { include: { teamCategory: true } } },
} as const;

const accountInclude = {
  // automatické COACH roly na skupinách brankárov sa v zozname/formulári neukazujú
  user: { select: { id: true, email: true, roles: { where: { NOT: { team: { isGoalkeeperGroup: true } } }, select: { role: true, teamId: true } } } },
} as const;

/** Porovnanie podľa slovenskej abecedy — priezvisko, potom meno (č za c, š za s, ž za z…). */
export function bySlovakName(
  a: { lastName: string; firstName: string },
  b: { lastName: string; firstName: string },
): number {
  return a.lastName.localeCompare(b.lastName, 'sk') || a.firstName.localeCompare(b.firstName, 'sk');
}

export interface AccountResult {
  email: string;
  tempPassword: string | null;
  created: boolean;
}

/** Popisky polí registračného preukazu pre náhľad ISSF synchronizácie. */
const ROSTER_FIELD_LABELS: Record<string, string> = {
  firstName: 'Meno',
  lastName: 'Priezvisko',
  birthDate: 'Dátum narodenia',
  status: 'Stav',
  registrationNumber: 'Registračné číslo',
  registrationValidUntil: 'Platnosť preukazu do',
  registeredAt: 'Dátum registrácie',
  homeClub: 'Materský klub',
  guestClub: 'Hosťujúci klub',
  clubAffiliation: 'Klubová príslušnosť',
};

/** Zhodujú sa dva dátumy v kalendárnom dni (UTC)? Rozdielna časová zložka sa ignoruje. */
function sameUtcDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Normalizovaný kľúč hodnoty poľa (na porovnanie s uloženým „ignorovaným" rozdielom). */
function rosterValueKey(value: unknown): string {
  if (value == null || value === '') return '';
  if (value instanceof Date) return `${value.getUTCFullYear()}-${value.getUTCMonth() + 1}-${value.getUTCDate()}`;
  return String(value).trim();
}

/** Zobrazí hodnotu poľa (dátum ako d.m.yyyy z UTC) pre náhľad rozdielov. */
function fmtRosterValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (value instanceof Date) return `${value.getUTCDate()}. ${value.getUTCMonth() + 1}. ${value.getUTCFullYear()}`;
  return String(value);
}

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);
  /** krátkodobá vyrovnávacia pamäť posledného ISSF fetchu (preview → apply bez 2. loginu) */
  private issfCache: { at: number; rows: RosterRow[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly push: PushService,
    private readonly issf: IssfService,
    private readonly goalkeepers: GoalkeepersService,
  ) {}

  async list(params: {
    categoryCode?: string;
    teamId?: string;
    teamIds?: string[]; // scope pre trénera (jeho družstvá)
    seasonId?: string;
    status?: string;
    role?: string; // filter podľa funkcie: PLAYER | PARENT | COACH | MANAGER | ADMIN
    hideInactive?: boolean; // skryť neaktívnych (ponechá ACTIVE + GUEST)
    isDemo?: boolean; // demo konto vidí len demo členov; ostatní len ostrých
  }) {
    const and: Array<Record<string, unknown>> = [{ isDemo: params.isDemo ?? false }];
    if (params.status) and.push({ status: params.status as MemberStatus });
    else if (params.hideInactive) and.push({ status: { not: 'INACTIVE' as MemberStatus } });

    // scope na družstvo/kategóriu: hráči v družstve ALEBO rodičia dieťaťa v družstve
    const hasScope = params.categoryCode || params.teamId || params.teamIds;
    const teamConstraint = {
      id: params.teamId ? params.teamId : params.teamIds ? { in: params.teamIds } : undefined,
      teamCategory: params.categoryCode ? { code: params.categoryCode } : undefined,
    };
    const teamFilter = {
      leftAt: null,
      season: params.seasonId ? { id: params.seasonId } : { isActive: true },
      team: teamConstraint,
    } as const;
    if (hasScope) {
      and.push({
        OR: [
          { memberships: { some: teamFilter } }, // hráč v družstve
          // tréner družstva (scope na konte)
          { user: { roles: { some: { role: 'COACH' as never, team: teamConstraint } } } },
          // rodič dieťaťa, ktoré je v družstve
          { user: { guardianOf: { some: { member: { memberships: { some: teamFilter } } } } } },
        ],
      });
    }

    // filter podľa roly/funkcie
    if (params.role === 'PLAYER') {
      // hráč = má zaradenie do družstva a jeho konto (ak existuje) nie je vedenie/tréner/rodič
      and.push({ memberships: { some: { leftAt: null, season: { isActive: true } } } });
      and.push({ NOT: { user: { roles: { some: { role: { in: ['ADMIN', 'MANAGER', 'COACH', 'GK_COACH', 'PARENT'] as never } } } } } });
    } else if (params.role) {
      and.push({ user: { roles: { some: { role: params.role as never } } } });
    }

    const members = await this.prisma.member.findMany({
      where: and.length ? { AND: and } : undefined,
      include: {
        memberships: activeMembership,
        ...accountInclude,
        guardians: {
          include: { user: { select: { firstName: true, lastName: true, email: true, phone: true } } },
        },
      },
    });
    // triedenie podľa slovenskej abecedy (č za c, š za s, ž za z…)
    return members.sort(bySlovakName);
  }

  async get(id: string) {
    const member = await this.prisma.member.findUnique({
      where: { id },
      include: {
        memberships: {
          include: { team: { include: { teamCategory: true } }, season: true },
          orderBy: { joinedAt: 'desc' },
        },
        user: {
          select: {
            id: true,
            email: true,
            roles: { where: { NOT: { team: { isGoalkeeperGroup: true } } }, select: { role: true, teamId: true } },
            // deti, ktoré má rodič (konto) priradené (väzba Guardian)
            guardianOf: {
              include: {
                member: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    status: true,
                    memberships: activeMembership,
                  },
                },
              },
            },
          },
        },
        guardians: {
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
        },
        paymentObligations: { orderBy: { dueDate: 'desc' }, take: 24 },
      },
    });
    if (!member) throw new NotFoundException('Člen neexistuje');

    // deti, ktoré rodič uviedol pri registrácii (podľa e-mailu konta) — na kontrolu,
    // či sú všetky uvedené deti priradené
    const requestedChildren = await this.requestedChildrenForParent(member.user?.email ?? null);

    // priradené deti (väzba Guardian) — pre prehľad na karte rodiča
    const assignedChildren = (member.user?.guardianOf ?? []).map((g) => ({
      id: g.member.id,
      firstName: g.member.firstName,
      lastName: g.member.lastName,
      status: g.member.status,
      relation: g.relation,
      team: g.member.memberships[0]?.team.name ?? null,
    }));

    return { ...member, assignedChildren, requestedChildren };
  }

  /**
   * Deti uvedené rodičom pri registrácii (podľa e-mailu jeho konta): z prihlášok
   * typu CHILD (meno dieťaťa) aj z poznámky pri type PARENT (deti sú už členmi).
   * Slúži na overenie, či sú všetky uvedené deti aj reálne priradené.
   */
  private async requestedChildrenForParent(email: string | null) {
    if (!email) return { children: [] as Array<{ firstName: string; lastName: string; birthDate: Date | null; status: string }>, note: null as string | null };
    const reqs = await this.prisma.registrationRequest.findMany({
      where: { parentEmail: { equals: email, mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
      select: {
        applicantType: true,
        childFirstName: true,
        childLastName: true,
        childBirthDate: true,
        parentChildrenNote: true,
        status: true,
      },
    });
    const children = reqs
      .filter((r) => r.childFirstName && r.childLastName)
      .map((r) => ({
        firstName: r.childFirstName as string,
        lastName: r.childLastName as string,
        birthDate: r.childBirthDate,
        status: r.status,
      }));
    // poznámka o už existujúcich deťoch (type PARENT) — voľný text
    const note = reqs.map((r) => r.parentChildrenNote).find((n): n is string => !!n && n.trim().length > 0) ?? null;
    return { children, note };
  }

  /**
   * Nastaví zaradenie člena do skupín v aktívnej sezóne na presne dané družstvá
   * (manuálna výnimka). Hráč môže byť vo viacerých skupinách naraz. Prázdny
   * zoznam odstráni všetky zaradenia v sezóne.
   */
  private async syncTeams(memberId: string, teamIds: string[]) {
    const season = await this.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) throw new BadRequestException('Neexistuje aktívna sezóna');
    const unique = [...new Set(teamIds)];
    if (unique.length > 0) {
      const count = await this.prisma.team.count({ where: { id: { in: unique } } });
      if (count !== unique.length) throw new BadRequestException('Niektoré družstvo neexistuje');
    }
    // odstráň zaradenia, ktoré už nie sú vo výbere
    // skupiny brankárov sa plnia automaticky — ručné zaradenie sa ich nedotýka
    await this.prisma.teamMembership.deleteMany({
      where: { memberId, seasonId: season.id, teamId: { notIn: unique.length ? unique : ['__none__'] }, team: { isGoalkeeperGroup: false } },
    });
    // pridaj/označ vybrané ako manuálne výnimky
    for (const teamId of unique) {
      await this.prisma.teamMembership.upsert({
        where: { memberId_seasonId_teamId: { memberId, seasonId: season.id, teamId } },
        create: { memberId, seasonId: season.id, teamId, isException: true },
        update: { isException: true, leftAt: null },
      });
    }
  }

  /**
   * Rozhodne o zaradení do družstiev podľa roly: hráč → hráčske zaradenie
   * (TeamMembership), tréner (bez roly hráč) → žiadne hráčske zaradenie (jeho
   * družstvá sú scope na konte, rieši applyAccount). Ak teamIds/teamId nie sú
   * zadané pri editácii, zaradenie sa nemení.
   */
  private async assignTeamsForRole(memberId: string, input: Partial<CreateMemberInput>) {
    const roles = input.roles ?? [];
    const coachOnly = roles.includes('COACH') && !roles.includes('PLAYER');
    if (coachOnly) {
      // tréner nie je hráč — odstráň prípadné hráčske zaradenia
      await this.syncTeams(memberId, []);
      return;
    }
    if (input.teamIds) await this.syncTeams(memberId, input.teamIds);
    else if (input.teamId) await this.syncTeams(memberId, [input.teamId]);
  }

  /** Vytvorí/prepojí konto člena a nastaví roly. Vráti dočasné heslo pri novom konte. */
  private async applyAccount(
    member: { id: string; firstName: string; lastName: string; userId: string | null },
    input: CreateMemberInput,
    actorRoles: Role[],
  ): Promise<AccountResult | null> {
    const roles = (input.roles ?? []) as Role[];
    // pri trénerovi sú vybrané družstvá jeho scope (nie hráčske zaradenie)
    const coachTeamIds = roles.includes('COACH')
      ? (input.teamIds ?? (input.teamId ? [input.teamId] : []))
      : undefined;
    // roly, ktoré aktér smie meniť (admin všetky, ostatní bez ADMIN/MANAGER)
    const allowedRoles: Role[] = actorRoles.includes('ADMIN')
      ? ([...ROLES] as Role[])
      : (['PLAYER', 'PARENT', 'COACH', 'GK_COACH'] as Role[]);
    const STAFF_ROLES: Role[] = ['COACH', 'GK_COACH', 'MANAGER', 'ADMIN'];
    // konto sa vytvára len ak je zadaný e-mail
    if (!input.account?.email) {
      // konto existuje a roly sa menia (aj odobratie) → nastav ich presne
      if (member.userId && input.roles !== undefined) {
        await this.accounts.syncRoles(member.userId, roles, coachTeamIds, allowedRoles);
      } else if (!member.userId && roles.some((r) => STAFF_ROLES.includes(r))) {
        // tréner/vedúci/admin musí mať konto, inak sa jeho funkcia nemá kde uložiť
        throw new BadRequestException('Tréner alebo vedúci klubu potrebuje prihlasovacie konto — zadajte e-mail.');
      }
      return null;
    }
    const result = await this.accounts.ensureAccount({
      email: input.account.email,
      phone: input.account.phone,
      firstName: member.firstName,
      lastName: member.lastName,
      roles: roles.length ? roles : ['PLAYER'],
      coachTeamIds,
      allowedRoles,
    });
    // prepoj člena s kontom (ak ešte nie je a konto nie je použité iným členom)
    if (!member.userId) {
      const linkedElsewhere = await this.prisma.member.findFirst({
        where: { userId: result.userId, id: { not: member.id } },
      });
      if (!linkedElsewhere) {
        await this.prisma.member.update({ where: { id: member.id }, data: { userId: result.userId } });
      }
    }
    return { email: result.email, tempPassword: result.tempPassword, created: result.created };
  }

  /** Admin: vygeneruje nové jednorazové heslo pre konto člena. */
  async resetAccountPassword(memberId: string) {
    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Člen neexistuje');
    if (!member.userId) throw new BadRequestException('Člen nemá prihlasovacie konto');
    const account = await this.prisma.user.findUnique({ where: { id: member.userId }, select: { email: true } });
    const { tempPassword } = await this.accounts.resetPassword(member.userId);
    return { email: account?.email ?? null, tempPassword };
  }

  /** Zoznam rodičov (členovia s kontom a rolou PARENT) na priradenie k dieťaťu. */
  async listParents(isDemo = false) {
    const parents = await this.prisma.member.findMany({
      where: { isDemo, userId: { not: null }, user: { roles: { some: { role: 'PARENT' } } } },
      select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } },
    });
    return parents.sort(bySlovakName);
  }

  /** Priradí rodiča k dieťaťu (väzba Guardian). Robí vedenie alebo tréner družstva dieťaťa. */
  async addGuardian(childId: string, parentMemberId: string, relation: string) {
    const child = await this.prisma.member.findUnique({ where: { id: childId } });
    if (!child) throw new NotFoundException('Dieťa neexistuje');
    const parent = await this.prisma.member.findUnique({ where: { id: parentMemberId } });
    if (!parent?.userId) throw new BadRequestException('Rodič musí mať prihlasovacie konto');
    if (parentMemberId === childId) throw new BadRequestException('Neplatné priradenie');
    const rel = (['MOTHER', 'FATHER', 'GUARDIAN', 'RELATIVE'] as const).includes(relation as never)
      ? (relation as 'MOTHER' | 'FATHER' | 'GUARDIAN' | 'RELATIVE')
      : 'GUARDIAN';
    await this.prisma.guardian.upsert({
      where: { userId_memberId: { userId: parent.userId, memberId: childId } },
      create: { userId: parent.userId, memberId: childId, relation: rel },
      update: { relation: rel },
    });
    return { linked: true };
  }

  /** Zruší väzbu rodič ↔ dieťa. */
  async removeGuardian(childId: string, userId: string) {
    await this.prisma.guardian.deleteMany({ where: { memberId: childId, userId } });
    return { removed: true };
  }

  /** Priradí členovi (rodičovi) existujúce deti — vytvorí väzby Guardian. Vyžaduje konto. */
  private async linkChildren(parentMemberId: string, childMemberIds: string[]) {
    if (childMemberIds.length === 0) return;
    const parent = await this.prisma.member.findUnique({ where: { id: parentMemberId } });
    if (!parent?.userId) {
      throw new BadRequestException('Rodič musí mať prihlasovacie konto, aby sa mu dali priradiť deti');
    }
    for (const childId of childMemberIds) {
      if (childId === parentMemberId) continue;
      await this.prisma.guardian.upsert({
        where: { userId_memberId: { userId: parent.userId, memberId: childId } },
        create: { userId: parent.userId, memberId: childId, relation: 'GUARDIAN' },
        update: {},
      });
    }
  }

  async create(input: CreateMemberInput, actorRoles: Role[], isDemo = false) {
    if (input.roles?.length) this.assertGrant(actorRoles, input.roles);
    const member = await this.prisma.member.create({
      data: {
        isDemo,
        firstName: input.firstName,
        lastName: input.lastName,
        birthDate: input.birthDate,
        status: input.status,
        futbalnetId: input.futbalnetId,
        healthNotes: input.healthNotes,
        socialCase: input.socialCase,
        isGoalkeeper: input.isGoalkeeper,
        position: input.position,
        licenseLevel: input.licenseLevel,
        registrationNumber: input.registrationNumber,
        homeClub: input.homeClub,
        guestClub: input.guestClub,
        clubAffiliation: input.clubAffiliation,
        registrationValidUntil: input.registrationValidUntil,
        registeredAt: input.registeredAt,
      },
    });
    await this.assignTeamsForRole(member.id, input);
    const account = await this.applyAccount({ ...member, userId: null }, input, actorRoles);
    if (input.childMemberIds?.length) await this.linkChildren(member.id, input.childMemberIds);
    await this.goalkeepers.sync().catch(() => undefined);
    return { member: await this.get(member.id), account };
  }

  async update(id: string, input: Partial<CreateMemberInput>, actorRoles: Role[]) {
    const existing = await this.get(id);
    if (input.roles?.length) this.assertGrant(actorRoles, input.roles as Role[]);
    await this.prisma.member.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        birthDate: input.birthDate,
        status: input.status,
        futbalnetId: input.futbalnetId,
        healthNotes: input.healthNotes,
        socialCase: input.socialCase,
        isGoalkeeper: input.isGoalkeeper,
        position: input.position,
        licenseLevel: input.licenseLevel,
        registrationNumber: input.registrationNumber,
        homeClub: input.homeClub,
        guestClub: input.guestClub,
        clubAffiliation: input.clubAffiliation,
        registrationValidUntil: input.registrationValidUntil,
        registeredAt: input.registeredAt,
      },
    });
    await this.assignTeamsForRole(id, input);
    const account = await this.applyAccount(
      { id, firstName: input.firstName ?? existing.firstName, lastName: input.lastName ?? existing.lastName, userId: existing.userId },
      input as CreateMemberInput,
      actorRoles,
    );
    if (input.childMemberIds?.length) await this.linkChildren(id, input.childMemberIds);
    await this.goalkeepers.sync().catch(() => undefined);
    return { member: await this.get(id), account };
  }

  /** Nastaví súhlasy so zverejnením na webe (fotografia vyžaduje súhlas s menom). */
  async setPublicConsent(id: string, input: { profile: boolean; photo: boolean }, actorId: string) {
    if (input.photo && !input.profile) {
      throw new BadRequestException('Súhlas s fotografiou vyžaduje súhlas so zverejnením mena');
    }
    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) throw new NotFoundException('Člen neexistuje');
    const changed =
      member.publicProfileConsent !== input.profile || member.publicPhotoConsent !== input.photo;
    const updated = changed
      ? await this.prisma.member.update({
          where: { id },
          data: {
            publicProfileConsent: input.profile,
            publicPhotoConsent: input.photo,
            publicConsentAt: new Date(),
          },
        })
      : member;
    if (changed) {
      await this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: 'MEMBER_PUBLIC_CONSENT',
          entity: 'Member',
          entityId: id,
          diff: {
            from: { profile: member.publicProfileConsent, photo: member.publicPhotoConsent },
            to: input,
          },
        },
      });
    }
    return {
      id: updated.id,
      publicProfileConsent: updated.publicProfileConsent,
      publicPhotoConsent: updated.publicPhotoConsent,
      publicConsentAt: updated.publicConsentAt,
    };
  }

  /** Natrvalo odstráni člena (kaskádovo aj členstvá, dochádzku, poplatky, nominácie…). */
  async remove(id: string) {
    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) throw new NotFoundException('Člen neexistuje');
    await this.prisma.member.delete({ where: { id } });
    return { deleted: true };
  }

  private assertGrant(actorRoles: Role[], roles: Role[]) {
    this.accounts.assertCanGrant({ id: '', email: '', isDemo: false, roles: actorRoles.map((role) => ({ role, teamId: null })) }, roles);
  }

  /** Uloží/nahradí fotku hráča (data URL) a nastaví jeho photoUrl. */
  async setPhoto(memberId: string, dataUrl: string) {
    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Člen neexistuje');
    await this.prisma.memberPhoto.upsert({
      where: { memberId },
      create: { memberId, dataUrl },
      update: { dataUrl },
    });
    await this.prisma.member.update({ where: { id: memberId }, data: { photoUrl: `/members/${memberId}/photo` } });
    return { photoUrl: `/members/${memberId}/photo` };
  }

  /** Vráti fotku hráča ako data URL (alebo null). */
  async getPhoto(memberId: string): Promise<string | null> {
    const p = await this.prisma.memberPhoto.findUnique({ where: { memberId } });
    return p?.dataUrl ?? null;
  }

  /** Dochádzka hráča na tréningoch a zápasoch (najnovšie prvé) + súhrn podľa stavu. */
  async attendanceOf(memberId: string) {
    const rows = await this.prisma.attendance.findMany({
      where: { memberId, event: { type: { in: ['TRAINING', 'MATCH'] } } },
      include: { event: { select: { id: true, type: true, title: true, startAt: true, team: { select: { name: true } } } } },
      orderBy: { event: { startAt: 'desc' } },
      take: 300,
    });
    const items = rows.map((a) => ({
      eventId: a.event.id,
      type: a.event.type,
      title: a.event.title,
      team: a.event.team?.name ?? null,
      startAt: a.event.startAt.toISOString(),
      status: a.status,
    }));
    const summary: Record<string, number> = {};
    for (const i of items) if (i.status !== 'UNKNOWN') summary[i.status] = (summary[i.status] ?? 0) + 1;
    return { items, summary };
  }

  /**
   * Úprava hráča trénerom. Tréner smie upraviť len hráča zo svojho družstva a
   * hráčske skupiny len v rámci svojich nebrankárskych družstiev (`teamIds` = požadovaná
   * množina týchto družstiev; cudzie družstvá hráča sa nemenia). Vedenie smie nastaviť
   * ľubovoľné nebrankárske družstvá. Skupiny brankárov sa plnia automaticky — nedotýkame sa ich.
   */
  async coachUpdate(id: string, input: CoachUpdateMemberInput, user: AuthUser) {
    const staff = isStaff(user);
    const own = coachTeamIds(user);
    if (!staff && !(await this.memberInTeams(id, own))) {
      throw new ForbiddenException('Hráč nie je vo vašom družstve');
    }
    const member = await this.prisma.member.findUnique({ where: { id }, select: { id: true, isDemo: true } });
    if (!member) throw new NotFoundException('Člen neexistuje');
    if (member.isDemo !== user.isDemo) throw new ForbiddenException('Člen neexistuje');

    let toRemove: string[] = [];
    let toAdd: string[] = [];
    let seasonId = '';
    if (input.teamIds !== undefined) {
      const season = await this.prisma.season.findFirst({ where: { isActive: true } });
      if (!season) throw new BadRequestException('Neexistuje aktívna sezóna');
      seasonId = season.id;
      const desired = [...new Set(input.teamIds)];
      // družstvá, ktoré smie volajúci meniť (nebrankárske; tréner len vlastné)
      const managedTeams = await this.prisma.team.findMany({
        where: { isGoalkeeperGroup: false, ...(staff ? {} : { id: { in: own } }) },
        select: { id: true },
      });
      const managed = new Set(managedTeams.map((t) => t.id));
      if (desired.some((t) => !managed.has(t))) {
        throw new BadRequestException(
          staff ? 'Niektoré družstvo neexistuje alebo je skupina brankárov' : 'Môžete vybrať len svoje družstvá (bez skupín brankárov)',
        );
      }
      const current = await this.prisma.teamMembership.findMany({
        where: { memberId: id, seasonId, leftAt: null },
        select: { teamId: true, team: { select: { isGoalkeeperGroup: true } } },
      });
      const currentIds = current.map((c) => c.teamId);
      toRemove = currentIds.filter((t) => managed.has(t) && !desired.includes(t));
      toAdd = desired.filter((t) => !currentIds.includes(t));
      const remainingNonGk = current.filter((c) => !c.team.isGoalkeeperGroup && !toRemove.includes(c.teamId)).length;
      if (remainingNonGk + toAdd.length === 0) {
        throw new BadRequestException('Hráč musí zostať aspoň v jednom družstve');
      }
    }

    const data: Record<string, unknown> = {};
    if (input.position !== undefined) data.position = input.position;
    if (input.socialCase !== undefined) data.socialCase = input.socialCase;
    if (input.healthNotes !== undefined) data.healthNotes = input.healthNotes?.trim() ? input.healthNotes : null;
    if (Object.keys(data).length) await this.prisma.member.update({ where: { id }, data });

    if (toRemove.length) {
      await this.prisma.teamMembership.deleteMany({ where: { memberId: id, seasonId, teamId: { in: toRemove } } });
    }
    for (const teamId of toAdd) {
      await this.prisma.teamMembership.upsert({
        where: { memberId_seasonId_teamId: { memberId: id, seasonId, teamId } },
        create: { memberId: id, seasonId, teamId, isException: true },
        update: { isException: true, leftAt: null },
      });
    }

    if (input.teamIds !== undefined || input.position !== undefined) {
      await this.goalkeepers.sync().catch((e) => this.logger.warn(`Synchronizácia skupín brankárov zlyhala: ${e instanceof Error ? e.message : e}`));
    }
    return this.get(id);
  }

  /** Je člen v niektorom z uvedených družstiev v aktívnej sezóne? (scope trénera) */
  async memberInTeams(memberId: string, teamIds: string[]): Promise<boolean> {
    if (teamIds.length === 0) return false;
    const count = await this.prisma.teamMembership.count({
      where: { memberId, leftAt: null, season: { isActive: true }, teamId: { in: teamIds } },
    });
    return count > 0;
  }

  // -------------------------------------------------------------------------
  // Import hráčov z Excelu (idempotentný upsert)
  // -------------------------------------------------------------------------

  /**
   * Naimportuje/aktualizuje hráčov z Excelu (export z futbalnetu).
   *
   * Idempotentné a bez duplikátov: každý riadok sa napáruje na existujúceho
   * člena najprv podľa registračného čísla (unikátne), inak podľa
   * mena + priezviska + dátumu narodenia. Existujúci sa len aktualizuje o
   * údaje z registračného preukazu — konto, roly ani zaradenie do družstva sa
   * nedotýkajú. Nespárovaný riadok vytvorí nového člena (bez konta — účet sa
   * dopĺňa neskôr cez úpravu člena, keď je známy e-mail).
   *
   * Import zámerne nevytvára prihlasovacie kontá: Excel neobsahuje e-maily.
   * Kontá sa vytvárajú cielene (úprava člena / schválenie registrácie), pričom
   * sa napárujú na už naimportovaného člena, takže nevznikajú duplicity.
   *
   * Každý naimportovaný člen je hráč: zaradí sa do družstva podľa ročníka
   * (predvolené družstvo kategórie aktívnej sezóny) a ak má konto, doplní sa mu
   * rola PLAYER. Iné roly import nenastavuje ani neodoberá.
   */
  async importRoster(buffer: Buffer) {
    const rows = await parseRosterXlsx(buffer);
    const { seasonId, rules } = await this.loadAssignRules();

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const items: Array<{
      name: string;
      action: 'created' | 'updated' | 'unchanged';
      registrationValidUntil: Date | null;
      team: string | null;
    }> = [];

    for (const row of rows) {
      const existing = await this.findRosterMatch(row);

      let memberId: string;
      let userId: string | null = null;
      let action: 'created' | 'updated' | 'unchanged';
      if (existing) {
        // aktualizuj len polia, ktoré sa naozaj líšia (prázdne z importu neprepisujú)
        const changed = this.diffRosterData(existing, row);
        if (Object.keys(changed).length > 0) {
          await this.prisma.member.update({ where: { id: existing.id }, data: changed });
          action = 'updated';
          updated++;
        } else {
          action = 'unchanged';
          unchanged++;
        }
        memberId = existing.id;
        userId = existing.userId;
      } else {
        const m = await this.prisma.member.create({
          data: {
            firstName: row.firstName,
            lastName: row.lastName,
            birthDate: row.birthDate ?? undefined,
            status: row.status,
            registrationNumber: row.registrationNumber ?? undefined,
            homeClub: row.homeClub ?? undefined,
            guestClub: row.guestClub ?? undefined,
            clubAffiliation: row.clubAffiliation ?? undefined,
            registrationValidUntil: row.registrationValidUntil ?? undefined,
            registeredAt: row.registeredAt ?? undefined,
          },
        });
        memberId = m.id;
        action = 'created';
        created++;
      }

      // zaradenie do skupiny podľa ročníka (hráč) + rola PLAYER, ak má konto
      let team: string | null = null;
      if (seasonId && row.birthDate) team = await this.assignByAge(memberId, row.birthDate, rules, seasonId);
      if (userId) await this.accounts.syncRoles(userId, ['PLAYER']);

      items.push({ name: `${row.firstName} ${row.lastName}`, action, registrationValidUntil: row.registrationValidUntil, team });
    }

    await this.goalkeepers.sync().catch(() => undefined);
    return { total: rows.length, created, updated, unchanged, items };
  }

  // -------------------------------------------------------------------------
  // Synchronizácia s ISSF (prihlásené čítanie zoznamu hráčov klubu)
  // -------------------------------------------------------------------------

  /** Vytvorí nového člena z importného riadku a zaradí ho podľa ročníka. */
  private async createFromRoster(row: RosterRow, seasonId: string | null, rules: AssignRule[]) {
    const m = await this.prisma.member.create({
      data: {
        firstName: row.firstName,
        lastName: row.lastName,
        birthDate: row.birthDate ?? undefined,
        status: row.status,
        registrationNumber: row.registrationNumber ?? undefined,
        homeClub: row.homeClub ?? undefined,
        guestClub: row.guestClub ?? undefined,
        clubAffiliation: row.clubAffiliation ?? undefined,
        registrationValidUntil: row.registrationValidUntil ?? undefined,
        registeredAt: row.registeredAt ?? undefined,
      },
    });
    let team: string | null = null;
    // neaktívni sa k žiadnemu družstvu nepriraďujú
    if (row.status !== 'INACTIVE' && seasonId && row.birthDate) team = await this.assignByAge(m.id, row.birthDate, rules, seasonId);
    return { memberId: m.id, team };
  }

  /**
   * Náhľad synchronizácie z ISSF: stiahne aktuálny zoznam hráčov a porovná ho
   * s evidenciou. Vráti nových hráčov (vytvoria sa) a existujúcich s rozdielmi
   * (na potvrdenie prepísania). Nič nemení. Fetch sa uloží do krátkej cache,
   * aby apply nemusel znova volať ISSF.
   */
  /** Načíta uložené „ignorované" rozdiely: memberId → (field → hodnota). */
  private async loadSyncIgnores(): Promise<Map<string, Map<string, string>>> {
    const rows = await this.prisma.memberSyncIgnore.findMany();
    const map = new Map<string, Map<string, string>>();
    for (const r of rows) {
      if (!map.has(r.memberId)) map.set(r.memberId, new Map());
      map.get(r.memberId)!.set(r.field, r.value);
    }
    return map;
  }

  async issfSyncPreview() {
    const rows = await this.issf.fetchRoster();
    this.issfCache = { at: Date.now(), rows };
    const ignores = await this.loadSyncIgnores();

    const newPlayers: Array<{ firstName: string; lastName: string; registrationNumber: string | null; birthDate: string | null }> = [];
    const changes: Array<{ memberId: string; name: string; fields: Array<{ field: string; label: string; current: string; incoming: string }> }> = [];

    for (const row of rows) {
      const existing = await this.findRosterMatch(row);
      if (!existing) {
        newPlayers.push({
          firstName: row.firstName,
          lastName: row.lastName,
          registrationNumber: row.registrationNumber,
          birthDate: fmtRosterValue(row.birthDate),
        });
        continue;
      }
      const changed = this.diffRosterData(existing, row, { ignoreName: true });
      const memberIgnores = ignores.get(existing.id);
      const fields = Object.keys(changed)
        .filter((f) => memberIgnores?.get(f) !== rosterValueKey((changed as Record<string, unknown>)[f]))
        .map((f) => ({
          field: f,
          label: ROSTER_FIELD_LABELS[f] ?? f,
          current: fmtRosterValue((existing as unknown as Record<string, unknown>)[f]),
          incoming: fmtRosterValue((changed as Record<string, unknown>)[f]),
        }));
      if (fields.length) changes.push({ memberId: existing.id, name: `${existing.lastName} ${existing.firstName}`, fields });
    }

    return { fetched: rows.length, newCount: newPlayers.length, changeCount: changes.length, newPlayers, changes };
  }

  /**
   * Aplikuje synchronizáciu z ISSF: vytvorí všetkých nových hráčov (ak createNew)
   * a prepíše údaje len u potvrdených členov (overwriteMemberIds). Zdroj dát je
   * cache z posledného preview (ak nie je čerstvá, znova sa načíta z ISSF).
   */
  async issfSyncApply(input: { overwriteMemberIds?: string[]; createNew?: boolean }) {
    const fresh = this.issfCache && Date.now() - this.issfCache.at < 15 * 60 * 1000;
    const rows = fresh ? this.issfCache!.rows : await this.issf.fetchRoster();
    const { seasonId, rules } = await this.loadAssignRules();
    const ignores = await this.loadSyncIgnores();
    const overwrite = new Set(input.overwriteMemberIds ?? []);
    const createNew = input.createNew !== false;

    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const existing = await this.findRosterMatch(row);
      if (!existing) {
        if (createNew) {
          await this.createFromRoster(row, seasonId, rules);
          created++;
        }
        continue;
      }
      const changed = this.diffRosterData(existing, row, { ignoreName: true });
      const memberIgnores = ignores.get(existing.id);
      // zobrazené rozdiely = tie, ktoré neboli predtým „ponechané"
      const shown = Object.fromEntries(
        Object.entries(changed).filter(([f, v]) => memberIgnores?.get(f) !== rosterValueKey(v)),
      );
      if (!Object.keys(shown).length) continue;

      if (overwrite.has(existing.id)) {
        await this.prisma.member.update({ where: { id: existing.id }, data: shown });
        updated++;
        // po prepísaní už netreba ignorovať nič pre tieto polia
        await this.prisma.memberSyncIgnore.deleteMany({
          where: { memberId: existing.id, field: { in: Object.keys(shown) } },
        });
      } else {
        // „ponechať" → zapamätaj hodnoty z ISSF, nech sa rozdiel nabudúce neukazuje
        for (const [field, value] of Object.entries(shown)) {
          await this.prisma.memberSyncIgnore.upsert({
            where: { memberId_field: { memberId: existing.id, field } },
            create: { memberId: existing.id, field, value: rosterValueKey(value) },
            update: { value: rosterValueKey(value) },
          });
        }
      }
    }
    this.issfCache = null;
    return { created, updated };
  }

  /**
   * Týždenná kontrola ISSF (pondelok 6:00): ak pribudli noví hráči alebo zmeny,
   * upozorní vedenie klubu, nech synchronizáciu potvrdí v portáli. Sama nič nemení.
   */
  @Cron('0 6 * * 1')
  async issfWeeklyCheck() {
    if (!this.issf.isConfigured()) return;
    try {
      const preview = await this.issfSyncPreview();
      if (preview.newCount + preview.changeCount === 0) return;
      const managers = await this.prisma.user.findMany({
        where: { isDemo: false, roles: { some: { role: { in: ['ADMIN', 'MANAGER'] as never } } } },
        select: { id: true },
      });
      await this.push.notifyUsers(
        managers.map((m) => m.id),
        {
          title: 'ISSF synchronizácia',
          body: `${preview.newCount} nových hráčov a ${preview.changeCount} zmien čaká na potvrdenie.`,
          data: { type: 'issf-sync' },
        },
      );
      this.logger.log(`ISSF check: ${preview.newCount} nových, ${preview.changeCount} zmien.`);
    } catch (e) {
      this.logger.warn(`ISSF týždenná kontrola zlyhala: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Vráti len tie polia, ktoré sa v importe líšia od existujúceho člena.
   * Prázdne hodnoty z importu neprepisujú vyplnené údaje v DB.
   */
  private diffRosterData(existing: MemberRecord, row: RosterRow, opts: { ignoreName?: boolean } = {}) {
    const changed: Record<string, unknown> = {};
    const setIfDiff = (key: string, current: unknown, next: unknown) => {
      if (next !== undefined && next !== null && next !== current) changed[key] = next;
    };
    // meno/priezvisko/stav sú vždy prítomné; pri ISSF (zlúčený stĺpec „Hráč") sa
    // meno nerozlišuje spoľahlivo (zložené priezviská), preto ho nenavrhujeme meniť
    if (!opts.ignoreName) {
      setIfDiff('firstName', existing.firstName, row.firstName);
      setIfDiff('lastName', existing.lastName, row.lastName);
    }
    setIfDiff('status', existing.status, row.status);
    // dátumy porovnávame podľa kalendárneho dňa (UTC), nie presného času — uložené
    // hodnoty môžu mať inú časovú zložku, takže rovnaký deň by inak hlásil zmenu.
    if (row.birthDate && !sameUtcDay(existing.birthDate, row.birthDate)) changed.birthDate = row.birthDate;
    if (row.registrationValidUntil && !sameUtcDay(existing.registrationValidUntil, row.registrationValidUntil)) {
      changed.registrationValidUntil = row.registrationValidUntil;
    }
    if (row.registeredAt && !sameUtcDay(existing.registeredAt, row.registeredAt)) {
      changed.registeredAt = row.registeredAt;
    }
    setIfDiff('registrationNumber', existing.registrationNumber, row.registrationNumber);
    setIfDiff('homeClub', existing.homeClub, row.homeClub);
    setIfDiff('guestClub', existing.guestClub, row.guestClub);
    setIfDiff('clubAffiliation', existing.clubAffiliation, row.clubAffiliation);
    return changed;
  }

  /** Načíta pravidlá zaradenia do kategórií pre aktívnu sezónu (predvolené družstvá). */
  private async loadAssignRules(): Promise<{ seasonId: string | null; rules: AssignRule[] }> {
    const season = await this.prisma.season.findFirst({
      where: { isActive: true },
      include: {
        categoryRules: {
          include: { teamCategory: { include: { teams: { where: { isGoalkeeperGroup: false }, orderBy: { sortOrder: 'asc' } } } } },
        },
      },
    });
    if (!season) return { seasonId: null, rules: [] };
    const rules: AssignRule[] = season.categoryRules.map((r) => ({
      categoryCode: r.teamCategory.code as CategoryCode,
      birthYearFrom: r.birthYearFrom,
      birthYearTo: r.birthYearTo,
      teamCategoryId: r.teamCategoryId,
      defaultTeamId: r.teamCategory.teams[0]?.id ?? null,
      defaultTeamName: r.teamCategory.teams[0]?.name ?? null,
    }));
    return { seasonId: season.id, rules };
  }

  /**
   * Zaradí hráča do predvoleného družstva jeho vekovej kategórie. Manuálnu
   * výnimku (isException) ani hráča už v správnej kategórii (napr. B tím)
   * neprepisuje. Vráti názov družstva (alebo null, ak sa nedá zaradiť).
   */
  private async assignByAge(
    memberId: string,
    birthDate: Date,
    rules: AssignRule[],
    seasonId: string,
  ): Promise<string | null> {
    const code = categoryForBirthDate(birthDate, rules);
    const rule = rules.find((r) => r.categoryCode === code);
    if (!code || !rule || !rule.defaultTeamId) return null;

    const memberships = await this.prisma.teamMembership.findMany({
      where: { memberId, seasonId, leftAt: null, team: { isGoalkeeperGroup: false } },
      include: { team: true },
    });
    // ak má hráč čo i len jednu manuálnu výnimku (aj viac skupín), nezasahujeme
    if (memberships.some((m) => m.isException)) {
      return memberships.map((m) => m.team.name).join(', ');
    }
    // už je v správnej vekovej kategórii (napr. presunutý do B tímu)
    const inCategory = memberships.find((m) => m.team.teamCategoryId === rule.teamCategoryId);
    if (inCategory) return inCategory.team.name;

    // automatické zaradenie: nahraď staré auto-zaradenie predvoleným tímom
    await this.prisma.teamMembership.deleteMany({ where: { memberId, seasonId, isException: false, team: { isGoalkeeperGroup: false } } });
    await this.prisma.teamMembership.create({
      data: { memberId, seasonId, teamId: rule.defaultTeamId },
    });
    return rule.defaultTeamName;
  }

  /** Nájde existujúceho člena pre importný riadok (reg. číslo → meno+priezvisko+dátum). */
  private async findRosterMatch(row: RosterRow) {
    if (row.registrationNumber) {
      const byReg = await this.prisma.member.findUnique({ where: { registrationNumber: row.registrationNumber } });
      if (byReg) return byReg;
    }
    return this.prisma.member.findFirst({
      where: {
        firstName: { equals: row.firstName, mode: 'insensitive' },
        lastName: { equals: row.lastName, mode: 'insensitive' },
        birthDate: row.birthDate ?? undefined,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Platnosť registračných preukazov (dashboard)
  // -------------------------------------------------------------------------

  /**
   * Zoznam registračných preukazov so scope podľa roly:
   *  - ADMIN/MANAGER: všetci hráči s preukazom,
   *  - COACH: len vlastný preukaz / deti (platnosť preukazov hráčov družstva tréner nevidí),
   *  - PLAYER/PARENT: vlastný preukaz + preukazy detí.
   * Vždy iba AKTÍVNI členovia (status ACTIVE).
   * Zoradené od najskoršej platnosti; po platnosti sú zvýraznené (expired).
   */
  async registrationCards(user: AuthUser) {
    const staff = user.roles.some((r) => r.role === 'ADMIN' || r.role === 'MANAGER');

    let where: Record<string, unknown> = {
      isDemo: user.isDemo,
      status: 'ACTIVE' as MemberStatus,
      registrationValidUntil: { not: null },
    };
    if (!staff) {
      const or: Array<Record<string, unknown>> = [];
      // vlastný člen + deti (rodič) – zobrazíme aj bez vyplneného dátumu platnosti
      or.push({ user: { id: user.id } });
      or.push({ guardians: { some: { userId: user.id } } });
      // zobrazujeme len hráčov – rodič nevidí seba ani iné funkcie (vedenie/tréner/rodič)
      where = {
        AND: [
          { isDemo: user.isDemo },
          { status: 'ACTIVE' as MemberStatus },
          { OR: or },
          { NOT: { user: { roles: { some: { role: { in: ['ADMIN', 'MANAGER', 'COACH', 'PARENT'] as never } } } } } },
        ],
      };
    }

    const members = await this.prisma.member.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        registrationNumber: true,
        registrationValidUntil: true,
        memberships: {
          where: { leftAt: null, season: { isActive: true } },
          select: { team: { select: { name: true } } },
          take: 1,
        },
      },
      orderBy: { registrationValidUntil: 'asc' },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return members.map((m) => {
      const until = m.registrationValidUntil as Date | null;
      const daysLeft = until ? Math.ceil((until.getTime() - today.getTime()) / 86400000) : null;
      return {
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        registrationNumber: m.registrationNumber,
        registrationValidUntil: until,
        team: m.memberships[0]?.team.name ?? null,
        daysLeft,
        expired: daysLeft != null && daysLeft < 0,
      };
    });
  }
}
