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
