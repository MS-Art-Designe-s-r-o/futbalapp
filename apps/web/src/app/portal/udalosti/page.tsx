'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  WEEKDAY_SHORT_SK,
  SURFACE_CODES,
  SURFACE_LABELS_SK,
  addMinutesToHhmm,
  defaultEventMinutes,
  formatEventDateTimeSk,
  formatEventTimeSk,
  type SurfaceCode,
} from '@fkknv/shared';
import { categoryColor, eventTypeColor } from '@/lib/colors';
import { api, ApiError } from '@/lib/api';
import { canManage, canManageTeam, coachTeams, isStaff, useMe, type Me } from '@/lib/auth';
import { Button, Card, ErrorText, Modal, inputCls, labelCls } from '@/components/ui';
import { ClubPicker } from '@/components/club-picker';
import { JerseyBadges, JerseyIcon, JerseyPicker, type JerseyColor } from '@/components/jersey';
import { AddressField, PitchPicker } from '@/components/pitch-picker';

interface Team {
  id: string;
  name: string;
  teamCategory: { code: string; name: string; sortOrder: number };
}
interface Pitch {
  id: string;
  name: string;
  surface: SurfaceCode;
}
interface Occupancy {
  id: string;
  pitchId: string;
  type: string;
  title: string;
  startAt: string;
  endAt: string | null;
  teamName: string | null;
}
interface EventItem {
  id: string;
  type: string;
  title: string;
  startAt: string;
  endAt: string | null;
  location: string | null;
  address: string | null;
  surface: SurfaceCode | null;
  recurrenceGroupId: string | null;
  team: { id: string; name: string; teamCategory: { code: string } } | null;
  audienceTeams?: Array<{ id: string; name: string }>;
  parentEventId?: string | null;
  parent?: { id: string; title: string } | null;
  tournamentOrder?: number | null;
  match: {
    isFriendly?: boolean;
    id: string;
    state: string;
    scoreUs: number | null;
    scoreThem: number | null;
    opponent: string;
    isHome: boolean;
    opponentLogo: string | null;
    meetAt: string | null;
    notes: string | null;
    jerseyColor: 'DARK' | 'LIGHT' | null;
    opponentJerseyColor?: 'DARK' | 'LIGHT' | null;
  } | null;
}

/** Miesto udalosti: zvolená plocha (pitchId) alebo text + povrch. */
function placeFields(pitchId: string, location: string, surface: string) {
  return pitchId
    ? { pitchId }
    : { location: location || undefined, surface: surface || undefined };
}

const typeLabels: Record<string, string> = {
  TRAINING: 'Tréning',
  MATCH: 'Zápas',
  TOURNAMENT: 'Turnaj',
  CLUB_EVENT: 'Podujatie',
  PARENT_MEETING: 'Rodičovské združenie',
};

/**
 * Odkaz na detail udalosti; `null` = detail sa neotvára.
 * Zápas otvorí každý, kto ho vidí; detail tréningu (dochádzku) len vedenie klubu
 * a tréner daného družstva. Rodičovské združenie a celoklubové podujatia nemajú
 * detail (všetky info sú na karte).
 */
function eventHref(me: Me | null, e: EventItem): string | null {
  if (e.type === 'TOURNAMENT') return `/portal/turnaje/${e.id}`;
  if (e.match) return `/portal/zapasy/${e.match.id}`;
  if (e.type === 'PARENT_MEETING') return null;
  return canManageTeam(me, e.team?.id) ? `/portal/dochadzka/${e.id}` : null;
}

/** Štítok turnajového/priateľského zápasu. */
function extraBadges(e: EventItem, tournamentTitles: Map<string, string>): string[] {
  const out: string[] = [];
  if (e.parentEventId || e.parent) {
    const title = e.parent?.title ?? (e.parentEventId ? tournamentTitles.get(e.parentEventId) : undefined) ?? '';
    out.push(`Turnaj: ${title}${e.tournamentOrder != null ? ` · ${e.tournamentOrder}. zápas` : ''}`.replace('Turnaj: ·', 'Turnaj ·'));
  }
  if (e.match?.isFriendly) out.push('Priateľský');
  return out;
}

/** Kompaktný názov družstva pre kalendár (úspora miesta, bez medzier): „U 13 A" → „U13A". */
function compactTeam(name: string | null | undefined): string {
  return (name ?? '').replace(/\s+/g, '');
}

/** Komu je udalosť určená (rodičovské združenie): zoznam družstiev alebo „celý klub". */
function audienceLabel(e: EventItem): string | null {
  if (e.type !== 'PARENT_MEETING') return null;
  if (e.audienceTeams && e.audienceTeams.length > 0) return e.audienceTeams.map((t) => compactTeam(t.name)).join(', ');
  return 'celý klub';
}

/** Čas zrazu zápasu: explicitný meetAt, inak hodina pred začiatkom. */
function matchMeetTime(e: EventItem): Date | null {
  if (!e.match) return null;
  if (e.match.meetAt) return new Date(e.match.meetAt);
  return new Date(new Date(e.startAt).getTime() - 3_600_000);
}

// logo nášho klubu (FK Košická Nová Ves) z futbalnetu
const OUR_LOGO = 'https://api.sportnet.online/data/ppo/fk-kosicka-nova-ves.futbalnet.sk/logo';

function Logo({ src, size = 20 }: { src: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      style={{ width: size, height: size }}
      className="inline-block object-contain align-text-bottom"
      onError={(ev) => (ev.currentTarget.style.visibility = 'hidden')}
    />
  );
}

/** Zápas ako mini-tabuľka: domáci hore, hostia dole (s logami a skóre). */
function MatchTeams({ e }: { e: EventItem }) {
  const m = e.match!;
  const our = { name: compactTeam(e.team?.name) || 'FK KNV', logo: OUR_LOGO };
  const opp = { name: m.opponent, logo: m.opponentLogo };
  const home = m.isHome ? our : opp;
  const away = m.isHome ? opp : our;
  const hasScore = m.scoreUs !== null && m.scoreThem !== null;
  const homeScore = m.isHome ? m.scoreUs : m.scoreThem;
  const awayScore = m.isHome ? m.scoreThem : m.scoreUs;
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2">
        {home.logo && <Logo src={home.logo} size={24} />}
        <span className="font-medium text-club-900">{home.name}</span>
        {hasScore && <span className="ml-auto text-lg font-bold text-club-800">{homeScore}</span>}
      </div>
      <div className="flex items-center gap-2">
        {away.logo && <Logo src={away.logo} size={24} />}
        <span className="font-medium text-club-900">{away.name}</span>
        {hasScore && <span className="ml-auto text-lg font-bold text-club-800">{awayScore}</span>}
      </div>
    </div>
  );
}

export default function EventsPage() {
  const { me } = useMe();
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamFilter, setTeamFilter] = useState('');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [nominatedMatchIds, setNominatedMatchIds] = useState<Set<string>>(new Set());
  const [venues, setVenues] = useState<string[]>([]);
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [occupancy, setOccupancy] = useState<Occupancy[]>([]);
  const [pitchFilter, setPitchFilter] = useState('');
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [initialDate, setInitialDate] = useState('');
  const [opponents, setOpponents] = useState<string[]>([]);
  const [view, setView] = useState<'list' | 'month'>('list');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // tréner vidí len svoje družstvá; vedenie všetky
  const availableTeams = useMemo(() => {
    if (isStaff(me)) return teams;
    const coachIds = new Set(coachTeams(me).map((t) => t.id));
    return teams.filter((t) => coachIds.has(t.id));
  }, [teams, me]);

  // zapamätané zobrazenie kalendára (Najbližšie/Mesiac) pre daného používateľa
  const viewKey = me ? `fkknv:cal-view:${me.id}` : null;
  useEffect(() => {
    if (!viewKey) return;
    try {
      const v = localStorage.getItem(viewKey);
      if (v === 'list' || v === 'month') setView(v);
    } catch {
      /* localStorage nedostupný — ignoruj */
    }
  }, [viewKey]);
  function changeView(v: 'list' | 'month') {
    setView(v);
    try {
      if (viewKey) localStorage.setItem(viewKey, v);
    } catch {
      /* ignoruj */
    }
  }

  const load = useCallback(async () => {
    try {
      const q = teamFilter ? `&team=${teamFilter}` : '';
      let url: string;
      if (view === 'month') {
        const from = new Date(month.getFullYear(), month.getMonth(), 1);
        const to = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59);
        url = `/events?from=${from.toISOString()}&to=${to.toISOString()}${q}`;
      } else {
        const from = new Date();
        from.setMonth(from.getMonth() - 1);
        url = `/events?from=${from.toISOString()}${q}`;
      }
      const list = await api<EventItem[]>(url);
      setEvents(list);
      if (canManage(me)) {
        const from = new Date(month.getFullYear(), month.getMonth(), 1);
        const to = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59);
        api<Occupancy[]>(`/pitches/occupancy?from=${from.toISOString()}&to=${to.toISOString()}`)
          .then(setOccupancy)
          .catch(() => setOccupancy([]));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
    }
  }, [teamFilter, view, month, me]);

  useEffect(() => {
    api<Team[]>('/seasons/teams').then(setTeams).catch(() => {});
    api<string[]>('/events/locations').then(setVenues).catch(() => {});
    api<Pitch[]>('/pitches').then(setPitches).catch(() => {});
    api<Array<{ matchId: string }>>('/matches/my/nominated')
      .then((rows) => setNominatedMatchIds(new Set(rows.map((r) => r.matchId))))
      .catch(() => {});
    Promise.all([
      api<string[]>('/matches/opponents').catch(() => []),
      api<Array<{ name: string }>>('/clubs').catch(() => []),
    ])
      .then(([opp, clubs]) => {
        const names = new Set<string>([...opp, ...clubs.map((c) => c.name)]);
        setOpponents([...names].sort((a, b) => a.localeCompare(b, 'sk')));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const tournamentTitles = useMemo(
    () => new Map(events.filter((e) => e.type === 'TOURNAMENT').map((e) => [e.id, e.title] as const)),
    [events],
  );

  const grouped = useMemo(() => {
    const now = Date.now();
    return {
      upcoming: events.filter((e) => new Date(e.startAt).getTime() >= now - 3 * 3600_000),
      past: events.filter((e) => new Date(e.startAt).getTime() < now - 3 * 3600_000).reverse(),
    };
  }, [events]);

  return (
    <div className="space-y-6">
      <datalist id="venue-list">
        {venues.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="opponent-list">
        {opponents.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-club-900">Kalendár</h1>
        {canManage(me) && (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setTrainingOpen(true)}>
              + Tréning
            </Button>
            <Button variant="ghost" onClick={() => setMeetingOpen(true)}>
              + Rodičovské
            </Button>
            <Button onClick={() => setMatchOpen(true)}>+ Zápas / turnaj</Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* filter družstiev len pre vedenie/trénerov; rodič/hráč vidí len svoje družstvá */}
        {canManage(me) && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Družstvo:</label>
            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
              <option value="">Všetky</option>
              {availableTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* prepínač zobrazenia — voľba sa pamätá pre daného používateľa */}
        <div className="ml-auto inline-flex overflow-hidden rounded-md border border-club-200">
          <button
            onClick={() => changeView('list')}
            className={`px-3 py-1 text-sm ${view === 'list' ? 'bg-club-600 text-white' : 'bg-white text-club-700'}`}
          >
            Najbližšie
          </button>
          <button
            onClick={() => changeView('month')}
            className={`px-3 py-1 text-sm ${view === 'month' ? 'bg-club-600 text-white' : 'bg-white text-club-700'}`}
          >
            Mesiac
          </button>
        </div>
      </div>

      {view === 'month' && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>
            ‹
          </Button>
          <input
            type="month"
            value={`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`}
            onChange={(e) => {
              const [y, mo] = e.target.value.split('-').map(Number);
              if (y && mo) setMonth(new Date(y, mo - 1, 1));
            }}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <Button variant="ghost" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>
            ›
          </Button>
          <Button variant="ghost" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>
            Dnes
          </Button>
          {canManage(me) && pitches.length > 0 && (
            <div className="ml-2 flex items-center gap-2">
              <label className="text-sm text-gray-600">Obsadenosť plochy:</label>
              <select value={pitchFilter} onChange={(e) => setPitchFilter(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
                <option value="">— zobraziť udalosti —</option>
                {pitches.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <ErrorText>{error}</ErrorText>

      {view === 'list' ? (
        <>
          <EventList tournamentTitles={tournamentTitles} me={me} nominated={nominatedMatchIds} title="Najbližšie" events={grouped.upcoming} empty="Žiadne naplánované udalosti." />
          {grouped.past.length > 0 && <EventList tournamentTitles={tournamentTitles} me={me} nominated={nominatedMatchIds} title="Odohrané" events={grouped.past.slice(0, 20)} empty="" />}
        </>
      ) : (
        <MonthView
          me={me}
          nominated={nominatedMatchIds}
          month={month}
          events={events}
          pitchOccupancy={pitchFilter ? occupancy.filter((o) => o.pitchId === pitchFilter) : null}
          onDayClick={canManage(me) ? setDayOpen : undefined}
        />
      )}

      <DayModal
        day={dayOpen}
        pitches={pitches}
        occupancy={occupancy}
        onClose={() => setDayOpen(null)}
        onPick={(kind) => {
          setInitialDate(dayOpen ?? '');
          setDayOpen(null);
          if (kind === 'training') setTrainingOpen(true);
          else setMatchOpen(true);
        }}
      />
      <TrainingModal
        open={trainingOpen}
        initialDate={initialDate}
        pitches={pitches}
        onClose={() => {
          setTrainingOpen(false);
          setInitialDate('');
        }}
        teams={availableTeams}
        onDone={() => {
          setTrainingOpen(false);
          void load();
        }}
      />
      <MatchModal
        open={matchOpen}
        initialDate={initialDate}
        pitches={pitches}
        onClose={() => {
          setMatchOpen(false);
          setInitialDate('');
        }}
        teams={availableTeams}
        onDone={() => {
          setMatchOpen(false);
          void load();
        }}
      />
      <ParentMeetingModal
        open={meetingOpen}
        onClose={() => setMeetingOpen(false)}
        teams={availableTeams}
        canWholeClub={isStaff(me)}
        onDone={() => {
          setMeetingOpen(false);
          void load();
        }}
      />
    </div>
  );
}

function EventList({
  tournamentTitles,
  me,
  nominated,
  title,
  events,
  empty,
}: {
  tournamentTitles: Map<string, string>;
  me: Me | null;
  nominated: Set<string>;
  title: string;
  events: EventItem[];
  empty: string;
}) {
  return (
    <section>
      <h2 className="mb-2 font-semibold text-club-800">{title}</h2>
      {events.length === 0 ? (
        empty ? <Card className="text-sm text-gray-500">{empty}</Card> : null
      ) : (
        <ul className="divide-y divide-club-100 rounded-lg border border-club-100 bg-white">
          {events.map((e) => {
            const href = eventHref(me, e);
            const c = eventTypeColor(e.type);
            const audience = audienceLabel(e);
            const isNominated = !!e.match && nominated.has(e.match.id);
            const badges = extraBadges(e, tournamentTitles);
            const body = (
              <>
                <span
                  className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: c.bg, color: c.text }}
                >
                  {typeLabels[e.type] ?? e.type}
                  {e.team ? ` · ${compactTeam(e.team.name)}` : ''}
                  {e.recurrenceGroupId ? ' · séria' : ''}
                </span>
                {badges.map((b) => (
                  <span key={b} className="ml-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    {b}
                  </span>
                ))}
                {isNominated && (
                  <span className="ml-2 inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    Nominovaný
                  </span>
                )}
                <div className="mt-1 text-sm text-gray-600">
                  {formatEventDateTimeSk(e.startAt)}
                  {e.endAt ? `–${formatEventTimeSk(e.endAt)}` : ''}
                </div>
                {e.match ? <MatchTeams e={e} /> : <div className="mt-1 font-medium">{e.title}</div>}
                {e.match && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                    <JerseyBadges ours={e.match.jerseyColor} theirs={e.match.opponentJerseyColor} />
                    <span>
                      Zraz: {formatEventTimeSk(matchMeetTime(e)!)}
                      {e.match.notes ? ` · ${e.match.notes}` : ''}
                    </span>
                  </div>
                )}
                {audience && <div className="mt-1 text-xs text-club-700">Pre: {audience}</div>}
                {(e.location || e.address || e.surface) && (
                  <div className="mt-1 text-xs text-gray-500">
                    {e.location}
                    {e.location && e.address ? ' · ' : ''}
                    {e.address}
                    {(e.location || e.address) && e.surface ? ' · ' : ''}
                    {e.surface ? SURFACE_LABELS_SK[e.surface] : ''}
                  </div>
                )}
              </>
            );
            return (
              <li key={e.id}>
                {href ? (
                  <Link href={href} className="block px-4 py-3 hover:bg-club-50">
                    {body}
                  </Link>
                ) : (
                  <div className="block px-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MonthView({
  me,
  nominated,
  month,
  events,
  pitchOccupancy,
  onDayClick,
}: {
  me: Me | null;
  nominated: Set<string>;
  month: Date;
  events: EventItem[];
  /** zvolená plocha: namiesto udalostí sa v bunkách zobrazí jej obsadenosť */
  pitchOccupancy: Occupancy[] | null;
  /** klik na deň (len pre vedenie/trénera) → vytvorenie tréningu/zápasu */
  onDayClick?: (day: string) => void;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const startWeekday = (new Date(year, m, 1).getDay() + 6) % 7; // Po = 0
  const daysInMonth = new Date(year, m + 1, 0).getDate();

  const byDay = new Map<number, EventItem[]>();
  for (const e of events) {
    // čas udalosti je vedený ako UTC „nástenný" čas → deň čítame z UTC komponentov
    const d = new Date(e.startAt);
    if (d.getUTCFullYear() === year && d.getUTCMonth() === m) {
      const arr = byDay.get(d.getUTCDate()) ?? [];
      arr.push(e);
      byDay.set(d.getUTCDate(), arr);
    }
  }

  const occByDay = new Map<number, Occupancy[]>();
  for (const o of pitchOccupancy ?? []) {
    const d = new Date(o.startAt);
    if (d.getUTCFullYear() === year && d.getUTCMonth() === m) {
      const arr = occByDay.get(d.getUTCDate()) ?? [];
      arr.push(o);
      occByDay.set(d.getUTCDate(), arr);
    }
  }
  const dayKey = (d: number) => `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const cells: Array<number | null> = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const isToday = (d: number) => today.getFullYear() === year && today.getMonth() === m && today.getDate() === d;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-500">
          {['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'].map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => (
            <div
              key={i}
              onClick={d && onDayClick ? () => onDayClick(dayKey(d)) : undefined}
              className={`min-h-[7.5rem] rounded border p-1.5 ${
                d ? (isToday(d) ? 'border-club-500 bg-club-50' : 'border-club-100 bg-white') : 'border-transparent'
              } ${d && !isToday(d) && i % 7 >= 5 ? 'bg-club-50/40' : ''} ${
                d && onDayClick ? 'cursor-pointer hover:bg-club-50' : ''
              }`}
            >
              {d && (
                <>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span
                      className={`text-sm font-bold ${
                        isToday(d) ? 'rounded-sm bg-club-500 px-1.5 text-white' : 'text-gray-400'
                      }`}
                    >
                      {d}
                    </span>
                    {(byDay.get(d) ?? []).length > 0 && !pitchOccupancy && (
                      <span className="text-[10px] text-gray-400">{(byDay.get(d) ?? []).length}×</span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {pitchOccupancy &&
                      (occByDay.get(d) ?? []).map((o) => (
                        <div
                          key={o.id}
                          title={`${formatEventTimeSk(o.startAt)}${o.endAt ? `–${formatEventTimeSk(o.endAt)}` : ''} · ${o.teamName ?? ''} ${o.title}`}
                          className="truncate rounded bg-amber-100 px-1 py-0.5 text-[11px] text-amber-900"
                        >
                          {formatEventTimeSk(o.startAt)}
                          {o.endAt ? `–${formatEventTimeSk(o.endAt)}` : ''} {o.teamName ?? o.title}
                        </div>
                      ))}
                    {pitchOccupancy && (occByDay.get(d) ?? []).length === 0 && (
                      <div className="text-[11px] text-green-700">voľné</div>
                    )}
                    {(pitchOccupancy ? [] : byDay.get(d) ?? [])
                      .slice()
                      .sort((a, b) => a.startAt.localeCompare(b.startAt))
                      .map((e) => {
                        const href = eventHref(me, e);
                        // zápas: farba podľa kategórie družstva + písomné označenie družstva
                        const c = e.match && e.team ? categoryColor(e.team.teamCategory.code) : eventTypeColor(e.type);
                        const time = formatEventTimeSk(e.startAt);
                        const isNominated = !!e.match && nominated.has(e.match.id);
                        // zápas aj tréning: názov družstva (bez medzier) hneď za časom;
                        // tréning má formát „U15A Tréning" (družstvo, potom typ)
                        const label = `${
                          e.match
                            ? `${e.team ? `${compactTeam(e.team.name)} ` : ''}⚽ ${e.match.opponent}`
                            : `${e.team ? `${compactTeam(e.team.name)} ` : ''}${typeLabels[e.type] ?? e.type}`
                        }${e.match?.isFriendly ? ' (prát.)' : ''}${isNominated ? ' ✓' : ''}`;
                        const jersey =
                          e.match?.jerseyColor || e.match?.opponentJerseyColor ? (
                            <span className="flex shrink-0 items-center gap-0.5">
                              {e.match.jerseyColor && (
                                <JerseyIcon
                                  color={e.match.jerseyColor}
                                  size={11}
                                  title={`Náš dres: ${e.match.jerseyColor === 'DARK' ? 'tmavý' : 'svetlý'}`}
                                />
                              )}
                              {e.match.opponentJerseyColor && (
                                <JerseyIcon
                                  color={e.match.opponentJerseyColor}
                                  size={11}
                                  title={`Dres súpera: ${e.match.opponentJerseyColor === 'DARK' ? 'tmavý' : 'svetlý'}`}
                                />
                              )}
                            </span>
                          ) : null;
                        return href ? (
                          <Link
                            key={e.id}
                            href={href}
                            title={`${time}${e.endAt ? `–${formatEventTimeSk(e.endAt)}` : ''} · ${label}`}
                            onClick={(ev) => ev.stopPropagation()}
                            className={`flex items-center gap-1 truncate rounded-sm py-0.5 pl-1.5 pr-1 text-[11px] leading-snug hover:brightness-125 ${
                              e.match ? 'font-semibold' : 'opacity-80'
                            }`}
                            style={{ backgroundColor: c.bg, color: c.text, borderLeft: `3px solid ${c.text}` }}
                          >
                            {jersey}
                            <span className="truncate"><b className="mr-1 font-bold tabular-nums">{time}</b>{label}</span>
                          </Link>
                        ) : (
                          <div
                            key={e.id}
                            title={`${time}${e.endAt ? `–${formatEventTimeSk(e.endAt)}` : ''} · ${label}`}
                            className={`flex items-center gap-1 truncate rounded-sm py-0.5 pl-1.5 pr-1 text-[11px] leading-snug hover:brightness-125 ${
                              e.match ? 'font-semibold' : 'opacity-80'
                            }`}
                            style={{ backgroundColor: c.bg, color: c.text, borderLeft: `3px solid ${c.text}` }}
                          >
                            {jersey}
                            <span className="truncate"><b className="mr-1 font-bold tabular-nums">{time}</b>{label}</span>
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Klik na deň v kalendári: obsadenosť plôch v ten deň + rezervácia (tréning / zápas). */
function DayModal({
  day,
  pitches,
  occupancy,
  onClose,
  onPick,
}: {
  day: string | null;
  pitches: Pitch[];
  occupancy: Occupancy[];
  onClose: () => void;
  onPick: (kind: 'training' | 'match') => void;
}) {
  const items = day ? occupancy.filter((o) => o.startAt.slice(0, 10) === day) : [];
  const [y, mo, d] = (day ?? '').split('-');
  return (
    <Modal open={!!day} onClose={onClose} title={day ? `${Number(d)}. ${Number(mo)}. ${y}` : ''}>
      <div className="space-y-4">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-club-800">Obsadenosť plôch</h3>
          {pitches.length === 0 && <p className="text-sm text-gray-500">Hracie plochy pridáte v Nastaveniach.</p>}
          {pitches.map((p) => {
            const mine = items.filter((o) => o.pitchId === p.id);
            return (
              <div key={p.id} className="rounded border border-club-100 p-2 text-sm">
                <div className="font-medium text-club-900">
                  {p.name} <span className="font-normal text-gray-500">· {SURFACE_LABELS_SK[p.surface]}</span>
                </div>
                {mine.length === 0 ? (
                  <div className="text-green-700">Voľné celý deň</div>
                ) : (
                  <ul className="text-amber-900">
                    {mine.map((o) => (
                      <li key={o.id}>
                        {formatEventTimeSk(o.startAt)}
                        {o.endAt ? `–${formatEventTimeSk(o.endAt)}` : ''} · {o.teamName ? `${o.teamName} · ` : ''}
                        {o.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Zavrieť
          </Button>
          <Button variant="ghost" onClick={() => onPick('training')}>
            + Tréning
          </Button>
          <Button onClick={() => onPick('match')}>+ Zápas</Button>
        </div>
      </div>
    </Modal>
  );
}

function TrainingModal({
  open,
  initialDate,
  pitches,
  onClose,
  teams,
  onDone,
}: {
  open: boolean;
  initialDate: string;
  pitches: Pitch[];
  onClose: () => void;
  teams: Team[];
  onDone: () => void;
}) {
  const [recurring, setRecurring] = useState(true);
  const [pitchId, setPitchId] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const teamId = teamIds[0] ?? '';
  const [title, setTitle] = useState('Tréning');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([2, 5]);
  const [surface, setSurface] = useState('');
  const [startTime, setStartTime] = useState('16:00');
  const [endTime, setEndTime] = useState('17:00');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [date, setDate] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [shared, setShared] = useState<{ message: string; conflicts: Array<{ teamName: string; title: string; startAt: string; endAt: string | null }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && teams[0] && teamIds.length === 0) setTeamIds([teams[0].id]);
  }, [open, teams, teamIds]);
  useEffect(() => {
    if (open && pitches[0] && !pitchId) setPitchId(pitches[0].id);
  }, [open, pitches, pitchId]);
  useEffect(() => {
    if (open && initialDate) {
      setRecurring(false);
      setDate(initialDate);
    }
  }, [open, initialDate]);

  function onStartChange(v: string) {
    setStartTime(v);
    if (v) setEndTime(addMinutesToHhmm(v, defaultEventMinutes('TRAINING')));
  }
  const endInvalid = !!startTime && !!endTime && endTime <= startTime;
  const endMissing = !!pitchId && !endTime;

  function toggleDay(d: number) {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function submit(allowSharedPitch = false) {
    if (endInvalid) return setError('Koniec musí byť po začiatku');
    if (endMissing) return setError('Pri vybranej hracej ploche zadajte koniec');
    setBusy(true);
    setError(null);
    setShared(null);
    try {
      if (recurring) {
        await api('/events/recurring', {
          method: 'POST',
          body: JSON.stringify({ title, teamId, teamIds, weekdays, startTime, endTime, from, until, ...placeFields(pitchId, location, surface), isPublic, allowSharedPitch, address: address.trim() || undefined }),
        });
      } else {
        await api('/events', {
          method: 'POST',
          body: JSON.stringify({
            type: 'TRAINING',
            title,
            teamId,
            teamIds,
            startAt: `${date}T${startTime}:00.000Z`,
            endAt: endTime ? `${date}T${endTime}:00.000Z` : undefined,
            ...placeFields(pitchId, location, surface),
            isPublic,
            allowSharedPitch,
            address: address.trim() || undefined,
          }),
        });
      }
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.body.code === 'PITCH_SHARED') {
        setShared({ message: e.message, conflicts: e.body.conflicts ?? [] });
        return;
      }
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nový tréning">
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button variant={recurring ? 'primary' : 'ghost'} onClick={() => setRecurring(true)}>
            Opakovaný
          </Button>
          <Button variant={!recurring ? 'primary' : 'ghost'} onClick={() => setRecurring(false)}>
            Jednorazový
          </Button>
        </div>
        <div>
          <label className={labelCls}>Družstvá (možno vybrať viac)</label>
          <div className="mt-1 flex flex-wrap gap-1">
            {teams.map((tm) => {
              const on = teamIds.includes(tm.id);
              return (
                <button
                  key={tm.id}
                  type="button"
                  onClick={() => setTeamIds((prev) => (on ? prev.filter((x) => x !== tm.id) : [...prev, tm.id]))}
                  className={`rounded px-2 py-1 text-sm ${on ? 'bg-club-600 text-white' : 'bg-club-50 text-club-700'}`}
                >
                  {tm.name}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className={labelCls}>Názov</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </div>

        {recurring ? (
          <>
            <div>
              <label className={labelCls}>Dni v týždni</label>
              <div className="mt-1 flex gap-1">
                {WEEKDAY_SHORT_SK.map((lbl, i) => (
                  <button
                    key={i}
                    onClick={() => toggleDay(i)}
                    className={`h-9 w-9 rounded text-sm font-medium ${
                      weekdays.includes(i) ? 'bg-club-600 text-white' : 'bg-club-50 text-club-700'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Od (dátum)</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Do (dátum)</label>
                <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={inputCls} />
              </div>
            </div>
          </>
        ) : (
          <div>
            <label className={labelCls}>Dátum</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Začiatok</label>
            <input type="time" value={startTime} onChange={(e) => onStartChange(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Koniec{pitchId ? ' *' : ''}</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
          </div>
        </div>
        <PitchPicker pitches={pitches} pitchId={pitchId} onPitch={setPitchId} location={location} onLocation={setLocation} surface={surface} onSurface={setSurface} address={address} onAddress={setAddress} />

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Zverejniť v kalendári na verejnom webe
        </label>

        <ErrorText>{error}</ErrorText>
        {shared && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">{shared.message}</p>
            <ul className="mt-1 list-disc pl-5">
              {shared.conflicts.slice(0, 5).map((c, i) => (
                <li key={i}>
                  {c.teamName} — {c.title}, {new Date(c.startAt).toLocaleString('sk-SK', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })}
                </li>
              ))}
              {shared.conflicts.length > 5 && <li>… a ďalšie ({shared.conflicts.length - 5})</li>}
            </ul>
            <p className="mt-1">Tréner družstva, ktoré už plochu má, dostane e-mail o ďalšom družstve.</p>
            <div className="mt-2 flex gap-2">
              <Button variant="ghost" onClick={() => setShared(null)}>
                Späť
              </Button>
              <Button onClick={() => submit(true)} disabled={busy}>
                Napriek tomu rezervovať
              </Button>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Zrušiť
          </Button>
          <Button onClick={() => submit()} disabled={busy || !!shared || !teamId || endInvalid || endMissing}>
            {busy ? 'Ukladám…' : recurring ? 'Vytvoriť sériu' : 'Vytvoriť'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface ClubItem {
  id: string;
  name: string;
  logoUrl: string | null;
}


function MatchModal({
  open,
  initialDate,
  pitches,
  onClose,
  teams,
  onDone,
}: {
  open: boolean;
  initialDate: string;
  pitches: Pitch[];
  onClose: () => void;
  teams: Team[];
  onDone: () => void;
}) {
  const [pitchId, setPitchId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [type, setType] = useState<'MATCH' | 'FRIENDLY' | 'TOURNAMENT'>('MATCH');
  const [opponent, setOpponent] = useState('');
  const [tournamentTitle, setTournamentTitle] = useState('');
  const [clubs, setClubs] = useState<ClubItem[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [isHome, setIsHome] = useState(true);
  const [jerseyColor, setJerseyColor] = useState<JerseyColor | null>(null);
  const [oppJersey, setOppJersey] = useState<JerseyColor | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:30');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [surface, setSurface] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // predvolený koniec = začiatok + dĺžka podľa kategórie družstva / typu
  const catCode = teams.find((t) => t.id === teamId)?.teamCategory.code;
  useEffect(() => {
    if (time) setEndTime(addMinutesToHhmm(time, defaultEventMinutes(type === 'TOURNAMENT' ? 'TOURNAMENT' : 'MATCH', catCode)));
  }, [time, type, catCode]);
  const usePitch = isHome && !!pitchId;
  const endInvalid = !!time && !!endTime && endTime <= time;
  const endMissing = usePitch && !endTime;

  useEffect(() => {
    if (open && teams[0] && !teamId) setTeamId(teams[0].id);
  }, [open, teams, teamId]);
  useEffect(() => {
    if (open && pitches[0] && !pitchId) setPitchId(pitches[0].id);
  }, [open, pitches, pitchId]);
  useEffect(() => {
    if (open && initialDate) setDate(initialDate);
  }, [open, initialDate]);
  useEffect(() => {
    if (open && type === 'TOURNAMENT' && clubs.length === 0) {
      api<ClubItem[]>('/clubs').then(setClubs).catch(() => {});
    }
  }, [open, type, clubs.length]);

  async function submit() {
    if (endInvalid) return setError('Koniec musí byť po začiatku');
    if (endMissing) return setError('Pri vybranej hracej ploche zadajte koniec');
    setBusy(true);
    setError(null);
    try {
      const team = teams.find((t) => t.id === teamId);
      const body =
        type === 'TOURNAMENT'
          ? {
              type: 'TOURNAMENT',
              title: tournamentTitle.trim() || `Turnaj ${team?.name ?? ''}`.trim(),
              teamId,
              startAt: `${date}T${time}:00.000Z`,
              endAt: endTime ? `${date}T${endTime}:00.000Z` : undefined,
              ...placeFields(isHome ? pitchId : '', location, surface),
              address: address.trim() || undefined,
              participants,
            }
          : null;
      if (body) {
        await api('/events', { method: 'POST', body: JSON.stringify(body) });
        onDone();
        return;
      }
      await api('/events', {
        method: 'POST',
        body: JSON.stringify({
          type: 'MATCH',
          friendly: type === 'FRIENDLY' ? true : undefined,
          title: isHome ? `${team?.name} vs ${opponent}` : `${opponent} vs ${team?.name}`,
          teamId,
          startAt: `${date}T${time}:00.000Z`,
          endAt: endTime ? `${date}T${endTime}:00.000Z` : undefined,
          ...placeFields(isHome ? pitchId : '', location, surface),
          opponent,
          isHome,
          jerseyColor: jerseyColor ?? undefined,
          opponentJerseyColor: oppJersey ?? undefined,
          address: address.trim() || undefined,
        }),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nový zápas / turnaj">
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Družstvo</label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={inputCls}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Typ</label>
            <select value={type} onChange={(e) => setType(e.target.value as 'MATCH' | 'FRIENDLY' | 'TOURNAMENT')} className={inputCls}>
              <option value="MATCH">Zápas (SFZ)</option>
              <option value="FRIENDLY">Priateľský zápas (mimo SFZ)</option>
              <option value="TOURNAMENT">Turnaj</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Doma / vonku</label>
            <select value={isHome ? '1' : '0'} onChange={(e) => setIsHome(e.target.value === '1')} className={inputCls}>
              <option value="1">Doma</option>
              <option value="0">Vonku</option>
            </select>
          </div>
        </div>
        {type === 'TOURNAMENT' ? (
          <>
            <div>
              <label className={labelCls}>Názov turnaja</label>
              <input value={tournamentTitle} onChange={(e) => setTournamentTitle(e.target.value)} className={inputCls} placeholder="napr. Jarný turnaj" />
            </div>
            <ClubPicker clubs={clubs} selected={participants} onChange={setParticipants} />
          </>
        ) : (
          <div>
            <label className={labelCls}>Súper</label>
            <input value={opponent} onChange={(e) => setOpponent(e.target.value)} className={inputCls} list="opponent-list" />
            {type === 'FRIENDLY' && (
              <p className="mt-1 text-xs text-gray-500">
                Priateľský zápas nie je súčasťou SFZ – synchronizácia s futbalnetom ho neovplyvní.
              </p>
            )}
          </div>
        )}
        {type !== 'TOURNAMENT' && (
          <div className="space-y-3">
            <JerseyPicker label="Náš dres" value={jerseyColor} onChange={setJerseyColor} />
            <JerseyPicker label="Dres súpera" value={oppJersey} onChange={setOppJersey} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Dátum</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Začiatok</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Koniec{usePitch ? ' *' : ''}</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
          </div>
        </div>
        {isHome ? (
          <PitchPicker pitches={pitches} pitchId={pitchId} onPitch={setPitchId} location={location} onLocation={setLocation} surface={surface} onSurface={setSurface} address={address} onAddress={setAddress} />
        ) : (
          <PitchPicker pitches={[]} pitchId="" onPitch={() => {}} location={location} onLocation={setLocation} surface={surface} onSurface={setSurface} address={address} onAddress={setAddress} />
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Zrušiť
          </Button>
          <Button onClick={submit} disabled={busy || !teamId || (type !== 'TOURNAMENT' && !opponent) || !date || endInvalid || endMissing}>
            {busy ? 'Ukladám…' : 'Vytvoriť'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Rodičovské združenie: pre vybrané družstvá alebo celý klub. */
function ParentMeetingModal({
  open,
  onClose,
  teams,
  canWholeClub,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  teams: Team[];
  canWholeClub: boolean;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('Rodičovské združenie');
  const [wholeClub, setWholeClub] = useState(false);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('17:00');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // tréner nemôže robiť celoklubové združenie
  useEffect(() => {
    if (!canWholeClub && wholeClub) setWholeClub(false);
  }, [canWholeClub, wholeClub]);

  function toggleTeam(id: string) {
    setTeamIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api('/events', {
        method: 'POST',
        body: JSON.stringify({
          type: 'PARENT_MEETING',
          title,
          startAt: `${date}T${time}:00.000Z`,
          location: location || undefined,
          address: address.trim() || undefined,
          audienceTeamIds: wholeClub ? [] : teamIds,
        }),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  const valid = !!date && (wholeClub || teamIds.length > 0);

  return (
    <Modal open={open} onClose={onClose} title="Nové rodičovské združenie">
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Názov</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>Pre koho</label>
          {canWholeClub && (
            <label className="mb-2 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={wholeClub} onChange={(e) => setWholeClub(e.target.checked)} />
              Celý klub (všetky družstvá)
            </label>
          )}
          {!wholeClub && (
            <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-gray-200 p-2">
              {teams.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                  {t.name}
                </label>
              ))}
              {teams.length === 0 && <p className="text-sm text-gray-400">Žiadne družstvá.</p>}
            </div>
          )}
          <p className="mt-1 text-xs text-gray-500">Vyberte jedno či viac družstiev, alebo celý klub.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Dátum</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Čas</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Miesto</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} list="venue-list" placeholder="Klubovňa / ihrisko KNV" />
        </div>
        <AddressField value={address} onChange={setAddress} />

        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Zrušiť
          </Button>
          <Button onClick={submit} disabled={busy || !valid}>
            {busy ? 'Ukladám…' : 'Vytvoriť'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
