/** Notifikačný e-mail pre klub o novej prihláške (posiela sa na info@fkknv.sk). */
export interface NewRegistrationSummary {
  applicantType: 'ADULT' | 'CHILD' | 'PARENT' | string;
  /** hráči z prihlášky (dieťa/deti alebo dospelý); pri PARENT prázdne */
  players: Array<{ name: string; birthDate: string | null }>;
  parentName?: string | null;
  parentEmail?: string | null;
  parentPhone?: string | null;
  playerEmail?: string | null;
  note?: string | null;
  parentChildrenNote?: string | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TYPE_LABEL: Record<string, string> = {
  ADULT: 'dospelý hráč',
  CHILD: 'dieťa (prihlásil rodič)',
  PARENT: 'rodič (dieťa už je členom klubu)',
};

export function buildNewRegistrationEmail(r: NewRegistrationSummary, portalUrl: string): { subject: string; html: string } {
  const who = r.players.length ? r.players.map((p) => p.name).join(', ') : (r.parentName ?? 'nový rodič');
  const subject = `Nová registrácia: ${who}`;
  const row = (label: string, value?: string | null) =>
    value?.trim() ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;">${label}</td><td style="padding:4px 0;"><b>${esc(value.trim())}</b></td></tr>` : '';
  const players = r.players
    .map((p) => `${esc(p.name)}${p.birthDate ? ` (nar. ${esc(p.birthDate)})` : ''}`)
    .join('<br>');
  const html = `<!doctype html><html lang="sk"><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#16223c;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#16223c;color:#ffffff;padding:16px 24px;font-size:18px;font-weight:bold;">Nová registrácia v portáli FKKNV</td></tr>
<tr><td style="padding:20px 24px;font-size:15px;line-height:1.5;">
<p style="margin:0 0 12px;">Do portálu prišla nová registrácia, ktorá čaká na schválenie.</p>
<table cellpadding="0" cellspacing="0" style="font-size:14px;">
${row('Typ', TYPE_LABEL[r.applicantType] ?? r.applicantType)}
${players ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;">Hráč</td><td style="padding:4px 0;"><b>${players}</b></td></tr>` : ''}
${row('Rodič', r.parentName)}
${row('E-mail rodiča', r.parentEmail)}
${row('Telefón rodiča', r.parentPhone)}
${row('E-mail hráča', r.playerEmail)}
${row('Deti v klube (poznámka)', r.parentChildrenNote)}
${row('Poznámka', r.note)}
</table>
<p style="margin:20px 0 0;"><a href="${esc(portalUrl)}" style="background:#2874ed;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-weight:bold;">Otvoriť registrácie v portáli</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, html };
}
