export interface InfoRequestEmailInput {
  parentName?: string;
  childName?: string;
  link: string;
  message?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ITEMS = [
  'Meno a priezvisko',
  'Dátum narodenia',
  'Registračné číslo (ak ho dieťa nemá, nevypĺňajte)',
  'Materský klub',
  'Hosťujúci klub',
  'Klubová príslušnosť',
  'Fotografia hráča (portrét na svetlom pozadí)',
  'Skupina / družstvo',
];

/** E-mail rodičovi s odkazom na verejný formulár na doplnenie údajov o dieťati. */
export function buildInfoRequestEmail(input: InfoRequestEmailInput): { subject: string; html: string } {
  const greeting = input.parentName?.trim() ? `Dobrý deň, ${esc(input.parentName.trim())},` : 'Dobrý deň,';
  const child = input.childName?.trim() ? ` ${esc(input.childName.trim())}` : '';
  const link = esc(input.link);
  const msg = input.message?.trim()
    ? `<tr><td style="padding:0 32px 20px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:4px solid #c8f567;background:#f4f7ec;padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#1a1a1a;">${esc(input.message.trim()).replace(/\r?\n/g, '<br>')}</td></tr></table></td></tr>`
    : '';
  const items = ITEMS.map(
    (t, i) =>
      `<tr><td width="32" valign="top" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ed1744;">${i + 1}.</td><td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#1a1a1a;">${esc(t)}</td></tr>`,
  ).join('');

  const html = `<!doctype html>
<html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef0f3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f3;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;">
<tr><td style="background:#111418;padding:24px 32px;border-bottom:4px solid #ed1744;border-radius:8px 8px 0 0;font-family:Arial,Helvetica,sans-serif;">
<div style="font-size:12px;letter-spacing:2px;color:#c8f567;text-transform:uppercase;">Futbalový klub</div>
<div style="font-size:22px;font-weight:bold;color:#ffffff;padding-top:4px;">FK Košická Nová Ves</div></td></tr>
<tr><td style="padding:28px 32px 12px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#1a1a1a;">
<p style="margin:0 0 12px 0;">${greeting}</p>
<p style="margin:0 0 12px 0;">ďakujeme za registráciu${child ? ` hráča${child}` : ''} na portáli klubu. Pri kontrole sme v systéme ISSF nenašli platnú registráciu vášho dieťaťa. Aby sme mohli registráciu dokončiť a sprístupniť vám prístup do portálu, potrebujeme od vás doplniť niekoľko údajov.</p></td></tr>
${msg}
<tr><td align="center" style="padding:8px 32px 24px 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#ed1744" style="border-radius:6px;"><a href="${link}" style="display:inline-block;padding:16px 36px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">Doplniť údaje hráča</a></td></tr></table></td></tr>
<tr><td style="padding:0 32px 20px 32px;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#111418;padding-bottom:6px;">Čo budeme potrebovať</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items}</table></td></tr>
<tr><td style="padding:0 32px 28px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#444444;">
<p style="margin:0 0 10px 0;">Odkaz je platný 14 dní. Ak tlačidlo nefunguje, skopírujte si tento odkaz do prehliadača:<br><a href="${link}" style="color:#ed1744;word-break:break-all;">${link}</a></p>
<p style="margin:0;">Máte otázky? Napíšte nám na <a href="mailto:info@fkknv.sk" style="color:#ed1744;">info@fkknv.sk</a>.</p></td></tr>
<tr><td style="background:#111418;padding:16px 32px;border-radius:0 0 8px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9aa0a6;">FK Košická Nová Ves · fkknv.sk</td></tr>
</table></td></tr></table>
</body></html>`;
  return { subject: 'FK Košická Nová Ves: doplňte údaje o vašom dieťati', html };
}
