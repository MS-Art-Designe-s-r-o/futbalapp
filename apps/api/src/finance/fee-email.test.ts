import { describe, expect, it } from 'vitest';
import { buildFeeEmail } from './fee-email';

const base = {
  memberName: 'Ján Novák',
  planName: 'Členské',
  items: [{ periodLabel: '2026-09', amountCents: 2500, dueDate: new Date(Date.UTC(2026, 8, 15)), variableSymbol: '140520160' }],
};

describe('buildFeeEmail', () => {
  it('obsahuje VS, IBAN po štvoriciach a sumu', () => {
    const { subject, html } = buildFeeEmail({ ...base, iban: 'SK3112000000198742637541' });
    expect(subject).toContain('Členské');
    expect(html).toContain('140520160');
    expect(html).toContain('SK31 1200 0000 1987 4263 7541');
    expect(html).toContain('25,00 €');
    expect(html).toContain('september 2026');
    expect(html).toContain('15.9.2026');
  });
  it('escapuje HTML', () => {
    const { html } = buildFeeEmail({ ...base, memberName: '<script>x</script>', planName: 'A&B' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A&amp;B');
  });
  it('bez IBAN: klub oznámi číslo účtu', () => {
    const { html } = buildFeeEmail(base);
    expect(html).toContain('Číslo účtu vám oznámi klub');
    expect(html).not.toContain('IBAN');
  });
});

import { humanPeriodLabel as hpl } from './fee-email';
describe('humanPeriodLabel jednorazový predpis', () => {
  it('JEDNORAZOVO-… sa zobrazí ako Jednorazovo', () => {
    expect(hpl('JEDNORAZOVO-2026-12')).toBe('Jednorazovo');
  });
});

describe('platobné údaje s bankou a číslom účtu', () => {
  it('zobrazí banku, tuzemské číslo účtu aj IBAN', () => {
    const r = buildFeeEmail({ memberName: 'A B', planName: 'Kemp', items: [{ periodLabel: 'JEDNORAZOVO-2026-12', amountCents: 6000, dueDate: null, variableSymbol: '140520162' }], iban: 'SK7702000000000062639512', accountNumber: '62639-512/0200', bankName: 'VÚB, a.s.' });
    expect(r.html).toContain('VÚB, a.s.');
    expect(r.html).toContain('62639-512/0200');
    expect(r.html).toContain('SK77 0200 0000 0000 6263 9512');
  });
});
