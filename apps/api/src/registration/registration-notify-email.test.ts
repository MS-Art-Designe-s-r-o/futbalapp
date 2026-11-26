import { describe, expect, it } from 'vitest';
import { buildNewRegistrationEmail } from './registration-notify-email';

describe('buildNewRegistrationEmail', () => {
  it('obsahuje hráča, rodiča a odkaz do portálu', () => {
    const { subject, html } = buildNewRegistrationEmail(
      { applicantType: 'CHILD', players: [{ name: 'Tobias Kolárik', birthDate: '2016-05-01' }], parentName: 'Jana Kolárik', parentEmail: 'jana@example.com' },
      'https://fkknv.sk/portal/registracie',
    );
    expect(subject).toBe('Nová registrácia: Tobias Kolárik');
    expect(html).toContain('Tobias Kolárik');
    expect(html).toContain('jana@example.com');
    expect(html).toContain('https://fkknv.sk/portal/registracie');
  });
  it('escapuje HTML z formulára', () => {
    const { html } = buildNewRegistrationEmail(
      { applicantType: 'PARENT', players: [], parentName: '<script>x</script>', note: 'a & b' },
      'https://fkknv.sk/portal/registracie',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('a &amp; b');
  });
});
