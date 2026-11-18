import type { AuthUser } from '../auth/current-user.decorator';

/** Trénerský pohľad (COACH bez vedenia) — platnosť registračného preukazu nevidí. */
export function isCoachView(user: Pick<AuthUser, 'roles'>): boolean {
  const roles = user.roles.map((r) => r.role);
  return roles.includes('COACH') && !roles.includes('ADMIN') && !roles.includes('MANAGER');
}

/**
 * Pre trénera odstráni `registrationValidUntil` a `registeredAt` z člena (alebo zoznamu členov).
 * Ostatným rolám vráti dáta nezmenené.
 */
export function stripRegistrationForCoach<T>(user: Pick<AuthUser, 'roles'>, data: T): T {
  if (!isCoachView(user)) return data;
  const strip = (m: unknown): unknown => {
    if (!m || typeof m !== 'object') return m;
    const { registrationValidUntil: _a, registeredAt: _b, ...rest } = m as Record<string, unknown>;
    return rest;
  };
  return (Array.isArray(data) ? data.map(strip) : strip(data)) as T;
}
