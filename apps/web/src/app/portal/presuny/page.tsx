'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { coachTeams, isStaff, useMe } from '@/lib/auth';
import { Button, Card, ErrorText, PlayerPos } from '@/components/ui';

interface Team {
  id: string;
  name: string;
  teamCategory: { code: string };
}
interface PlayerHit {
  id: string;
  firstName: string;
  lastName: string;
  position?: string | null;
  position2?: string | null;
  teams: Array<{ id: string; name: string }>;
}
interface PendingTransfer {
  id: string;
  memberName: string;
  fromTeamName: string | null;
  toTeamName: string;
  requestedBy: string;
  createdAt: string;
  canApprove: boolean;
  mine: boolean;
}

export default function TransfersPage() {
  const { me } = useMe();
  const [teams, setTeams] = useState<Team[]>([]);
  const [toTeamId, setToTeamId] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlayerHit[]>([]);
  const [pending, setPending] = useState<PendingTransfer[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availableTeams = useMemo(() => {
    if (isStaff(me)) return teams;
    const ids = new Set(coachTeams(me).map((t) => t.id));
    return teams.filter((t) => ids.has(t.id));
  }, [teams, me]);

  const loadPending = useCallback(() => {
    api<PendingTransfer[]>('/transfers/pending').then(setPending).catch(() => setPending([]));
  }, []);

  useEffect(() => {
    api<Team[]>('/seasons/teams').then(setTeams).catch(() => {});
    loadPending();
  }, [loadPending]);
  useEffect(() => {
    if (!toTeamId && availableTeams[0]) setToTeamId(availableTeams[0].id);
  }, [availableTeams, toTeamId]);

  // vyhľadávanie hráčov (debounce)
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      api<PlayerHit[]>(`/transfers/players?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function requestTransfer(player: PlayerHit) {
    if (!toTeamId) return;
    setMsg(null);
    setError(null);
    setBusyId(player.id);
    try {
      const res = await api<{ applied: boolean; pending: boolean }>('/transfers', {
        method: 'POST',
        body: JSON.stringify({ memberId: player.id, toTeamId }),
      });
      const teamName = availableTeams.find((t) => t.id === toTeamId)?.name ?? 'družstva';
      setMsg(
        res.applied
          ? `${player.lastName} ${player.firstName} bol pridaný do ${teamName}.`
          : `Žiadosť o presun hráča ${player.lastName} ${player.firstName} bola odoslaná trénerovi na schválenie.`,
      );
      setQ('');
      setResults([]);
      loadPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Žiadosť zlyhala');
    } finally {
      setBusyId(null);
    }
  }

  async function decide(id: string, action: 'approve-move' | 'approve-add' | 'reject') {
    setBusyId(id);
    setError(null);
    try {
      if (action === 'reject') {
        await api(`/transfers/${id}/reject`, { method: 'POST' });
      } else {
        await api(`/transfers/${id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ mode: action === 'approve-move' ? 'MOVE' : 'ADD' }),
        });
      }
      loadPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Akcia zlyhala');
    } finally {
      setBusyId(null);
    }
  }

  const toApprove = pending.filter((p) => p.canApprove);
  const mine = pending.filter((p) => !p.canApprove && p.mine);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-club-900">Presuny hráčov</h1>
      {msg && <p className="rounded bg-club-50 px-3 py-2 text-sm text-club-700">{msg}</p>}
      <ErrorText>{error}</ErrorText>

      {/* Nová žiadosť */}
      <Card className="space-y-3">
        <h2 className="font-semibold text-club-800">Požiadať o presun hráča ku mne</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Do družstva:</label>
            <select value={toTeamId} onChange={(e) => setToTeamId(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
              {availableTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Hľadať hráča podľa mena…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-club-500 focus:outline-none"
        />
        <div className="divide-y divide-club-50">
          {q.trim().length >= 2 && results.length === 0 && <p className="py-2 text-sm text-gray-400">Nič nenájdené.</p>}
          {results.map((p) => {
            const alreadyThere = p.teams.some((t) => t.id === toTeamId);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="text-sm">
                  <span className="font-medium text-club-900">
                    {p.lastName} {p.firstName}
                    <PlayerPos position={p.position} position2={p.position2} />
                  </span>{' '}
                  <span className="text-gray-500">
                    {p.teams.length ? p.teams.map((t) => t.name).join(', ') : 'bez družstva'}
                  </span>
                </div>
                <Button variant="ghost" disabled={busyId === p.id || alreadyThere} onClick={() => requestTransfer(p)}>
                  {alreadyThere ? 'Už v družstve' : 'Požiadať o presun'}
                </Button>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-500">
          Vyhľadajte hráča spomedzi všetkých v klube. Ak je v inom družstve, jeho tréner dostane žiadosť na schválenie.
        </p>
      </Card>

      {/* Na schválenie */}
      <Card className="space-y-3">
        <h2 className="font-semibold text-club-800">Žiadosti na schválenie</h2>
        {toApprove.length === 0 ? (
          <p className="text-sm text-gray-500">Žiadne žiadosti na schválenie.</p>
        ) : (
          <ul className="space-y-3">
            {toApprove.map((t) => (
              <li key={t.id} className="rounded-md border border-club-100 p-3">
                <p className="text-sm">
                  <strong className="text-club-900">{t.memberName}</strong>{' '}
                  <span className="text-gray-600">
                    {t.fromTeamName ?? '—'} → {t.toTeamName}
                  </span>{' '}
                  <span className="text-xs text-gray-400">(žiada {t.requestedBy})</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button disabled={busyId === t.id} onClick={() => decide(t.id, 'approve-move')}>
                    Presunúť (vyradiť z pôvodného)
                  </Button>
                  <Button variant="ghost" disabled={busyId === t.id} onClick={() => decide(t.id, 'approve-add')}>
                    Ponechať v oboch
                  </Button>
                  <Button variant="danger" disabled={busyId === t.id} onClick={() => decide(t.id, 'reject')}>
                    Zamietnuť
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Moje odoslané žiadosti */}
      {mine.length > 0 && (
        <Card className="space-y-2">
          <h2 className="font-semibold text-club-800">Moje odoslané žiadosti</h2>
          <ul className="space-y-1 text-sm text-gray-700">
            {mine.map((t) => (
              <li key={t.id}>
                <strong>{t.memberName}</strong> {t.fromTeamName ?? '—'} → {t.toTeamName}{' '}
                <span className="text-xs text-amber-600">čaká na schválenie</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
