import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getEvents, getSquad, getTeams } from '@/lib/verejne/public-api';
import { DEFAULT_TZ, groupByCategory } from '@/lib/verejne/format';
import PageTop from '@/components/verejne/PageTop';
import TeamTabs from '@/components/verejne/TeamTabs';
import PlayerCard from '@/components/verejne/PlayerCard';
import EventRow from '@/components/verejne/EventRow';
import { pageMeta } from '@/lib/verejne/seo';

export const dynamic = 'force-dynamic';

type Params = Promise<{ kod: string }>;
type Search = Promise<{ tim?: string | string[]; zalozka?: string | string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { kod } = await params;
  const path = `/muzstva/${encodeURIComponent(kod.toLowerCase())}`;
  try {
    const cat = groupByCategory((await getTeams()).teams).find((c) => c.code.toLowerCase() === kod.toLowerCase());
    if (!cat) return { title: 'Mužstvo sa nenašlo', robots: { index: false } };
    return pageMeta({ title: `${cat.name} — mužstvá`, description: `Súpiska a program mužstva ${cat.name} FK Košická Nová Ves.`, path });
  } catch {
    return pageMeta({ title: 'Naše mužstvá', description: 'Súpiska a program mužstiev FK Košická Nová Ves.', path });
  }
}

export default async function MuzstvoPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { kod } = await params;
  const sp = await searchParams;
  const { teams: allTeams, season, club } = await getTeams();
  const cats = groupByCategory(allTeams);
  const cat = cats.find((c) => c.code.toLowerCase() === kod.toLowerCase());
  if (!cat) notFound();

  const tz = club.timezone || DEFAULT_TZ;
  const timParam = Array.isArray(sp.tim) ? sp.tim[0] : sp.tim;
  const program = (Array.isArray(sp.zalozka) ? sp.zalozka[0] : sp.zalozka) === 'program';
  const team = cat.teams.find((t) => t.id === timParam) ?? cat.teams[0];

  const squad = program ? null : await getSquad(team.id);
  const events = program ? (await getEvents({ teamId: team.id, from: season.startDate, to: season.endDate, limit: 300 })).events : [];
  if (!program && !squad) notFound();
  const players = squad?.players ?? [];
  const rows = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt));

  const base = `/muzstva/${cat.code.toLowerCase()}`;
  const q = (tim: string | null, zal: boolean) => {
    const p = new URLSearchParams();
    if (tim) p.set('tim', tim);
    if (zal) p.set('zalozka', 'program');
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  const keepTeam = cat.teams.length > 1 ? team.id : null;

  return (
    <>
      <PageTop label="JEDEN KLUB · VŠETKY GENERÁCIE" title="NAŠE MUŽSTVÁ." desc="Od prípravky po mužov. Vyber si kategóriu a spoznaj svoj tím.">
        <TeamTabs label="Kategórie" items={cats.map((c) => ({ href: `/muzstva/${c.code.toLowerCase()}`, label: c.name, active: c.code === cat.code }))} />
      </PageTop>
      <section className="section">
        <div className="roster-header">
          <div>
            {team.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.logoUrl} alt={`Logo ${team.name}`} height={64} style={{ height: 64, width: 'auto', marginBottom: 8 }} />
            )}
            <span className="label">SEZÓNA {season.name}</span>
            <h2>{cat.name}</h2>
          </div>
          <TeamTabs
            variant="filter"
            label="Záložky"
            items={[
              { href: q(keepTeam, false), label: 'Súpiska', active: !program },
              { href: q(keepTeam, true), label: 'Program tímu', active: program },
            ]}
          />
        </div>
        {cat.teams.length > 1 && (
          <TeamTabs label="Družstvá" items={cat.teams.map((t) => ({ href: q(t.id, program), label: t.name, active: t.id === team.id }))} />
        )}
        {program ? (
          rows.length ? (
            <ul className="event-list">{rows.map((e) => <EventRow key={e.id} event={e} tz={tz} />)}</ul>
          ) : (
            <div className="empty">Pre tento tím zatiaľ nie sú naplánované žiadne udalosti.</div>
          )
        ) : players.length ? (
          <>
            <p className="tiny-note">Zverejnení sú hráči so súhlasom klubu ({players.length} z {squad!.team.rosterSize} v súpiske).</p>
            <div className="roster-grid"><div className="players">{players.map((p) => <PlayerCard key={p.id} player={p} />)}</div></div>
          </>
        ) : (
          <div className="empty">Súpiska zatiaľ nie je zverejnená.</div>
        )}
      </section>
    </>
  );
}
