'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatEventDateTimeSk } from '@fkknv/shared';
import { categoryColor } from '@/lib/colors';
import { canManage, coachTeams, isParent, isPlayer, isStaff, useMe } from '@/lib/auth';
import { Card } from '@/components/ui';
import { AddressLink } from '@/components/AddressLink';
import { NominationRequestsPanel } from '@/components/cross-nomination';

interface PlayedMatch {
  id: string;
  opponent: string;
  opponentLogo: string | null;
  isHome: boolean;
  scoreUs: number | null;
  scoreThem: number | null;
  event: { startAt: string; team: { name: string } | null };
}

interface EventItem {
  id: string;
  type: string;
  title: string;
  startAt: string;
  location: string | null;
  address: string | null;
  team: { name: string; teamCategory?: { code: string } } | null;
  match: { id: string; opponent: string; isHome: boolean; opponentLogo: string | null } | null;
}

// logo nášho klubu (FK Košická Nová Ves) z futbalnetu
const OUR_LOGO = 'https://api.sportnet.online/data/ppo/fk-kosicka-nova-ves.futbalnet.sk/logo';

function DashLogo({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="inline-block h-6 w-6 object-contain"
      onError={(ev) => (ev.currentTarget.style.visibility = 'hidden')}
    />
  );
}

/** Zápas ako mini-tabuľka: domáci hore, hostia dole. */
function DashMatchTeams({ e }: { e: EventItem }) {
  const m = e.match!;
  const our = { name: e.team?.name ?? 'FK KNV', logo: OUR_LOGO };
  const opp = { name: m.opponent, logo: m.opponentLogo };
  const home = m.isHome ? our : opp;
  const away = m.isHome ? opp : our;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        {home.logo && <DashLogo src={home.logo} />}
        <span className="font-medium text-club-900">{home.name}</span>
      </div>
      <div className="flex items-center gap-2">
        {away.logo && <DashLogo src={away.logo} />}
        <span className="font-medium text-club-900">{away.name}</span>
      </div>
    </div>
  );
}
interface Payment {
  periodLabel: string;
  amountCents: number;
  paidCents: number;
  status: string;
}
interface RegCard {
  id: string;
  firstName: string;
  lastName: string;
  registrationNumber: string | null;
  registrationValidUntil: string;
  team: string | null;
  daysLeft: number;
  expired: boolean;
}

const typeLabels: Record<string, string> = {
  TRAINING: 'Tréning',
  MATCH: 'Zápas',
  TOURNAMENT: 'Turnaj',
  CLUB_EVENT: 'Podujatie',
};

export default function DashboardPage() {
  const { me } = useMe();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [played, setPlayed] = useState<PlayedMatch[]>([]);

  useEffect(() => {
    api<PlayedMatch[]>('/matches/played?mine=true&limit=6').then(setPlayed).catch(() => {});
    const from = new Date().toISOString();
    api<EventItem[]>(`/events?mine=true&from=${from}`).then((l) => setEvents(l.slice(0, 50))).catch(() => {});
  }, []);

  const staff = isStaff(me);
  const teams = coachTeams(me);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-club-900">
          Vitajte{me ? `, ${me.firstName}` : ''}
        </h1>
        <p className="text-sm text-gray-500">
          {staff
            ? 'Prehľad klubu — členovia, platby a udalosti.'
            : teams.length > 0
              ? `Tréner družstiev: ${teams.map((t) => t.name).join(', ')}`
              : isParent(me)
                ? 'Prehľad vašich detí a klubu.'
                : 'Váš prehľad.'}
        </p>
      </div>

      {canManage(me) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/portal/prehlady/dochadzka"
            className="fk-card fk-link flex items-center gap-4"
          >
            <span className="text-3xl">📋</span>
            <span>
              <span className="fk-kicker">Dochádzka</span>
              <span className="fk-title mt-1">Dochádzka</span>
              <span className="fk-desc mt-1 block">Dochádzkový list družstva za mesiac</span>
            </span>
          </Link>
          <Link
            href="/portal/ulohy"
            className="fk-card fk-link flex items-center gap-4"
          >
            <span className="text-3xl">✅</span>
            <span>
              <span className="fk-kicker">Úlohy</span>
              <span className="fk-title mt-1">Úlohy</span>
              <span className="fk-desc mt-1 block">Zadania a ich plnenie</span>
            </span>
          </Link>
        </div>
      )}

      {staff && <StaffTiles />}
      <MatchConfirmations />
      <NominationRequestsPanel />
      <RegistrationCards staff={staff} />
      {isPlayer(me) && me?.memberId && <MyPayments memberId={me.memberId} />}

      {staff && <PlayersByGroup />}

      <div className="grid gap-6 lg:grid-cols-2">
        <EventList title="Najbližšie zápasy" events={events.filter((e) => e.match).slice(0, 6)} />
        <EventList title="Najbližšie tréningy" events={events.filter((e) => e.type === 'TRAINING').slice(0, 6)} />
      </div>

      <PlayedMatches matches={played} />
    </div>
  );
}

/** Posledných 6 odohraných zápasov: dva stĺpce po troch (od najnovšieho, po stĺpcoch). */
function PlayedMatches({ matches }: { matches: PlayedMatch[] }) {
  return (
    <section>
      <h2 className="mb-3 font-bold text-club-900">Odohraté zápasy</h2>
      {matches.length === 0 ? (
        <Card className="text-sm text-gray-500">Zatiaľ žiadne odohraté zápasy.</Card>
      ) : (
        <ul className="grid gap-x-6 border-club-100 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-3">
          {matches.map((m) => {
            const us = m.scoreUs ?? 0;
            const them = m.scoreThem ?? 0;
            const result = us > them ? 'V' : us < them ? 'P' : 'R';
            const resultCls = result === 'V' ? 'bg-green-100 text-green-800' : result === 'P' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700';
            const d = new Date(m.event.startAt); // nástenný čas v UTC
            const ourName = m.event.team?.name ?? 'FK KNV';
            const home = m.isHome ? { name: ourName, logo: OUR_LOGO, score: us } : { name: m.opponent, logo: m.opponentLogo, score: them };
            const away = m.isHome ? { name: m.opponent, logo: m.opponentLogo, score: them } : { name: ourName, logo: OUR_LOGO, score: us };
            return (
              <li key={m.id} className="mb-2 border border-club-100 bg-white">
                <Link href={`/portal/zapasy/${m.id}`} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 px-3 py-2 hover:bg-club-50">
                  <div className="text-center text-xs leading-tight text-gray-500">
                    <div className="text-base font-bold text-club-900">{d.getUTCDate()}.{d.getUTCMonth() + 1}.</div>
                    <div>{d.getUTCFullYear()}</div>
                  </div>
                  <div className="min-w-0 space-y-0.5 text-sm">
                    {[home, away].map((t, i) => (
                      <div key={i} className="flex items-center gap-2">
                        {t.logo && <DashLogo src={t.logo} />}
                        <span className="min-w-0 flex-1 truncate font-medium text-club-900">{t.name}</span>
                        <span className="font-bold text-club-900">{t.score}</span>
                      </div>
                    ))}
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${resultCls}`} title={result === 'V' ? 'Výhra' : result === 'P' ? 'Prehra' : 'Remíza'}>
                    {result}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const MONTHS_SK = ['JAN', 'FEB', 'MAR', 'APR', 'MÁJ', 'JÚN', 'JÚL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEC'];

function EventList({ title, events }: { title: string; events: EventItem[] }) {
  return (
    <section>
      <h2 className="mb-3 font-bold text-club-900">{title}</h2>
      {events.length === 0 ? (
        <Card className="text-sm text-gray-500">Zatiaľ žiadne naplánované.</Card>
      ) : (
        <ul className="border border-club-100 bg-white">
          {events.map((e) => {
            const href = e.match ? `/portal/zapasy/${e.match.id}` : e.type === 'TOURNAMENT' ? `/portal/turnaje/${e.id}` : `/portal/dochadzka/${e.id}`;
            const c = categoryColor(e.team?.teamCategory?.code);
            // čas udalosti je vedený ako UTC „nástenný" čas
            const d = new Date(e.startAt);
            const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
            return (
              <li key={e.id} className="border-b border-club-100 last:border-b-0">
                <Link
                  href={href}
                  className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-4 px-4 py-3 hover:bg-club-50"
                  style={{ borderLeft: `4px solid ${c.text}` }}
                >
                  <div className="text-center leading-none">
                    <div className="font-[family-name:var(--head-font)] text-3xl font-bold text-club-900">{d.getUTCDate()}</div>
                    <div className="mt-1 text-[11px] font-semibold tracking-widest text-gray-400">{MONTHS_SK[d.getUTCMonth()]}</div>
                  </div>
                  <div className="min-w-0">
                    {e.match ? (
                      <DashMatchTeams e={e} />
                    ) : (
                      <div className="font-semibold text-club-900">{e.title}</div>
                    )}
                    <div className="mt-1 truncate text-xs text-gray-500">
                      {time}
                      {e.location ? ` · ${e.location}` : ''}
                      {e.address ? ` · ${e.address}` : ''}
                    </div>
                  </div>
                  <span
                    className="whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                    style={{ backgroundColor: c.bg, color: c.text }}
                  >
                    {e.team?.name ?? typeLabels[e.type] ?? e.type}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface PlayerRow {
  id: string;
  firstName: string;
  lastName: string;
  memberships: Array<{ team: { name: string; teamCategory: { code: string } } }>;
}
interface Group {
  players: PlayerRow[];
  categoryCode: string | null;
}

function PlayersByGroup() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<PlayerRow[]>('/members?role=PLAYER')
      .then(setPlayers)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  // zoskup hráčov podľa skupiny (hráč vo viacerých skupinách sa objaví v každej)
  const groups = new Map<string, Group>();
  const add = (key: string, code: string | null, p: PlayerRow) => {
    const g = groups.get(key) ?? { players: [], categoryCode: code };
    g.players.push(p);
    groups.set(key, g);
  };
  for (const p of players) {
    if (p.memberships.length === 0) add('Nezaradení', null, p);
    else for (const m of p.memberships) add(m.team.name, m.team.teamCategory.code, p);
  }
  const sorted = [...groups.entries()].sort((a, b) =>
    a[0] === 'Nezaradení' ? 1 : b[0] === 'Nezaradení' ? -1 : a[0].localeCompare(b[0], 'sk'),
  );

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 className="font-bold text-club-900">Hráči podľa skupín</h2>
        <Link href="/portal/clenovia" className="text-sm font-semibold text-club-700 hover:text-[#c8f567]">
          Všetci členovia →
        </Link>
      </div>
      {sorted.length === 0 ? (
        <Card className="text-sm text-gray-500">Zatiaľ žiadni hráči.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map(([group, g]) => {
            const c = categoryColor(g.categoryCode);
            return (
              <div
                key={group}
                className="fk-grp"
                style={{ backgroundColor: c.bg, borderColor: c.text + '55', borderTopColor: c.text }}
              >
                <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: c.text + '33' }}>
                  <span
                    className="px-2 py-0.5 text-[11px] font-bold uppercase tracking-[1.4px]"
                    style={{ backgroundColor: c.text, color: '#080e13' }}
                  >
                    {group}
                  </span>
                  <span className="font-[family-name:var(--head-font)] text-3xl font-extrabold leading-none text-white">
                    {g.players.length}
                  </span>
                </div>
                <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-sm text-[#f2f5f5]">
                  {g.players
                    .sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName, 'sk'))
                    .map((p) => (
                      <li key={p.id}>
                        {p.lastName} {p.firstName}
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface Nomination {
  id: string;
  status: string;
  member: { firstName: string; lastName: string };
  opponent: string;
  isHome: boolean;
  startAt: string;
  location: string | null;
  address?: string | null;
  team: string | null;
  category: string | null;
}

/** Potvrdenie účasti na zápase (U17/U19/Muži) — pre hráča a rodiča. */
function MatchConfirmations() {
  const [noms, setNoms] = useState<Nomination[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = () => api<Nomination[]>('/matches/my/nominations').then(setNoms).catch(() => {}).finally(() => setLoaded(true));
  useEffect(() => {
    void load();
  }, []);

  async function respond(id: string, status: 'CONFIRMED' | 'DECLINED') {
    await api(`/matches/nominations/${id}/respond`, { method: 'POST', body: JSON.stringify({ status }) }).catch(() => {});
    await load();
  }

  if (!loaded || noms.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="font-bold text-club-900">Potvrdenie účasti na zápase</h2>
      <ul className="divide-y divide-club-100 rounded-lg border border-club-100 bg-white">
        {noms.map((n) => {
          const c = categoryColor(n.category);
          const confirmed = n.status === 'CONFIRMED';
          const declined = n.status === 'DECLINED';
          return (
            <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <span
                  className="mr-2 rounded px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: c.bg, color: c.text }}
                >
                  Zápas{n.team ? ` · ${n.team}` : ''}
                </span>
                <span className="font-medium">
                  {n.member.lastName} {n.member.firstName}
                </span>
                <span className="ml-2 text-sm text-gray-600">
                  {n.isHome ? 'doma' : 'vonku'} vs {n.opponent} ·{' '}
                  {formatEventDateTimeSk(n.startAt)}
                  {n.location ? ` · ${n.location}` : ''}
                  {n.address && (
                    <>
                      {' · '}
                      <AddressLink address={n.address} />
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {confirmed && <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Prídem ✓</span>}
                {declined && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Neprídem</span>}
                <button
                  onClick={() => respond(n.id, 'CONFIRMED')}
                  className={`rounded-md px-3 py-1 text-sm font-medium ${confirmed ? 'bg-green-600 text-white' : 'border border-green-600 text-green-700 hover:bg-green-50'}`}
                >
                  Prídem
                </button>
                <button
                  onClick={() => respond(n.id, 'DECLINED')}
                  className={`rounded-md px-3 py-1 text-sm font-medium ${declined ? 'bg-red-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                >
                  Neprídem
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RegistrationCards({ staff }: { staff: boolean }) {
  const [cards, setCards] = useState<RegCard[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<RegCard[]>('/members/registration-cards')
      .then(setCards)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || cards.length === 0) return null;

  const expiredCount = cards.filter((c) => c.expired).length;
  const soonCount = cards.filter((c) => !c.expired && c.daysLeft <= 30).length;
  // vedeniu/trénerovi zobraz najkritickejšie (max 12), sebe/deťom všetky
  const shown = staff ? cards.slice(0, 12) : cards;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 className="font-bold text-club-900">
          {staff ? 'Platnosť registračných preukazov' : 'Registračný preukaz'}
        </h2>
        {staff && (expiredCount > 0 || soonCount > 0) && (
          <span className="text-sm text-gray-500">
            {expiredCount > 0 && <span className="font-bold text-[#ff6b89]">{expiredCount} po platnosti</span>}
            {expiredCount > 0 && soonCount > 0 && ' · '}
            {soonCount > 0 && <span className="font-bold text-[#f0c05a]">{soonCount} do 30 dní</span>}
          </span>
        )}
      </div>
      <ul className="border border-club-100 bg-white">
        {shown.map((c) => {
          const until = new Date(c.registrationValidUntil).toLocaleDateString('sk-SK');
          const badgeCls = c.expired
            ? 'bg-[#4a1a28] text-[#ff6b89]'
            : c.daysLeft <= 30
              ? 'bg-[#3d2e0e] text-[#f0c05a]'
              : 'bg-[#163a25] text-[#86e0a0]';
          return (
            <li key={c.id} className="fk-row flex items-center justify-between px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <span className="fk-row-name font-semibold text-club-900">
                  {c.lastName} {c.firstName}
                </span>
                {staff && c.team && <span className="ml-2 text-xs text-gray-500">{c.team}</span>}
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${badgeCls}`}>
                  {c.expired ? `po platnosti (${until})` : `do ${until}`}
                </span>
                {!c.expired && (
                  <span className="text-xs text-gray-400">
                    {c.daysLeft} {c.daysLeft === 1 ? 'deň' : c.daysLeft < 5 ? 'dni' : 'dní'}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {staff && cards.length > shown.length && (
        <p className="text-xs text-gray-500">
          Zobrazených {shown.length} z {cards.length}. Celý zoznam v{' '}
          <Link href="/portal/clenovia" className="text-club-600 hover:underline">
            Členovia
          </Link>
          .
        </p>
      )}
    </section>
  );
}

function StaffTiles() {
  const [members, setMembers] = useState<number | null>(null);
  const [debtors, setDebtors] = useState<number | null>(null);
  useEffect(() => {
    api<unknown[]>('/members?status=ACTIVE').then((m) => setMembers(m.length)).catch(() => {});
    api<unknown[]>('/finance/debtors').then((d) => setDebtors(d.length)).catch(() => {});
  }, []);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Tile label="Aktívnych členov" value={members} href="/portal/clenovia" />
      <Tile label="Dlžníkov" value={debtors} href="/portal/platby" danger={!!debtors} />
      <Tile label="Registrácie" value={null} href="/portal/registracie" hint="Na schválenie" />
    </div>
  );
}

function Tile({
  label,
  value,
  href,
  danger,
  hint,
}: {
  label: string;
  value: number | null;
  href: string;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="h-full">
        <span className="fk-kicker">{label}</span>
        <div className={`fk-num ${danger ? 'fk-danger' : ''}`}>{value ?? (hint ? '→' : '…')}</div>
        <p className="fk-desc">{hint ?? 'Zobraziť zoznam'}</p>
      </Card>
    </Link>
  );
}

function MyPayments({ memberId, name }: { memberId: string; name?: string }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<Payment[]>(`/finance/members/${memberId}/payments`)
      .then(setPayments)
      .catch(() => setError(true));
  }, [memberId]);

  const owed = payments.filter((p) => p.status !== 'PAID' && p.status !== 'WAIVED');
  return (
    <Card>
      {name && <p className="mb-2 font-semibold text-club-900">{name}</p>}
      {error ? (
        <p className="text-sm text-gray-500">Platby sa nepodarilo načítať.</p>
      ) : owed.length === 0 ? (
        <p className="text-sm text-club-700">Všetko uhradené ✓</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {owed.map((p) => (
            <li key={p.periodLabel} className="flex justify-between">
              <span className="text-gray-600">{p.periodLabel}</span>
              <span className={p.status === 'OVERDUE' ? 'font-semibold text-red-600' : 'text-amber-600'}>
                {((p.amountCents - p.paidCents) / 100).toFixed(2)} € {p.status === 'OVERDUE' ? '· po splatnosti' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
