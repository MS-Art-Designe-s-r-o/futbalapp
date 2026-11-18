export interface FeeEmailItem {
  periodLabel: string;
  amountCents: number;
  dueDate: Date | null;
  variableSymbol: string;
}

export interface FeeEmailInput {
  memberName: string;
  planName: string;
  items: FeeEmailItem[];
  iban?: string;
  accountName?: string;
  /** Číslo účtu v tuzemskom tvare (napr. 62639-512/0200) a názov banky. */
  accountNumber?: string;
  bankName?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const MONTHS = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];

/** "2026-09" → "september 2026"; iné označenia ostanú bezo zmeny. */
export function humanPeriodLabel(label: string): string {
  if (label.startsWith('JEDNORAZOVO')) return 'Jednorazovo';
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(label);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : label;
}

export const formatEuro = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

export const formatIbanSpaced = (iban: string) => iban.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();

const formatDue = (d: Date | null) =>
  d ? `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}` : '—';

const FONT = 'font-family:Arial,Helvetica,sans-serif;';

/** E-mail rodičovi/hráčovi s predpisom poplatku a platobnými údajmi. */
export function buildFeeEmail(input: FeeEmailInput): { subject: string; html: string } {
  const member = esc(input.memberName);
  const plan = esc(input.planName);
  const total = input.items.reduce((s, i) => s + i.amountCents, 0);
  const symbols = [...new Set(input.items.map((i) => i.variableSymbol))];

  const th = (t: string, align = 'left') =>
    `<th align="${align}" style="padding:8px 6px;${FONT}font-size:13px;color:#666666;border-bottom:2px solid #111418;">${t}</th>`;
  const td = (t: string, align = 'left', bold = false) =>
    `<td align="${align}" style="padding:8px 6px;${FONT}font-size:14px;color:#1a1a1a;border-bottom:1px solid #e3e5e8;${bold ? 'font-weight:bold;' : ''}">${t}</td>`;
  const rows = input.items
    .map(
      (i) =>
        `<tr>${td(esc(humanPeriodLabel(i.periodLabel)))}${td(esc(formatEuro(i.amountCents)), 'right', true)}${td(esc(formatDue(i.dueDate)))}${td(esc(i.variableSymbol))}</tr>`,
    )
    .join('');

  const iban = input.iban?.replace(/\s+/g, '');
  const line = (label: string, value: string) =>
    `<tr><td valign="top" style="padding:4px 0;${FONT}font-size:14px;color:#555555;width:150px;">${label}</td><td style="padding:4px 0;${FONT}font-size:15px;font-weight:bold;color:#111418;">${value}</td></tr>`;
  const accountLines = iban
    ? (input.bankName?.trim() ? line('Banka', esc(input.bankName.trim())) : '') +
      (input.accountNumber?.trim() ? line('Číslo účtu', esc(input.accountNumber.trim())) : '') +
      line('IBAN', esc(formatIbanSpaced(iban))) +
      (input.accountName?.trim() ? line('Prijímateľ', esc(input.accountName.trim())) : '')
    : line('Číslo účtu', 'Číslo účtu vám oznámi klub.');
  const vsLine = line(symbols.length > 1 ? 'Variabilné symboly' : 'Variabilný symbol', esc(symbols.join(', ')));

  const html = `<!doctype html>
<html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef0f3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f3;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;">
<tr><td style="background:#111418;padding:24px 32px;border-bottom:4px solid #ed1744;border-radius:8px 8px 0 0;${FONT}">
<div style="font-size:12px;letter-spacing:2px;color:#c8f567;text-transform:uppercase;">Futbalový klub</div>
<div style="font-size:22px;font-weight:bold;color:#ffffff;padding-top:4px;">FK Košická Nová Ves</div></td></tr>
<tr><td style="padding:28px 32px 12px 32px;${FONT}font-size:15px;line-height:24px;color:#1a1a1a;">
<p style="margin:0 0 12px 0;">Dobrý deň,</p>
<p style="margin:0 0 12px 0;">posielame vám platobné údaje k predpisu <strong>${plan}</strong> pre hráča <strong>${member}</strong>. Prehľad nájdete nižšie.</p></td></tr>
<tr><td style="padding:0 32px 20px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>${th('Obdobie')}${th('Suma', 'right')}${th('Splatnosť')}${th('Variabilný symbol')}</tr>${rows}</table></td></tr>
<tr><td style="padding:0 32px 20px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:4px solid #c8f567;background:#f4f7ec;padding:14px 16px;">
<div style="${FONT}font-size:15px;font-weight:bold;color:#111418;padding-bottom:6px;">Platobné údaje</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${accountLines}
${line('Suma', esc(formatEuro(total)))}
${vsLine}
${line('Správa pre prijímateľa', member)}
</table>
<div style="${FONT}font-size:13px;line-height:20px;color:#444444;padding-top:8px;">Variabilný symbol (VS) je dátum narodenia hráča + kód predpisu a slúži na automatické spárovanie platby, prosíme ho neprepisovať.</div>
<div style="${FONT}font-size:13px;line-height:20px;color:#444444;padding-top:8px;">Platíte za viac detí jednou platbou? Uveďte variabilný symbol prvého dieťaťa, do špecifického symbolu dátum narodenia druhého dieťaťa (DDMMRRRR) a sumu za všetky deti spolu. Platbu automaticky rozdelíme.</div>
</td></tr></table></td></tr>
<tr><td style="padding:0 32px 28px 32px;${FONT}font-size:14px;line-height:22px;color:#444444;">
<p style="margin:0 0 10px 0;">Ak ste už uhradili, tento e-mail považujte za bezpredmetný.</p>
<p style="margin:0;">Máte otázky? Napíšte nám na <a href="mailto:info@fkknv.sk" style="color:#ed1744;">info@fkknv.sk</a>.</p></td></tr>
<tr><td style="background:#111418;padding:16px 32px;border-radius:0 0 8px 8px;${FONT}font-size:12px;color:#9aa0a6;">FK Košická Nová Ves · fkknv.sk</td></tr>
</table></td></tr></table>
</body></html>`;
  return { subject: `FK Košická Nová Ves: predpis ${input.planName} — ${input.memberName}`, html };
}
