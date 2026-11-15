import { z } from 'zod';
import { PLAYER_POSITION_SHORT, type PlayerPosition } from './enums';

/** Post na ihrisku: postavenie + poloha v % (zvislé ihrisko, vlastná bránka dole). */
export interface LineupSlot {
  pos: PlayerPosition;
  x: number;
  y: number;
}

const S = (a: Array<[PlayerPosition, number, number]>): LineupSlot[] => a.map(([pos, x, y]) => ({ pos, x, y }));

/** Formáty hry (počet hráčov) a ich rozostavenia. */
export const LINEUP_FORMATS: Record<string, { label: string; formations: Record<string, LineupSlot[]> }> = {
  '10+1': {
    label: '10+1 (U15 a starší)',
    formations: {
      '4-4-2': S([['GK', 50, 91], ['FB', 13, 72], ['CB', 37, 75], ['CB', 63, 75], ['FB', 87, 72], ['WM', 13, 50], ['CM', 37, 52], ['CM', 63, 52], ['WM', 87, 50], ['ST', 37, 25], ['ST', 63, 25]]),
      '4-3-3': S([['GK', 50, 91], ['FB', 13, 72], ['CB', 37, 75], ['CB', 63, 75], ['FB', 87, 72], ['CM', 28, 50], ['CDM', 50, 58], ['CM', 72, 50], ['W', 15, 26], ['ST', 50, 20], ['W', 85, 26]]),
      '3-5-2': S([['GK', 50, 91], ['CB', 24, 75], ['CB', 50, 77], ['CB', 76, 75], ['WB', 10, 52], ['CM', 32, 50], ['CDM', 50, 58], ['CM', 68, 50], ['WB', 90, 52], ['ST', 37, 25], ['ST', 63, 25]]),
    },
  },
  '8+1': {
    label: '8+1 (U13)',
    formations: {
      '3-3-2': S([['GK', 50, 91], ['CB', 22, 72], ['CB', 50, 75], ['CB', 78, 72], ['WM', 18, 50], ['CM', 50, 52], ['WM', 82, 50], ['ST', 36, 25], ['ST', 64, 25]]),
      '3-2-3': S([['GK', 50, 91], ['CB', 22, 72], ['CB', 50, 75], ['CB', 78, 72], ['CM', 36, 52], ['CM', 64, 52], ['W', 16, 26], ['ST', 50, 22], ['W', 84, 26]]),
    },
  },
  '7+1': {
    label: '7+1 (U11)',
    formations: {
      '3-3-1': S([['GK', 50, 91], ['CB', 22, 73], ['CB', 50, 76], ['CB', 78, 73], ['WM', 15, 50], ['CM', 50, 53], ['WM', 85, 50], ['ST', 50, 22]]),
      '2-3-2': S([['GK', 50, 91], ['CB', 33, 73], ['CB', 67, 73], ['WM', 15, 50], ['CM', 50, 53], ['WM', 85, 50], ['ST', 35, 23], ['ST', 65, 23]]),
    },
  },
  '5+1': {
    label: '5+1 (U9)',
    formations: {
      '2-1-2': S([['GK', 50, 91], ['CB', 33, 70], ['CB', 67, 70], ['CM', 50, 48], ['ST', 30, 22], ['ST', 70, 22]]),
    },
  },
};

/** Predvolený formát podľa kódu kategórie (U9 → 5+1, U11 → 7+1, U13 → 8+1, inak 10+1). */
export function defaultLineupFormat(categoryCode?: string | null): string {
  const n = Number(/\d+/.exec(categoryCode ?? '')?.[0]);
  if (!Number.isFinite(n)) return '10+1';
  if (n <= 9) return '5+1';
  if (n <= 11) return '7+1';
  if (n <= 13) return '8+1';
  return '10+1';
}

/** Uložené rozostavenie: slot (index postu) → memberId. */
export const matchLineupSchema = z
  .object({
    format: z.string().refine((f) => f in LINEUP_FORMATS, 'Neznámy formát'),
    formation: z.string(),
    slots: z.record(z.string().regex(/^\d+$/), z.string().min(1)),
  })
  .superRefine((v, ctx) => {
    const fm = LINEUP_FORMATS[v.format]?.formations[v.formation];
    if (!fm) return ctx.addIssue({ code: 'custom', message: 'Neznáme rozostavenie' });
    const ids = Object.values(v.slots);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Hráč je v rozostavení viackrát' });
    for (const k of Object.keys(v.slots)) {
      if (Number(k) >= fm.length) ctx.addIssue({ code: 'custom', message: 'Neplatný post' });
    }
  });
export type MatchLineup = z.infer<typeof matchLineupSchema>;

export interface LineupPrintInput {
  title: string;
  subtitle?: string;
  format: string;
  formation: string;
  /** obsadené/voľné posty v poradí formácie */
  slots: Array<{ pos: PlayerPosition; x: number; y: number; name: string | null }>;
  /** nominovaní hráči mimo základnej zostavy */
  bench: string[];
  notes?: string | null;
}

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Samostatný HTML dokument rozostavenia na tlač (A4 na výšku, úsporný na farbu). */
export function buildLineupPrintHtml(i: LineupPrintInput): string {
  const dots = i.slots
    .map(
      (s) =>
        `<div class="slot" style="left:${s.x}%;top:${s.y}%"><span class="dot${s.name ? ' on' : ''}">${esc(PLAYER_POSITION_SHORT[s.pos])}</span><span class="nm">${esc(s.name ?? '')}</span></div>`,
    )
    .join('');
  const list = i.slots
    .map((s, n) => `<li><b>${esc(PLAYER_POSITION_SHORT[s.pos])}</b> ${s.name ? esc(s.name) : '<i>voľné</i>'}</li>`.replace('<li>', `<li value="${n + 1}">`))
    .join('');
  const bench = i.bench.length ? i.bench.map((b) => `<li>${esc(b)}</li>`).join('') : '<li><i>—</i></li>';
  return `<!doctype html><html lang="sk"><head><meta charset="utf-8"><title>${esc(i.title)}</title><style>
@page{size:A4 portrait;margin:12mm}
*{box-sizing:border-box}
body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1{font-size:20pt;margin:0 0 2mm}
.sub{font-size:10.5pt;color:#444;margin-bottom:5mm}
.wrap{display:flex;gap:8mm;align-items:flex-start}
.pitch{position:relative;width:118mm;height:174mm;border:1.2pt solid #1c6b43;background:#f4faf6;flex:none}
.pitch svg{position:absolute;inset:0;width:100%;height:100%}
.pitch svg *{fill:none;stroke:#1c6b43;stroke-width:.45}
.slot{position:absolute;transform:translate(-50%,-50%);width:26mm;text-align:center}
.dot{display:inline-block;width:9.5mm;height:9.5mm;line-height:8.3mm;border-radius:50%;border:1.2pt dashed #1c6b43;font-size:7pt;font-weight:700;background:#fff;color:#1c6b43}
.dot.on{border-style:solid;background:#1c6b43;color:#fff}
.nm{display:block;font-size:8.5pt;font-weight:700;line-height:1.15;margin-top:.6mm}
.side{flex:1;min-width:0}
h2{font-size:10pt;text-transform:uppercase;letter-spacing:.6pt;margin:0 0 2mm;color:#1c6b43;border-bottom:.8pt solid #1c6b43;padding-bottom:1mm}
ol,ul{margin:0 0 6mm;padding-left:5mm;font-size:10pt;line-height:1.55}
ol{list-style:decimal}
.notes{font-size:9.5pt;border:.8pt solid #999;padding:2mm;min-height:20mm;white-space:pre-wrap}
.foot{margin-top:5mm;font-size:8pt;color:#777}
</style></head><body>
<h1>${esc(i.title)}</h1>
<div class="sub">${i.subtitle ? esc(i.subtitle) + ' · ' : ''}Formát ${esc(i.format)} · rozostavenie ${esc(i.formation)}</div>
<div class="wrap">
<div class="pitch"><svg viewBox="0 0 68 100" preserveAspectRatio="none"><rect x="2" y="2" width="64" height="96"/><line x1="2" y1="50" x2="66" y2="50"/><circle cx="34" cy="50" r="8"/><rect x="16" y="2" width="36" height="14"/><rect x="26" y="2" width="16" height="5"/><rect x="16" y="84" width="36" height="14"/><rect x="26" y="93" width="16" height="5"/></svg>${dots}</div>
<div class="side"><h2>Základná zostava</h2><ol>${list}</ol><h2>Náhradníci</h2><ul>${bench}</ul>${i.notes ? `<h2>Poznámky</h2><div class="notes">${esc(i.notes)}</div>` : ''}</div>
</div>
<div class="foot">FK Košická Nová Ves · portál FKKNV</div>
</body></html>`;
}
