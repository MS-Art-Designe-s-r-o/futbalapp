'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatEventDateTimeSk } from '@fkknv/shared';
import { api } from '@/lib/api';
import { isCoach, isStaff, useMe } from '@/lib/auth';
import { Button, Card, ErrorText, PlayerPos, inputCls } from '@/components/ui';

type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  position?: string | null;
  birthYear: number | null;
  categoryCode: string | null;
  teams: Array<{ id: string; name: string }>;
  nominated: boolean;
  requestStatus: RequestStatus | null;
  direct: boolean;
}

interface NominationRequestRow {
  id: string;
  status: RequestStatus;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  member: { id: string; firstName: string; lastName: string };
  requestedBy: { firstName: string; lastName: string };
  decidedBy: { firstName: string; lastName: string } | null;
  match: {
    id: string;
    opponent: string;
    event: { title: string; startAt: string; team: { id: string; name: string } | null };
  };
}

interface RequestLists {
  toDecide: NominationRequestRow[];
  mine: NominationRequestRow[];
}

const STATUS_SK: Record<RequestStatus, { label: string; cls: string }> = {
  PENDING: { label: 'čaká na schválenie', cls: 'text-amber-600' },
  APPROVED: { label: 'schválené', cls: 'text-green-600' },
  REJECTED: { label: 'zamietnuté', cls: 'text-red-600' },
};

function DecideRow({ r, onDone }: { r: NominationRequestRow; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/nomination-requests/${r.id}/${approve ? 'approve' : 'reject'}`, {
        method: 'POST',
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rozhodnutie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-b border-club-100 py-3 last:border-0">
      <p className="text-sm text-club-900">
        <strong>
          {r.member.lastName} {r.member.firstName}
        </strong>{' '}
        → <Link href={`/portal/zapasy/${r.match.id}`} className="text-club-600 hover:underline">{r.match.event.title}</Link>
        {r.match.event.team ? ` (${r.match.event.team.name})` : ''}
      </p>
      <p className="text-xs text-gray-500">
        {formatEventDateTimeSk(new Date(r.match.event.startAt))} · žiada {r.requestedBy.firstName} {r.requestedBy.lastName}
      </p>
      {r.note && <p className="mt-1 text-xs italic text-gray-600">„{r.note}“</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Poznámka (nepovinné)"
          maxLength={500}
          className={`${inputCls} mt-0 max-w-xs flex-1`}
        />
        <Button onClick={() => decide(true)} disabled={busy}>
          Schváliť
        </Button>
        <Button variant="danger" onClick={() => decide(false)} disabled={busy}>
          Zamietnuť
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </li>
  );
}

/**
 * Žiadosti o nomináciu hráčov z iných družstiev čakajúce na rozhodnutie
 * prihláseného trénera (alebo vedenia). Bez žiadostí sa nevykreslí nič.
 */
export function NominationRequestsPanel({ matchId, onChange }: { matchId?: string; onChange?: () => void }) {
  const { me } = useMe();
  const allowed = isStaff(me) || isCoach(me);
  const [lists, setLists] = useState<RequestLists | null>(null);

  const load = useCallback(async () => {
    try {
      setLists(await api<RequestLists>(`/nomination-requests${matchId ? `?matchId=${matchId}` : ''}`));
    } catch {
      setLists(null);
    }
  }, [matchId]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed || !lists || lists.toDecide.length === 0) return null;
  return (
    <Card className="mb-5">
      <h2 className="mb-2 font-semibold text-club-800">Žiadosti o nomináciu vašich hráčov ({lists.toDecide.length})</h2>
      <p className="mb-2 text-xs text-gray-500">Tréner iného družstva žiada nominovať vášho hráča na svoj zápas.</p>
      <ul>
        {lists.toDecide.map((r) => (
          <DecideRow
            key={r.id}
            r={r}
            onDone={() => {
              void load();
              onChange?.();
            }}
          />
        ))}
      </ul>
    </Card>
  );
}

/**
 * Nominácia z iných družstiev — menný zoznam vekovo vhodných hráčov mimo družstva
 * zápasu. Hráča, ktorého nominujúci netrénuje, nominuje až po schválení jeho trénerom.
 */
export function CrossNomination({ matchId, onChange }: { matchId: string; onChange?: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [mine, setMine] = useState<NominationRequestRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      const lists = await api<RequestLists>(`/nomination-requests?matchId=${matchId}`);
      setMine(lists.mine);
    } catch {
      setMine([]);
    }
  }, [matchId]);

  const loadCandidates = useCallback(async () => {
    try {
      setCandidates(await api<Candidate[]>(`/nomination-requests/match/${matchId}/candidates`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
    }
  }, [matchId]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (open && !candidates) void loadCandidates();
  }, [open, candidates, loadCandidates]);

  async function nominate(c: Candidate) {
    setBusyId(c.id);
    setError(null);
    setInfo(null);
    try {
      const res = await api<{ result: 'NOMINATED' | 'REQUESTED' }>(`/nomination-requests/match/${matchId}`, {
        method: 'POST',
        body: JSON.stringify({ memberId: c.id }),
      });
      setInfo(
        res.result === 'NOMINATED'
          ? `${c.lastName} ${c.firstName} je v nominácii.`
          : `Žiadosť o ${c.lastName} ${c.firstName} bola odoslaná trénerovi jeho družstva.`,
      );
      await Promise.all([loadCandidates(), loadRequests()]);
      if (res.result === 'NOMINATED') onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nominácia zlyhala');
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(c: Candidate) {
    const what = c.nominated ? 'nomináciu' : 'žiadosť o povolenie';
    if (!window.confirm(`Zrušiť ${what} hráča ${c.lastName} ${c.firstName}?`)) return;
    setBusyId(c.id);
    setError(null);
    setInfo(null);
    try {
      const res = await api<{ result: 'REMOVED' | 'CANCELLED' }>(
        `/nomination-requests/match/${matchId}/${encodeURIComponent(c.id)}`,
        { method: 'DELETE' },
      );
      setInfo(
        res.result === 'REMOVED'
          ? `Nominácia hráča ${c.lastName} ${c.firstName} bola zrušená.`
          : `Žiadosť o ${c.lastName} ${c.firstName} bola zrušená.`,
      );
      await Promise.all([loadCandidates(), loadRequests()]);
      if (res.result === 'REMOVED') onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Zrušenie zlyhalo');
    } finally {
      setBusyId(null);
    }
  }

  const needle = q.trim().toLowerCase();
  const shown = (candidates ?? []).filter(
    (c) =>
      !needle ||
      `${c.lastName} ${c.firstName}`.toLowerCase().includes(needle) ||
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(needle) ||
      c.teams.some((t) => t.name.toLowerCase().includes(needle)),
  );

  return (
    <div className="mt-3 border-t border-club-100 pt-3">
      <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} Nominácia z iných družstiev
      </Button>

      {open && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-gray-500">
            Len hráči rovnakej alebo mladšej vekovej kategórie. Hráča, ktorého netrénujete, nominujete až po schválení
            jeho trénerom.
          </p>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hľadať meno alebo družstvo…"
            className={inputCls}
          />
          {info && <p className="mt-2 text-sm text-green-600">{info}</p>}
          <ErrorText>{error}</ErrorText>
          {!candidates ? (
            <p className="mt-2 text-sm text-gray-500">Načítavam…</p>
          ) : (
            <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto">
              {shown.map((c) => {
                const pending = c.requestStatus === 'PENDING';
                return (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded px-3 py-2 text-sm hover:bg-white/5">
                    <span className="min-w-0">
                      <span className="text-club-900">
                        {c.lastName} {c.firstName}
                        <PlayerPos position={c.position} />
                      </span>
                      <span className="ml-2 text-xs text-gray-500">
                        {[c.birthYear, c.categoryCode, c.teams.map((t) => t.name).join(', ')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {c.nominated ? (
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="text-club-600">✓ v nominácii</span>
                        <button
                          onClick={() => cancel(c)}
                          disabled={busyId === c.id}
                          className="text-red-600 hover:underline disabled:opacity-50"
                        >
                          zrušiť nomináciu
                        </button>
                      </span>
                    ) : pending ? (
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="text-amber-600">čaká na schválenie</span>
                        <button
                          onClick={() => cancel(c)}
                          disabled={busyId === c.id}
                          className="text-red-600 hover:underline disabled:opacity-50"
                        >
                          zrušiť žiadosť
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => nominate(c)}
                        disabled={busyId === c.id}
                        className="shrink-0 text-club-600 hover:underline disabled:opacity-50"
                      >
                        {c.direct ? '+ nominovať' : '+ požiadať o povolenie'}
                      </button>
                    )}
                  </li>
                );
              })}
              {shown.length === 0 && <li className="text-sm text-gray-500">Žiadni vhodní hráči.</li>}
            </ul>
          )}
        </div>
      )}

      {mine.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Moje žiadosti k tomuto zápasu</p>
          <ul className="space-y-1 text-sm">
            {mine.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-club-900">
                  {r.member.lastName} {r.member.firstName}
                </span>
                <span className={STATUS_SK[r.status].cls}>
                  {STATUS_SK[r.status].label}
                  {r.decidedBy && r.status !== 'PENDING' ? ` (${r.decidedBy.firstName} ${r.decidedBy.lastName})` : ''}
                  {r.note && r.status !== 'PENDING' ? ` — ${r.note}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
