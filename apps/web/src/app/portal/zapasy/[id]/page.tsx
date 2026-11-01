'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  DEFAULT_HALF_LENGTH_MIN,
  MATCH_EVENT_LABELS_SK,
  MATCH_TIMER_PHASE_LABELS_SK,
  SURFACE_LABELS_SK,
  computeMatchClock,
  formatEventDateTimeSk,
  formatEventTimeSk,
  type MatchEventType,
  type MatchTimerAction,
  type MatchTimerPhase,
  type SurfaceCode,
} from '@fkknv/shared';
import { JerseyBadges, JerseyPicker } from '@/components/jersey';
import { api } from '@/lib/api';
import { coachTeams, isStaff, useMe } from '@/lib/auth';
import { Button, Card } from '@/components/ui';
import { AddressLink } from '@/components/AddressLink';
import { MapEmbed } from '@/components/MapEmbed';
import { EventAdminActions } from '@/components/event-admin-actions';
import { CrossNomination } from '@/components/cross-nomination';
import { MatchMedia, type MatchPhotoItem, type MatchVideoItem } from '@/components/match-media';

interface Member {
  id: string;
  firstName: string;
  lastName: string;
}
interface Nomination {
  id: string;
  member: Member;
}
interface MatchEventRow {
  id: string;
  minute: number;
  stoppage: number | null;
  type: MatchEventType;
  member: Member | null;
}
interface MatchDetail {
  id: string;
  opponent: string;
  opponentLogo: string | null;
  isHome: boolean;
  scoreUs: number | null;
  scoreThem: number | null;
  state: string;
  meetAt: string | null;
  notes: string | null;
  jerseyColors?: ('DARK' | 'LIGHT')[];
  isFriendly?: boolean;
  videoUrl: string | null;
  highlightsUrl: string | null;
  halfLengthMin?: number;
  timerPhase?: MatchTimerPhase;
  firstHalfStartedAt?: string | null;
  firstHalfEndedAt?: string | null;
  secondHalfStartedAt?: string | null;
  secondHalfEndedAt?: string | null;
  /** čas servera pri načítaní — zarovnanie hodín klienta pre časomieru */
  serverNow?: string;
  event: {
    id: string;
    title: string;
    startAt: string;
    endAt: string | null;
    location: string | null;
    address: string | null;
    futbalnetId?: string | null;
    friendly?: boolean;
    parent?: { id: string; title: string } | null;
    tournamentOrder?: number | null;
    surface: SurfaceCode | null;
    team: { id: string; name: string } | null;
  };
  nominations: Nomination[];
  events: MatchEventRow[];
  photos: MatchPhotoItem[];
  /** Videá nahrané z telefónu (staršie API pole nemusí posielať). */
  videos?: MatchVideoItem[];
  sportnetUrl?: string | null;
  /** posledné kontroly proti futbalnetu (nové → staré) */
  syncLogs?: Array<{ id: string; createdAt: string; source: 'CRON' | 'MANUAL'; status: string; changes: string[] }>;
}

// logo nášho klubu (FK Košická Nová Ves) z futbalnetu
const OUR_LOGO = 'https://api.sportnet.online/data/ppo/fk-kosicka-nova-ves.futbalnet.sk/logo';

// akcie viazané na hráča vs tímové
const PLAYER_ACTIONS: MatchEventType[] = ['GOAL', 'ASSIST', 'PENALTY_SCORED', 'PENALTY_MISSED', 'YELLOW', 'RED', 'FOUL', 'SHOT'];
const TEAM_ACTIONS: MatchEventType[] = ['GOAL_CONCEDED', 'CORNER'];

function fmtMinute(minute: number, stoppage: number | null) {
  return stoppage ? `${minute}+${stoppage}` : `${minute}`;
}

/** Stav časomiery zo zápasu (staršie API bez polí → pred výkopom). */
function timerOf(m: MatchDetail) {
  return {
    timerPhase: m.timerPhase ?? 'NOT_STARTED',
    halfLengthMin: m.halfLengthMin ?? DEFAULT_HALF_LENGTH_MIN,
    firstHalfStartedAt: m.firstHalfStartedAt ?? null,
    firstHalfEndedAt: m.firstHalfEndedAt ?? null,
    secondHalfStartedAt: m.secondHalfStartedAt ?? null,
    secondHalfEndedAt: m.secondHalfEndedAt ?? null,
  } as const;
}

/** Výrazná časomiera zápasu + ovládanie (výkop, prestávka, 2. polčas, koniec). */
function MatchTimerCard({
  match,
  now,
  manage,
  busy,
  onAction,
}: {
  match: MatchDetail;
  now: number;
  manage: boolean;
  busy: boolean;
  onAction: (a: MatchTimerAction) => void;
}) {
  const t = timerOf(match);
  const c = computeMatchClock(t, now);
  const phase = t.timerPhase;
  const half = t.halfLengthMin;
  if (!manage && phase === 'NOT_STARTED') return null;
  return (
    <Card className="text-center">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-widest text-gray-400">
        <span>Časomiera</span>
        <span className={c.running ? 'text-club-600' : ''}>
          {c.running ? '● ' : ''}
          {MATCH_TIMER_PHASE_LABELS_SK[phase]}
        </span>
      </div>
      <div className="my-2 flex items-baseline justify-center gap-3 font-[family-name:var(--head-font)] font-bold tabular-nums">
        <span className={`text-7xl leading-none sm:text-8xl ${c.running ? 'text-club-900' : 'text-gray-500'}`}>{c.clock}</span>
        {c.stoppageClock && <span className="text-4xl leading-none text-amber-400 sm:text-5xl">{c.stoppageClock}</span>}
      </div>
      <p className="text-sm text-gray-500">
        {phase === 'NOT_STARTED' ? (
          <>Polčas {half} min · spustite výkopom</>
        ) : (
          <>
            Minúta zápisu: <strong className="text-club-800">{c.label}</strong> · polčas {half} min
          </>
        )}
      </p>
      {manage && match.state !== 'CANCELLED' && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {phase === 'NOT_STARTED' && (
            <Button onClick={() => onAction('START_FIRST')} disabled={busy} className="px-6 py-3 text-base">
              ▶ Výkop — štart časomiery
            </Button>
          )}
          {phase === 'FIRST_HALF' && (
            <Button onClick={() => onAction('END_FIRST')} disabled={busy} className="px-6 py-3 text-base">
              ❚❚ Prestávka
            </Button>
          )}
          {phase === 'HALF_TIME' && (
            <Button onClick={() => onAction('START_SECOND')} disabled={busy} className="px-6 py-3 text-base">
              ▶ Druhý polčas
            </Button>
          )}
          {(phase === 'SECOND_HALF' || phase === 'FIRST_HALF' || phase === 'HALF_TIME') && (
            <Button
              variant="danger"
              onClick={() => {
                if (phase === 'SECOND_HALF' || window.confirm('Ukončiť zápas už teraz (bez dohrania 2. polčasu)?')) onAction('END_SECOND');
              }}
              disabled={busy}
              className="px-6 py-3 text-base"
            >
              ■ Koniec zápasu
            </Button>
          )}
          {phase !== 'NOT_STARTED' && (
            <>
              <Button variant="ghost" onClick={() => onAction('UNDO')} disabled={busy}>
                ↶ Späť
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  if (window.confirm('Vynulovať časomieru? Zapísané udalosti ostanú.')) onAction('RESET');
                }}
                disabled={busy}
              >
                Vynulovať
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/** Čas zrazu: explicitný meetAt, inak hodina pred začiatkom zápasu. */
function meetTimeOf(match: { meetAt: string | null; event: { startAt: string } }): Date {
  if (match.meetAt) return new Date(match.meetAt);
  return new Date(new Date(match.event.startAt).getTime() - 3_600_000);
}

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [roster, setRoster] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Nomination | null>(null);
  const [minute, setMinute] = useState('0');
  const [stoppage, setStoppage] = useState('');
  const [scoreUs, setScoreUs] = useState('0');
  const [scoreThem, setScoreThem] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyResult, setNotifyResult] = useState<{ recipients: number; coachCopySent?: boolean; missing: Array<{ id: string; name: string }> } | null>(null);
  const [meetDraft, setMeetDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [videoDraft, setVideoDraft] = useState('');
  const [highlightsDraft, setHighlightsDraft] = useState('');
  const [videoBusy, setVideoBusy] = useState(false);
  const [veoBusy, setVeoBusy] = useState(false);
  const [veoCandidates, setVeoCandidates] = useState<Array<{ url: string; title: string; recordedAt: string | null }> | null>(null);
  const [halfDraft, setHalfDraft] = useState(String(DEFAULT_HALF_LENGTH_MIN));
  const [timerBusy, setTimerBusy] = useState(false);
  // minúta/nadstavenie udalosti sa predvypĺňa z časomiery, kým ju používateľ ručne neprepíše
  const [minuteAuto, setMinuteAuto] = useState(true);
  // posun hodín servera voči klientovi (ms) a tikajúci „teraz" pre časomieru
  const clockOffset = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  // spravovať zápas/nomináciu môže vedenie, alebo tréner tohto družstva
  const manage = isStaff(me) || (!!match?.event.team && coachTeams(me).some((t) => t.id === match.event.team!.id));

  const load = useCallback(async () => {
    try {
      const m = await reloadMatch();
      if (m.event.team) setRoster(await api<Member[]>(`/members?team=${m.event.team.id}&role=PLAYER`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
    }
  }, [id]);

  async function reloadMatch() {
    const m = await api<MatchDetail>(`/matches/${id}`);
    if (m.serverNow) clockOffset.current = new Date(m.serverNow).getTime() - Date.now();
    setMatch(m);
    return m;
  }

  useEffect(() => {
    void load();
  }, [load]);

  const timerPhase = match?.timerPhase ?? 'NOT_STARTED';
  const timerRunning = timerPhase === 'FIRST_HALF' || timerPhase === 'SECOND_HALF';

  // tikanie časomiery (zobrazenie sa počíta z časových značiek servera)
  useEffect(() => {
    if (!timerRunning) {
      setNow(Date.now() + clockOffset.current);
      return;
    }
    const tick = () => setNow(Date.now() + clockOffset.current);
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [timerRunning, match?.firstHalfStartedAt, match?.secondHalfStartedAt]);

  // počas živého zápasu obnovuj stav (časomiera, skóre, udalosti) pre ostatných divákov
  useEffect(() => {
    if (match?.state !== 'LIVE') return;
    const h = setInterval(() => {
      void reloadMatch().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(h);
  }, [match?.state, id]);

  useEffect(() => {
    if (match) setHalfDraft(String(match.halfLengthMin ?? DEFAULT_HALF_LENGTH_MIN));
  }, [match?.halfLengthMin]);

  // predvyplnenie minúty udalosti z časomiery
  const clock = match ? computeMatchClock(timerOf(match), now) : null;
  const timerMinute = clock && clock.phase !== 'NOT_STARTED' ? clock : null;
  useEffect(() => {
    if (!minuteAuto || !timerMinute) return;
    setMinute(String(timerMinute.minute));
    setStoppage(timerMinute.stoppage ? String(timerMinute.stoppage) : '');
  }, [minuteAuto, timerMinute?.minute, timerMinute?.stoppage]);

  async function timerAction(action: MatchTimerAction) {
    setTimerBusy(true);
    setError(null);
    try {
      await api(`/matches/${id}/timer`, { method: 'POST', body: JSON.stringify({ action }) });
      await reloadMatch();
      setMinuteAuto(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Časomiera — akcia zlyhala');
    } finally {
      setTimerBusy(false);
    }
  }

  // skóre v poliach drž zosynchronizované s načítaným zápasom
  useEffect(() => {
    if (match) {
      setScoreUs(String(match.scoreUs ?? 0));
      setScoreThem(String(match.scoreThem ?? 0));
    }
  }, [match?.scoreUs, match?.scoreThem]);

  // čas zrazu a poznámky z načítaného zápasu (čas zrazu = meetAt, inak 1h pred začiatkom)
  useEffect(() => {
    if (match) {
      setMeetDraft(formatEventTimeSk(meetTimeOf(match)));
      setNotesDraft(match.notes ?? '');
      setVideoDraft(match.videoUrl ?? '');
      setHighlightsDraft(match.highlightsUrl ?? '');
    }
  }, [match?.meetAt, match?.notes, match?.videoUrl, match?.highlightsUrl, match?.event.startAt]);

  async function saveDetails() {
    if (!match) return;
    setDetailsBusy(true);
    setError(null);
    try {
      const start = new Date(match.event.startAt);
      const m = /^(\d{1,2}):(\d{2})$/.exec(meetDraft.trim());
      const meetAt = m
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), Number(m[1]), Number(m[2]))).toISOString()
        : null;
      const halfLengthMin = Math.trunc(Number(halfDraft));
      if (!(halfLengthMin >= 1 && halfLengthMin <= 60)) {
        setError('Dĺžka polčasu musí byť 1–60 minút.');
        return;
      }
      await api(`/matches/${id}/details`, {
        method: 'POST',
        body: JSON.stringify({ meetAt, notes: notesDraft, halfLengthMin }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setDetailsBusy(false);
    }
  }

  async function setJersey(colors: ('DARK' | 'LIGHT')[]) {
    setError(null);
    try {
      await api(`/matches/${id}/details`, { method: 'POST', body: JSON.stringify({ jerseyColors: colors }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    }
  }

  async function saveVideo(url: string | null) {
    setVideoBusy(true);
    setError(null);
    try {
      await api(`/matches/${id}/video`, { method: 'POST', body: JSON.stringify({ url }) });
      setVeoCandidates(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie videa zlyhalo');
    } finally {
      setVideoBusy(false);
    }
  }

  async function saveHighlights(url: string | null) {
    setVideoBusy(true);
    setError(null);
    try {
      await api(`/matches/${id}/highlights`, { method: 'POST', body: JSON.stringify({ url }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie highlightov zlyhalo');
    } finally {
      setVideoBusy(false);
    }
  }

  async function findVeoVideo() {
    setVeoBusy(true);
    setError(null);
    setVeoCandidates(null);
    try {
      const res = await api<{ candidates: Array<{ url: string; title: string; recordedAt: string | null }> }>(
        `/matches/${id}/video/candidates`,
      );
      if (!res.candidates.length) {
        setError('Nenašlo sa žiadne zodpovedajúce Veo video. Skontrolujte dátum/tímy alebo vložte odkaz ručne.');
        return;
      }
      if (res.candidates.length === 1) {
        await saveVideo(res.candidates[0].url);
      } else {
        setVeoCandidates(res.candidates);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hľadanie Veo videa zlyhalo');
    } finally {
      setVeoBusy(false);
    }
  }

  async function setState(state: string) {
    await api(`/matches/${id}/state`, { method: 'POST', body: JSON.stringify({ state }) });
    await load();
  }

  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  async function syncFutbalnet() {
    if (!match) return;
    let url: string | undefined;
    if (!match.sportnetUrl && !match.event.futbalnetId) {
      const entered = window.prompt('Vložte odkaz na zápas z futbalnetu (sportnet.sme.sk/futbalnet/z/…/zapas/…):');
      if (!entered) return;
      url = entered.trim();
    }
    setSyncBusy(true);
    setError(null);
    try {
      const res = await api<{ status: string; changes: string[] }>(`/matches/${match.id}/futbalnet-sync`, {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      setSyncMsg(res.status === 'NO_CHANGE' ? 'Bez rozdielov — zapísané údaje sedia s futbalnetom.' : res.changes.join(' · '));
      await reloadMatch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Synchronizácia zlyhala');
    } finally {
      setSyncBusy(false);
    }
  }

  async function saveScore() {
    setError(null);
    await api(`/matches/${id}/score`, {
      method: 'POST',
      body: JSON.stringify({ scoreUs: Number(scoreUs) || 0, scoreThem: Number(scoreThem) || 0 }),
    });
    await load();
  }

  async function sendNominationEmail() {
    setNotifyBusy(true);
    setError(null);
    try {
      const res = await api<{ recipients: number; sent: number; coachCopySent?: boolean; missing: Array<{ id: string; name: string }> }>(
        `/matches/${id}/notify-nomination`,
        { method: 'POST' },
      );
      setNotifyResult({ recipients: res.recipients, coachCopySent: res.coachCopySent, missing: res.missing });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Odoslanie zlyhalo');
    } finally {
      setNotifyBusy(false);
    }
  }

  async function toggleNomination(member: Member, on: boolean) {
    if (on) await api(`/matches/${id}/nominations`, { method: 'POST', body: JSON.stringify({ memberId: member.id }) });
    else await api(`/matches/${id}/nominations/${member.id}`, { method: 'DELETE' });
    setNotifyResult(null);
    await load();
  }

  async function record(type: MatchEventType, needsPlayer: boolean) {
    if (needsPlayer && !selected) {
      setError('Najprv ťuknite na hráča v riadku „Hráč" nižšie.');
      return;
    }
    setError(null);
    await api(`/matches/${id}/events`, {
      method: 'POST',
      body: JSON.stringify({
        clientId: crypto.randomUUID(),
        // automaticky: presná minúta z časomiery v okamihu kliknutia
        ...(minuteAuto && timerMinute
          ? (() => {
              const c = computeMatchClock(timerOf(match!), Date.now() + clockOffset.current);
              return { minute: c.minute, stoppage: c.stoppage };
            })()
          : {
              minute: Number(minute) || 0,
              stoppage: Number(stoppage) > 0 ? Number(stoppage) : undefined,
            }),
        type,
        memberId: needsPlayer ? selected!.member.id : undefined,
      }),
    });
    setSelected(null);
    setMinuteAuto(true);
    await reloadMatch();
  }

  if (!match) {
    return (
      <div>
        <Link href="/portal/udalosti" className="text-sm text-club-600 hover:underline">
          ← Kalendár
        </Link>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  const nominatedIds = new Set(match.nominations.map((n) => n.member.id));
  const recording = manage && (match.state === 'LIVE' || match.state === 'FINISHED');

  const syncBlock = (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-club-800">Kontrola s Futbalnetom</p>
            <p className="text-xs text-gray-500">
              Porovná výsledok a strelcov s futbalnetom a opraví rozdiely (automaticky aj každý večer o 20:00).
            </p>
          </div>
          <Button variant="ghost" onClick={syncFutbalnet} disabled={syncBusy}>
            {syncBusy ? 'Kontrolujem…' : 'Skontrolovať teraz'}
          </Button>
        </div>
        {syncMsg && <p className="mt-2 text-xs font-medium text-club-700">{syncMsg}</p>}
        {(match.syncLogs ?? []).length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {(match.syncLogs ?? []).slice(0, 3).map((l) => (
              <li key={l.id}>
                <span className="font-medium text-club-700">
                  {new Date(l.createdAt).toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava', dateStyle: 'medium', timeStyle: 'short' })} · {l.source === 'CRON' ? 'automaticky' : 'ručne'}
                </span>
                <ul className="ml-4 list-disc text-gray-700">
                  {l.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
  );

  return (
    <div className="space-y-5">
      <Link href="/portal/udalosti" className="text-sm text-club-600 hover:underline">
        ← Kalendár
      </Link>
      {match.event.parent && (
        <div>
          <Link href={`/portal/turnaje/${match.event.parent.id}`} className="text-sm font-medium text-club-700 hover:underline">
            ← Turnaj: {match.event.parent.title}
            {match.event.tournamentOrder != null ? ` (${match.event.tournamentOrder}. zápas)` : ''}
          </Link>
        </div>
      )}

      <Card className="text-center">
        {(match.isFriendly || match.event.friendly) && (
          <p className="mb-1">
            <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Priateľský zápas</span>
          </p>
        )}
        <div className="mb-1 flex items-center justify-center gap-4">
          {/* poradie log podľa doma/vonku: doma = my vľavo, vonku = my vpravo */}
          {/* eslint-disable @next/next/no-img-element */}
          <img
            src={match.isHome ? OUR_LOGO : match.opponentLogo ?? OUR_LOGO}
            alt=""
            className="h-12 w-12 object-contain"
            onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
          />
          <span className="text-xs font-medium text-gray-400">{match.isHome ? 'DOMA' : 'VONKU'}</span>
          <img
            src={match.isHome ? match.opponentLogo ?? OUR_LOGO : OUR_LOGO}
            alt=""
            className="h-12 w-12 object-contain"
            onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
          />
          {/* eslint-enable @next/next/no-img-element */}
        </div>
        <p className="text-sm text-gray-500">{match.event.title}</p>
        <p className="my-1 text-5xl font-extrabold text-club-800">
          {(match.isHome ? match.scoreUs : match.scoreThem) ?? 0} : {(match.isHome ? match.scoreThem : match.scoreUs) ?? 0}
        </p>
        <p className="text-sm font-semibold text-club-600">
          {match.state === 'LIVE' ? '● NAŽIVO' : match.state === 'FINISHED' ? 'Ukončený' : match.state === 'CANCELLED' ? 'Zrušený' : 'Plánovaný'}
          {' · '}
          {formatEventDateTimeSk(match.event.startAt)}
          {match.event.location ? ` · ${match.event.location}` : ''}
          {match.event.surface ? ` · ${SURFACE_LABELS_SK[match.event.surface]}` : ''}
        </p>
        {match.event.address && (
          <div className="mx-auto mt-3 max-w-xl rounded-lg border-2 border-club-200 bg-club-50 p-3 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-club-600">Miesto zápasu</p>
            <p className="mt-0.5 text-base font-bold text-club-900">
              📍 <AddressLink address={match.event.address} className="text-club-800 underline hover:text-club-900" />
            </p>
            <MapEmbed address={match.event.address} defaultOpen />
          </div>
        )}

        {manage && (
          <div className="mt-3 flex items-end justify-center gap-2">
            <div>
              <label className="block text-xs text-gray-500">Domáci</label>
              <input
                type="number"
                min={0}
                value={match.isHome ? scoreUs : scoreThem}
                onChange={(e) => (match.isHome ? setScoreUs : setScoreThem)(e.target.value)}
                className="w-16 rounded-md border border-gray-300 px-2 py-1 text-center text-lg font-bold"
              />
            </div>
            <span className="pb-1 text-lg font-bold text-gray-400">:</span>
            <div>
              <label className="block text-xs text-gray-500">Hostia</label>
              <input
                type="number"
                min={0}
                value={match.isHome ? scoreThem : scoreUs}
                onChange={(e) => (match.isHome ? setScoreThem : setScoreUs)(e.target.value)}
                className="w-16 rounded-md border border-gray-300 px-2 py-1 text-center text-lg font-bold"
              />
            </div>
            <Button variant="ghost" onClick={saveScore}>
              Uložiť výsledok
            </Button>
          </div>
        )}

        {manage && (
          <div className="mt-3 flex justify-center gap-2">
            {match.state === 'PLANNED' && <Button onClick={() => setState('LIVE')}>Začať zápas</Button>}
            {match.state === 'LIVE' && (
              <Button variant="danger" onClick={() => setState('FINISHED')}>
                Ukončiť zápas
              </Button>
            )}
            {match.state === 'FINISHED' && (
              <Button variant="ghost" onClick={() => setState('LIVE')}>
                Znovu otvoriť
              </Button>
            )}
          </div>
        )}
        {(isStaff(me) || (match.event.team && coachTeams(me).some((t) => t.id === match.event.team!.id))) && (
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <EventAdminActions
              eventId={match.event.id}
              startAt={match.event.startAt}
              endAt={match.event.endAt}
              kind="match"
              title={match.event.title}
              location={match.event.location}
              address={match.event.address}
              surface={match.event.surface}
              matchId={match.id}
              matchState={match.state}
              onChanged={load}
            />
          </div>
        )}
      </Card>

      <MatchTimerCard match={match} now={now} manage={manage} busy={timerBusy} onAction={timerAction} />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Čas zrazu, nastavenia a poznámky k zápasu */}
      <Card>
        <h2 className="mb-3 font-semibold text-club-800">Zraz, nastavenia a poznámky</h2>
        {manage ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-gray-500">Čas zrazu (stretnutia)</label>
                <input
                  type="time"
                  value={meetDraft}
                  onChange={(e) => setMeetDraft(e.target.value)}
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <p className="mt-1 text-xs text-gray-400">Predvolene hodina pred začiatkom zápasu.</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500">Dĺžka polčasu (min)</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={halfDraft}
                  onChange={(e) => setHalfDraft(e.target.value)}
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <p className="mt-1 text-xs text-gray-400">Pre časomieru, predvolene 45.</p>
              </div>
              <JerseyPicker compact value={match.jerseyColors ?? []} onChange={setJersey} />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Poznámky k zápasu</label>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="Napr. výstroj, doprava, zraz pri klubovni…"
              />
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={saveDetails} disabled={detailsBusy}>
                {detailsBusy ? 'Ukladám…' : 'Uložiť zraz a poznámky'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1 text-sm text-gray-700">
            <p>
              <span className="text-gray-500">Zraz: </span>
              <strong>{formatEventTimeSk(meetTimeOf(match))}</strong>
            </p>
            <p>
              <span className="text-gray-500">Dĺžka polčasu: </span>
              {match.halfLengthMin ?? DEFAULT_HALF_LENGTH_MIN} min
            </p>
            {match.jerseyColors && match.jerseyColors.length > 0 ? (
              <p className="flex flex-wrap items-center gap-2">
                <JerseyBadges colors={match.jerseyColors} size={16} />
              </p>
            ) : null}
            {match.notes ? (
              <p className="whitespace-pre-wrap">
                <span className="text-gray-500">Poznámky: </span>
                {match.notes}
              </p>
            ) : null}
          </div>
        )}
      </Card>

      {/* Video a fotky zo zápasu — po spustení/ukončení */}
      {(match.state === 'LIVE' || match.state === 'FINISHED') && (
        <Card>
          <h2 className="mb-3 font-semibold text-club-800">Video a fotky zo zápasu</h2>

          {/* Nahrávanie fotiek/videí z telefónu + galéria (navrchu, výrazne) */}
          <MatchMedia
            matchId={id}
            manage={manage}
            photos={match.photos}
            videos={match.videos ?? []}
            onChanged={load}
          />

          {/* Odkazy na video (Veo) a highlighty */}
          <div className="mt-5 border-t border-club-100 pt-4">
            {manage ? (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">Video zápasu (odkaz, napr. Veo)</label>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={videoDraft}
                    onChange={(e) => setVideoDraft(e.target.value)}
                    placeholder="https://app.veo.co/matches/…"
                    className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <Button variant="ghost" onClick={() => saveVideo(videoDraft || null)} disabled={videoBusy}>
                    {videoBusy ? 'Ukladám…' : 'Uložiť odkaz'}
                  </Button>
                  <Button onClick={findVeoVideo} disabled={veoBusy}>
                    {veoBusy ? 'Hľadám…' : 'Nájsť video (Veo)'}
                  </Button>
                </div>
                {veoCandidates && (
                  <div className="rounded-md border border-club-100 bg-club-50 p-2">
                    <p className="mb-1 text-xs text-gray-600">Nájdených viac videí — vyberte správne:</p>
                    <ul className="space-y-1">
                      {veoCandidates.map((c) => (
                        <li key={c.url} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate">
                            {c.title}
                            {c.recordedAt ? ` · ${formatEventDateTimeSk(c.recordedAt)}` : ''}
                          </span>
                          <Button variant="ghost" onClick={() => saveVideo(c.url)}>
                            Vybrať
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {match.videoUrl && (
                  <div className="flex items-center gap-2 text-sm">
                    <a href={match.videoUrl} target="_blank" rel="noopener noreferrer" className="text-club-700 underline">
                      ▶ Video zápasu
                    </a>
                    <button onClick={() => saveVideo(null)} className="text-xs text-red-600 hover:underline">
                      odstrániť
                    </button>
                  </div>
                )}

                <label className="block pt-2 text-xs font-medium text-gray-600">Highlighty (odkaz)</label>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={highlightsDraft}
                    onChange={(e) => setHighlightsDraft(e.target.value)}
                    placeholder="https://…"
                    className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <Button variant="ghost" onClick={() => saveHighlights(highlightsDraft || null)} disabled={videoBusy}>
                    {videoBusy ? 'Ukladám…' : 'Uložiť odkaz'}
                  </Button>
                </div>
                {match.highlightsUrl && (
                  <div className="flex items-center gap-2 text-sm">
                    <a href={match.highlightsUrl} target="_blank" rel="noopener noreferrer" className="text-club-700 underline">
                      ▶ Highlighty
                    </a>
                    <button onClick={() => saveHighlights(null)} className="text-xs text-red-600 hover:underline">
                      odstrániť
                    </button>
                  </div>
                )}
              </div>
            ) : match.videoUrl || match.highlightsUrl ? (
              <div className="flex flex-wrap gap-4 text-sm">
                {match.videoUrl && (
                  <a href={match.videoUrl} target="_blank" rel="noopener noreferrer" className="text-club-700 underline">
                    ▶ Video zápasu
                  </a>
                )}
                {match.highlightsUrl && (
                  <a href={match.highlightsUrl} target="_blank" rel="noopener noreferrer" className="text-club-700 underline">
                    ▶ Highlighty
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Odkaz na video (Veo) zatiaľ nie je pridaný.</p>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Nominácia */}
        <Card>
          <h2 className="mb-3 font-semibold text-club-800">
            Nominácia ({match.nominations.length}
            {roster.length ? ` / ${roster.length}` : ''})
          </h2>
          {manage ? (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {roster.map((m) => {
                const on = nominatedIds.has(m.id);
                return (
                  <li key={m.id}>
                    <button
                      onClick={() => toggleNomination(m, !on)}
                      className={`flex w-full items-center justify-between rounded px-3 py-2 text-sm ${
                        on ? 'bg-club-50 font-medium text-club-800' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span>
                        {m.lastName} {m.firstName}
                      </span>
                      <span className={on ? 'text-club-600' : 'text-gray-400'}>{on ? '✓ v nominácii' : '+ pridať'}</span>
                    </button>
                  </li>
                );
              })}
              {roster.length === 0 && <li className="text-sm text-gray-500">Družstvo nemá hráčov.</li>}
            </ul>
          ) : null}
          {manage && <CrossNomination matchId={id} onChange={load} />}
          {manage && (
            <div className="mt-3 border-t border-club-100 pt-3">
              <Button variant="ghost" onClick={sendNominationEmail} disabled={notifyBusy || match.nominations.length === 0}>
                {notifyBusy ? 'Odosielam…' : '✉ Rozposlať oznam e-mailom'}
              </Button>
              {notifyResult && (
                <div className="mt-2 rounded-md bg-club-50 p-3 text-sm text-gray-700">
                  <p>Oznam odoslaný na {notifyResult.recipients} e-mailových adries.</p>
                  {notifyResult.coachCopySent && <p>Kompletná nominácia vám prišla na e-mail.</p>}
                  {notifyResult.missing.length > 0 && (
                    <div className="mt-2">
                      <p className="font-medium text-amber-700">
                        Bez e-mailu (nedostali oznam) — chýba konto alebo rodič s e-mailom:
                      </p>
                      <ul className="mt-1 list-inside list-disc text-gray-600">
                        {notifyResult.missing.map((m) => (
                          <li key={m.id}>{m.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {!manage && (
            <ul className="space-y-1 text-sm">
              {match.nominations.map((n) => (
                <li key={n.id}>
                  {n.member.lastName} {n.member.firstName}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Živý zápis */}
        <Card>
          <h2 className="mb-3 font-semibold text-club-800">Priebeh zápasu</h2>
          {/* kontrola s futbalnetom je dostupná aj pred výkopom / bez spustenia zápasu */}
          {manage && !recording && <div className="mb-4 rounded-md bg-club-50 p-3">{syncBlock}</div>}
          {recording && (
            <div className="mb-4 space-y-3 rounded-md bg-club-50 p-3">
              {/* minúta + nadstavenie */}
              <div className="flex flex-wrap items-end justify-center gap-3">
                <div>
                  <label className="block text-xs text-gray-500">Minúta</label>
                  <input
                    type="number"
                    min={0}
                    max={130}
                    value={minute}
                    onChange={(e) => {
                      setMinuteAuto(false);
                      setMinute(e.target.value);
                    }}
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 text-center text-lg font-bold"
                  />
                </div>
                <span className="pb-1 text-lg font-bold text-gray-400">+</span>
                <div>
                  <label className="block text-xs text-gray-500">Nadstavenie</label>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={stoppage}
                    onChange={(e) => {
                      setMinuteAuto(false);
                      setStoppage(e.target.value);
                    }}
                    placeholder="0"
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 text-center text-lg font-bold"
                  />
                </div>
              </div>
              {timerMinute && (
                <p className="text-center text-xs text-gray-500">
                  {minuteAuto ? (
                    <>Minúta sa dopĺňa z časomiery ({timerMinute.label}) — môžete ju ručne upraviť.</>
                  ) : (
                    <>
                      Ručne upravená minúta ·{' '}
                      <button type="button" onClick={() => setMinuteAuto(true)} className="text-club-600 hover:underline">
                        ↻ podľa časomiery ({timerMinute.label})
                      </button>
                    </>
                  )}
                </p>
              )}

              {/* kontrola s futbalnetom */}
              <div className="border-t border-club-100 pt-3">{syncBlock}</div>

              {/* výber hráča */}
              <div>
                <p className="mb-1 text-xs font-medium text-gray-500">Hráč (pre gól, kartu, asistenciu…):</p>
                {match.nominations.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {match.nominations.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => setSelected(selected?.id === n.id ? null : n)}
                        className={`rounded px-2 py-1 text-xs ${
                          selected?.id === n.id ? 'bg-club-600 text-white' : 'bg-white text-club-700 hover:bg-club-100'
                        }`}
                      >
                        {n.member.lastName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">Najprv pridajte hráčov do nominácie vľavo.</p>
                )}
                {selected && (
                  <p className="mt-1 text-center text-sm text-club-700">
                    Vybraný: <strong>{selected.member.lastName}</strong> — ťuknite na akciu
                  </p>
                )}
              </div>

              {/* akcie */}
              <div className="grid grid-cols-2 gap-2">
                {PLAYER_ACTIONS.map((t) => (
                  <button
                    key={t}
                    onClick={() => record(t, true)}
                    className="rounded border border-club-200 bg-white px-2 py-2 text-xs font-semibold text-club-900 hover:border-club-400"
                  >
                    {MATCH_EVENT_LABELS_SK[t]}
                  </button>
                ))}
                {TEAM_ACTIONS.map((t) => (
                  <button
                    key={t}
                    onClick={() => record(t, false)}
                    className="rounded border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-700 hover:border-gray-400"
                  >
                    {MATCH_EVENT_LABELS_SK[t]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ul className="space-y-1 text-sm">
            {match.events.map((e) => (
              <li key={e.id} className="flex gap-3 border-b border-club-50 py-1">
                <span className="w-12 font-semibold text-club-600">{fmtMinute(e.minute, e.stoppage)}'</span>
                <span>
                  {MATCH_EVENT_LABELS_SK[e.type]}
                  {e.member ? ` — ${e.member.lastName}` : ''}
                </span>
              </li>
            ))}
            {match.events.length === 0 && <li className="text-gray-500">Zatiaľ žiadne udalosti.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
