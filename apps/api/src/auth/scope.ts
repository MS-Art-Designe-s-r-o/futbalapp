import type { AuthUser } from './current-user.decorator';

/** Vedenie klubu — vidí a spravuje celý klub. */
export function isStaff(user: AuthUser): boolean {
  return user.roles.some((r) => r.role === 'ADMIN' || r.role === 'MANAGER');
}

/** Tréner brankárov — smie spravovať brankárske tréningy ktorejkoľvek skupiny Brankári. */
export function isGkCoach(user: AuthUser): boolean {
  return user.roles.some((r) => r.role === 'GK_COACH');
}

/** Má používateľ trénerskú rolu (aspoň jedného družstva)? */
export function isCoach(user: AuthUser): boolean {
  return user.roles.some((r) => r.role === 'COACH');
}

/**
 * Tréner smie k dochádzke/nominácii len svojho družstva. Vráti true, ak má byť
 * prístup zablokovaný: je tréner, nie je vedenie a nejde o jeho družstvo.
 * (Hráčov/rodičov neblokuje — tí nie sú tréneri.)
 */
export function coachBlockedFromTeam(user: AuthUser, teamId: string | null | undefined): boolean {
  if (isStaff(user)) return false;
  if (!isCoach(user)) return false;
  return !canManageTeam(user, teamId);
}

/** Družstvá, ktoré používateľ trénuje (COACH scope). */
export function coachTeamIds(user: AuthUser): string[] {
  return user.roles.filter((r) => r.role === 'COACH' && r.teamId).map((r) => r.teamId as string);
}

/** Môže používateľ spravovať (editovať) dané družstvo? Vedenie áno, tréner len svoje. */
export function canManageTeam(user: AuthUser, teamId: string | null | undefined): boolean {
  if (isStaff(user)) return true;
  if (!teamId) return false;
  return coachTeamIds(user).includes(teamId);
}

/**
 * Oddelenie testovacích (demo) dát od ostrých. Demo konto (app-store review) vidí
 * LEN demo dáta; ostatní používatelia demo dáta NIKDY nevidia. Vracia hodnotu poľa
 * `isDemo`, ktorou sa filtrujú modely s týmto poľom (User/Member/Team/Event/Channel/Task).
 */
export function isDemoScope(user: AuthUser): boolean {
  return !!user.isDemo;
}
