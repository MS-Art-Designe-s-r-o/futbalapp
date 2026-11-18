import { describe, expect, it } from 'vitest';
import { stripRegistrationForCoach } from './registration-visibility';

const u = (...roles: string[]) => ({ roles: roles.map((role) => ({ role, teamId: null })) }) as never;
const m = { id: '1', firstName: 'A', registrationValidUntil: new Date(), registeredAt: new Date() };

describe('stripRegistrationForCoach', () => {
  it('odstráni platnosť preukazu trénerovi (objekt aj zoznam)', () => {
    const one = stripRegistrationForCoach(u('COACH'), m) as Record<string, unknown>;
    expect(one).toEqual({ id: '1', firstName: 'A' });
    const many = stripRegistrationForCoach(u('COACH'), [m, m]) as Array<Record<string, unknown>>;
    expect(many.every((x) => !('registrationValidUntil' in x) && !('registeredAt' in x))).toBe(true);
  });
  it('vedeniu a ostatným nechá dáta', () => {
    expect(stripRegistrationForCoach(u('ADMIN'), m)).toBe(m);
    expect(stripRegistrationForCoach(u('MANAGER', 'COACH'), m)).toBe(m);
    expect(stripRegistrationForCoach(u('PARENT'), m)).toBe(m);
  });
});
