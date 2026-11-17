import { describe, expect, it } from 'vitest';
import { buildInfoRequestEmail } from './info-request-email';

describe('buildInfoRequestEmail', () => {
  it('obsahuje odkaz a tlačidlo', () => {
    const { subject, html } = buildInfoRequestEmail({ link: 'https://fkknv.sk/doplnenie-udajov/abc' });
    expect(subject).toBeTruthy();
    expect(html).toContain('https://fkknv.sk/doplnenie-udajov/abc');
    expect(html).toContain('Doplniť údaje hráča');
    expect(html).toContain('info@fkknv.sk');
  });
  it('escapuje HTML v mene a správe', () => {
    const { html } = buildInfoRequestEmail({
      parentName: '<script>x</script>',
      childName: '"><img src=x>',
      link: 'https://fkknv.sk/a?b=1&c=2',
      message: '<b>ahoj</b>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<b>ahoj</b>');
    expect(html).toContain('&lt;b&gt;ahoj&lt;/b&gt;');
    expect(html).toContain('b=1&amp;c=2');
  });
});
