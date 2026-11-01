/**
 * Jednorazové priradenie hracích plôch (Pitch) k už vytvoreným tréningom a domácim
 * zápasom, ktoré majú miesto zadané len textom — aby plocha bola v rezervačnom systéme.
 * Plochy musia byť už zadané v portáli (Nastavenia → Hracie plochy).
 *
 * NESPÚŠŤA sa automaticky.
 *
 *   npx ts-node prisma/assign-pitches.ts                         # DRY-RUN: iba vypíše plán
 *   npx ts-node prisma/assign-pitches.ts --apply                 # skutočný zápis
 *   npx ts-node prisma/assign-pitches.ts --map "Ihrisko KNV=Ihrisko KNV – hlavné"   # ručné mapovanie textu na plochu (opakovateľné)
 *   npx ts-node prisma/assign-pitches.ts --include-past          # aj minulé udalosti (predvolene len budúce)
 *
 * Pravidlá:
 *  - berú sa tréningy a domáce zápasy/turnaje bez plochy (pitchId) s vyplneným miestom, bez demo údajov,
 *  - text sa páruje s plochou: ručné mapovanie → presná zhoda názvu (bez diakritiky/veľkosti písmen) → jediná čiastočná zhoda,
 *  - nespárované texty sa len vypíšu (nič sa nemení),
 *  - čiastočný prekryv s inou rezerváciou na tej istej ploche = konflikt, udalosť sa preskočí a vypíše;
 *    presne rovnaký čas (napr. tréning viacerých družstiev) je povolený,
 *  - pri zápise sa nastaví pitchId, miesto a povrch podľa plochy; adresa sa doplní len ak ju udalosť nemá.
 */
import { PrismaClient } from '@prisma/client';
import { planPitchAssignment } from '../src/pitches/pitch-assign.plan';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INCLUDE_PAST = args.includes('--include-past');
const mapping: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--map' && args[i + 1]) {
    const [from, ...to] = args[i + 1]!.split('=');
    if (from && to.length) mapping[from] = to.join('=');
  }
}

function targetHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname.replace(/^\//, '') ? '/' + u.pathname.replace(/^\//, '') : ''}`;
  } catch {
    return '(neplatná DATABASE_URL)';
  }
}

const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' '); // nástenný čas (UTC komponenty)

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('CHYBA: DATABASE_URL nie je nastavená – skript sa nespustí.');
    process.exit(1);
  }
  console.log(`Priradenie hracích plôch — režim: ${APPLY ? 'APPLY (ZÁPIS)' : 'DRY-RUN (nič sa nezapisuje)'}`);
  console.log(`Cieľová databáza (host): ${targetHost(dbUrl)}`);

  const prisma = new PrismaClient();
  try {
    const pitches = await prisma.pitch.findMany({ orderBy: { sortOrder: 'asc' } });
    if (pitches.length === 0) {
      console.error('CHYBA: Nie je zadaná žiadna hracia plocha. Najprv ich pridajte v Nastaveniach → Hracie plochy.');
      process.exit(1);
    }
    console.log(`Plochy: ${pitches.map((p) => p.name).join(' | ')}`);
    if (Object.keys(mapping).length) console.log(`Ručné mapovanie: ${Object.entries(mapping).map(([k, v]) => `„${k}" → „${v}"`).join('; ')}`);

    const rows = await prisma.event.findMany({
      where: { isDemo: false, type: { in: ['TRAINING', 'MATCH', 'TOURNAMENT'] } },
      select: { id: true, type: true, title: true, startAt: true, endAt: true, location: true, address: true, pitchId: true, parentEventId: true, match: { select: { isHome: true } } },
    });
    const plan = planPitchAssignment({
      pitches,
      events: rows.map((r) => ({ id: r.id, type: r.type, title: r.title, startAt: r.startAt, endAt: r.endAt, location: r.location, pitchId: r.pitchId, parentEventId: r.parentEventId, isHome: r.match?.isHome ?? null })),
      reserved: rows.filter((r) => r.pitchId).map((r) => ({ title: r.title, pitchId: r.pitchId!, startAt: r.startAt, endAt: r.endAt })),
      mapping,
      includePast: INCLUDE_PAST,
      // čas udalostí je „nástenný" v UTC → „teraz" v rovnakej reprezentácii
      now: new Date(Date.now() + bratislavaOffsetMs()),
    });

    const byId = new Map(rows.map((r) => [r.id, r]));
    const pitchById = new Map(pitches.map((p) => [p.id, p]));
    console.log(`\nNa priradenie: ${plan.assignments.length}`);
    for (const a of plan.assignments) {
      const e = byId.get(a.eventId)!;
      console.log(`  PRIRADIŤ  ${fmt(e.startAt)}  ${e.title}  [${e.location}] → ${pitchById.get(a.pitchId)!.name}`);
    }
    if (plan.conflicts.length) {
      console.log(`\nKonflikty (preskočené, vyriešte ručne): ${plan.conflicts.length}`);
      for (const c of plan.conflicts) console.log(`  KONFLIKT  ${fmt(c.startAt)}  ${c.title} → ${c.pitchName} sa prekrýva s „${c.clashWith}"`);
    }
    if (plan.unmatched.size) {
      console.log(`\nNespárované miesta (použite --map "text=Názov plochy"):`);
      for (const [text, n] of plan.unmatched) console.log(`  „${text}" — ${n} udalostí`);
    }

    if (APPLY && plan.assignments.length) {
      await prisma.$transaction(
        plan.assignments.map((a) => {
          const p = pitchById.get(a.pitchId)!;
          const e = byId.get(a.eventId)!;
          return prisma.event.update({
            where: { id: a.eventId },
            data: { pitchId: p.id, location: p.name, surface: p.surface, address: e.address ?? p.address },
          });
        }),
      );
      console.log(`\nZapísané: ${plan.assignments.length} udalostí.`);
    } else if (!APPLY) {
      console.log('\nNič sa nezapísalo. Na zápis spusti s --apply.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** Posun bratislavského nástenného času voči UTC (ms) v tejto chvíli. */
function bratislavaOffsetMs(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value])) as Record<string, string>;
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return wall - Math.floor(now.getTime() / 1000) * 1000;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
