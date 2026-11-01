'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatEventDateTimeSk, formatEventTimeSk } from '@fkknv/shared';
import { api } from '@/lib/api';
import { canManageTeam, useMe } from '@/lib/auth';
import { Button, Card, ErrorText, Modal, inputCls, labelCls } from '@/components/ui';
import { AddressLink } from '@/components/AddressLink';
import { EventAdminActions } from '@/components/event-admin-actions';
import { ClubPicker, type ClubOption } from '@/components/club-picker';

interface TournamentMatch {
  eventId: string;
  matchId: string;
  order: number;
  opponent: string;
  opponentLogo: string | null;
  startAt: string;
  endAt: string | null;
  location: string | null;
  state: string;
  scoreUs: number | null;
  scoreThem: number | null;
  address?: string | null;
  nominatedCount?: number;
}
interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  nominated: boolean;
}
interface Tournament {
  event: {
    id: string;
    title: string;
    startAt: string;
    endAt: string | null;
    location: string | null;
    address: string | null;
    teamId: string | null;
    team: { id: string; name: string } | null;
  };
  participants: Array<{ id: string; clubName: string; logoUrl: string | null; sortOrder: number }>;
  matches: TournamentMatch[];
  nominations?: Array<{ memberId: string; firstName: string; lastName: string }>;
}

const STATE_LABELS: Record<string, string> = {
  PLANNED: 'Naplánovaný',
  LIVE: 'Prebieha',
  FINISHED: 'Odohraný',
  CANCELLED: 'Zrušený',
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function dateOf(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function timeOf(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function Logo({ src }: { src: string | null }) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="h-6 w-6 object-contain" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
  );
}

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const [t, setT] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clubs, setClubs] = useState<ClubOption[]>([]);

  // úprava účastníkov
  const [editParts, setEditParts] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [partsBusy, setPartsBusy] = useState(false);
  const [partsError, setPartsError] = useState<string | null>(null);

  // formulár zápasu (pridanie / úprava)
  const [editing, setEditing] = useState<TournamentMatch | null>(null);
  const [opponent, setOpponent] = useState('');
  const [order, setOrder] = useState('1');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // nominácia na turnaj
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candSearch, setCandSearch] = useState('');
  const [nomBusy, setNomBusy] = useState<string | null>(null);
  const [nomError, setNomError] = useState<string | null>(null);
  const [nomInfo, setNomInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<Tournament>(`/tournaments/${id}`);
      setT(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  const canNominate = !!t && canManageTeam(me, t.event.team?.id ?? t.event.teamId);
  const loadCandidates = useCallback(async () => {
    try {
      setCandidates(await api<Candidate[]>(`/tournaments/${id}/candidates`));
    } catch (e) {
      setNomError(e instanceof Error ? e.message : 'Načítanie hráčov zlyhalo');
    }
  }, [id]);
  useEffect(() => {
    if (canNominate) void loadCandidates();
  }, [canNominate, loadCandidates]);

  async function toggleNomination(c: Candidate) {
    if (c.nominated && !window.confirm(`Zrušiť nomináciu hráča ${c.firstName} ${c.lastName} na turnaj?`)) return;
    setNomBusy(c.id);
    setNomError(null);
    setNomInfo(null);
    try {
      const r = await api<{ memberId: string; matchesUpdated: number }>(
        c.nominated ? `/tournaments/${id}/nominations/${c.id}` : `/tournaments/${id}/nominations`,
        c.nominated ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify({ memberId: c.id }) },
      );
      setNomInfo(`Nominácia sa prenesie do všetkých zápasov turnaja (${r.matchesUpdated} zápasov)`);
      await Promise.all([load(), loadCandidates()]);
    } catch (e) {
      setNomError(e instanceof Error ? e.message : 'Akcia zlyhala');
    } finally {
      setNomBusy(null);
    }
  }
  useEffect(() => {
    api<ClubOption[]>('/clubs').then(setClubs).catch(() => {});
  }, []);

  const matches = (t?.matches ?? []).slice().sort((a, b) => a.order - b.order);
  const nextOrder = matches.reduce((mx, m) => Math.max(mx, m.order), 0) + 1;

  function resetMatchForm(next: number, base?: Tournament | null) {
    setEditing(null);
    setOpponent('');
    setOrder(String(next));
    setDate(base ? dateOf(base.event.startAt) : '');
    setTime('');
    setEndTime('');
    setLocation('');
    setAddress('');
    setMatchError(null);
  }
  useEffect(() => {
    if (t && !editing) setOrder((o) => (o === '' || Number(o) < nextOrder ? String(nextOrder) : o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextOrder, t]);

  function startEdit(m: TournamentMatch) {
    setEditing(m);
    setOpponent(m.opponent);
    setOrder(String(m.order));
    setDate(dateOf(m.startAt));
    setTime(timeOf(m.startAt));
    setEndTime(m.endAt ? timeOf(m.endAt) : '');
    setLocation(m.location ?? '');
    setAddress(m.address ?? '');
    setMatchError(null);
  }

  async function saveParticipants() {
    setPartsBusy(true);
    setPartsError(null);
    try {
      await api(`/tournaments/${id}/participants`, { method: 'PUT', body: JSON.stringify({ clubs: selected }) });
      setEditParts(false);
      await load();
      api<ClubOption[]>('/clubs').then(setClubs).catch(() => {});
    } catch (e) {
      setPartsError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setPartsBusy(false);
    }
  }

  async function saveMatch() {
    setMatchBusy(true);
    setMatchError(null);
    try {
      const body: Record<string, unknown> = { opponent, order: Number(order) || undefined };
      if (date && time) body.startAt = `${date}T${time}:00.000Z`;
      if (date && endTime) body.endAt = `${date}T${endTime}:00.000Z`;
      if (location.trim()) body.location = location.trim();
      if (address.trim()) body.address = address.trim();
      if (editing) {
        await api(`/tournaments/${id}/matches/${editing.eventId}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api(`/tournaments/${id}/matches`, { method: 'POST', body: JSON.stringify(body) });
      }
      await load();
      resetMatchForm(nextOrder + (editing ? 0 : 1), t);
    } catch (e) {
      setMatchError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setMatchBusy(false);
    }
  }

  async function removeMatch(m: TournamentMatch) {
    if (!window.confirm(`Zmazať ${m.order}. zápas vs ${m.opponent}?`)) return;
    setListError(null);
    try {
      await api(`/tournaments/${id}/matches/${m.eventId}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Zmazanie zlyhalo');
    }
  }

  if (!t) {
    return (
      <div>
        <Link href="/portal/udalosti" className="text-sm text-club-600 hover:underline">
          ← Kalendár
        </Link>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : <p className="mt-3 text-sm text-gray-500">Načítavam…</p>}
      </div>
    );
  }

  const ev = t.event;
  const manage = canManageTeam(me, ev.team?.id ?? ev.teamId);
  const participantNames = t.participants.map((p) => p.clubName);
  const nominations = t.nominations ?? [];
  const q = candSearch.trim().toLowerCase();
  const shownCandidates = q
    ? candidates.filter((c) => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q))
    : candidates;

  return (
    <div className="space-y-5">
      <Link href="/portal/udalosti" className="text-sm text-club-600 hover:underline">
        ← Kalendár
      </Link>

      <Card>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Turnaj</p>
        <h1 className="text-2xl font-bold text-club-900">{ev.title}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {formatEventDateTimeSk(ev.startAt)}
          {ev.endAt ? `–${formatEventTimeSk(ev.endAt)}` : ''}
          {ev.team ? ` · ${ev.team.name}` : ''}
        </p>
        {(ev.location || ev.address) && (
          <p className="mt-1 text-sm text-gray-600">
            {ev.location}
            {ev.location && ev.address ? ' · ' : ''}
            {ev.address && <AddressLink address={ev.address} />}
          </p>
        )}
        {manage && (
          <div className="mt-3 flex flex-wrap gap-2">
            <EventAdminActions
              eventId={ev.id}
              startAt={ev.startAt}
              endAt={ev.endAt}
              kind="tournament"
              title={ev.title}
              location={ev.location}
              address={ev.address}
              onChanged={load}
            />
          </div>
        )}
      </Card>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold text-club-900">Zúčastnené mužstvá</h2>
          {manage && (
            <Button
              variant="ghost"
              onClick={() => {
                setSelected(participantNames);
                setPartsError(null);
                setEditParts(true);
              }}
            >
              Upraviť
            </Button>
          )}
        </div>
        {t.participants.length === 0 ? (
          <Card className="text-sm text-gray-500">Zatiaľ žiadne mužstvá.</Card>
        ) : (
          <ul className="grid gap-1 border border-club-100 bg-white p-2 sm:grid-cols-2">
            {t.participants
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-2 py-1 text-sm text-club-900">
                  <Logo src={p.logoUrl} />
                  {p.clubName}
                </li>
              ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="nom-h">
        <h2 id="nom-h" className="mb-2 font-bold text-club-900">
          Nominácia na turnaj ({nominations.length})
        </h2>
        {nominations.length === 0 ? (
          <Card className="text-sm text-gray-500">Zatiaľ nie je nominovaný nikto.</Card>
        ) : (
          !manage && (
            <ul className="grid gap-1 border border-club-100 bg-white p-2 sm:grid-cols-2">
              {nominations.map((n) => (
                <li key={n.memberId} className="px-2 py-1 text-sm text-club-900">
                  {n.firstName} {n.lastName}
                </li>
              ))}
            </ul>
          )
        )}
        {manage && (
          <Card className="mt-2 space-y-3">
            <p className="text-sm text-gray-600">
              Nominácia sa prenesie do všetkých zápasov turnaja. V jednotlivom zápase možno nomináciu ďalej upraviť (číslo dresu,
              základná zostava); odohrané zápasy sa nemenia.
            </p>
            <div>
              <label htmlFor="nom-search" className={labelCls}>
                Hľadať hráča družstva
              </label>
              <input
                id="nom-search"
                type="search"
                value={candSearch}
                onChange={(e) => setCandSearch(e.target.value)}
                placeholder="Meno alebo priezvisko"
                className={inputCls}
              />
            </div>
            <div role="status" aria-live="polite">
              {nomInfo && <p className="text-sm text-green-700">{nomInfo}</p>}
            </div>
            <div role="alert">
              <ErrorText>{nomError}</ErrorText>
            </div>
            {candidates.length === 0 ? (
              <p className="text-sm text-gray-500">Družstvo nemá žiadnych aktívnych hráčov.</p>
            ) : shownCandidates.length === 0 ? (
              <p className="text-sm text-gray-500">Nikto nezodpovedá hľadaniu.</p>
            ) : (
              <ul className="divide-y divide-club-100 border border-club-100 bg-white">
                {shownCandidates.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className="text-sm text-club-900">
                      {c.firstName} {c.lastName}
                      {c.nominated && <span className="ml-2 text-xs font-semibold text-green-700">nominovaný</span>}
                    </span>
                    <Button
                      variant={c.nominated ? 'danger' : 'primary'}
                      disabled={nomBusy !== null}
                      onClick={() => toggleNomination(c)}
                    >
                      {nomBusy === c.id ? 'Ukladám…' : c.nominated ? 'zrušiť nomináciu' : '+ nominovať'}
                      <span className="sr-only">
                        {' '}
                        {c.firstName} {c.lastName}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-bold text-club-900">Zápasy turnaja</h2>
        <ErrorText>{listError}</ErrorText>
        {matches.length === 0 ? (
          <Card className="text-sm text-gray-500">Zatiaľ žiadne zápasy.</Card>
        ) : (
          <ul className="divide-y divide-club-100 border border-club-100 bg-white">
            {matches.map((m) => {
              const hasScore = m.scoreUs !== null && m.scoreThem !== null;
              return (
                <li key={m.eventId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium text-club-900">
                      <Logo src={m.opponentLogo} />
                      {m.order}. zápas — vs {m.opponent}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {formatEventDateTimeSk(m.startAt)}
                      {m.endAt ? `–${formatEventTimeSk(m.endAt)}` : ''}
                      {m.location ? ` · ${m.location}` : ''} · {STATE_LABELS[m.state] ?? m.state}
                      {hasScore ? ` · ${m.scoreUs}:${m.scoreThem}` : ''}
                      {m.nominatedCount !== undefined ? ` · nominovaných: ${m.nominatedCount}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/portal/zapasy/${m.matchId}`} className="text-sm font-medium text-club-700 hover:underline">
                      Otvoriť zápas
                    </Link>
                    {manage && (
                      <>
                        <Button variant="ghost" onClick={() => startEdit(m)}>
                          Upraviť
                        </Button>
                        <Button variant="danger" onClick={() => removeMatch(m)}>
                          Zmazať
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {manage && (
        <Card>
          <h2 className="mb-3 font-bold text-club-900">{editing ? `Upraviť ${editing.order}. zápas` : 'Pridať zápas turnaja'}</h2>
          {participantNames.length === 0 ? (
            <p className="text-sm text-gray-500">Najprv pridajte zúčastnené mužstvá.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>Súper</label>
                  <select value={opponent} onChange={(e) => setOpponent(e.target.value)} className={inputCls}>
                    <option value="">— vyberte —</option>
                    {participantNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Poradie</label>
                  <input type="number" min={1} value={order} onChange={(e) => setOrder(e.target.value)} className={inputCls} />
                </div>
              </div>
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
                  <label className={labelCls}>Koniec</label>
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Miesto</label>
                  <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Adresa</label>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} className={inputCls} />
                </div>
              </div>
              <ErrorText>{matchError}</ErrorText>
              <div className="flex justify-end gap-2">
                {editing && (
                  <Button variant="ghost" onClick={() => resetMatchForm(nextOrder, t)}>
                    Zrušiť úpravu
                  </Button>
                )}
                <Button onClick={saveMatch} disabled={matchBusy || !opponent}>
                  {matchBusy ? 'Ukladám…' : editing ? 'Uložiť' : 'Pridať zápas'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Modal open={editParts} onClose={() => setEditParts(false)} title="Zúčastnené mužstvá">
        <div className="space-y-4">
          <ClubPicker clubs={clubs} selected={selected} onChange={setSelected} />
          <ErrorText>{partsError}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditParts(false)}>
              Zrušiť
            </Button>
            <Button onClick={saveParticipants} disabled={partsBusy}>
              {partsBusy ? 'Ukladám…' : 'Uložiť'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
