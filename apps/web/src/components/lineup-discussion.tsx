'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button, Card, ErrorText, inputCls, labelCls } from '@/components/ui';

interface Person {
  id: string;
  firstName: string;
  lastName: string;
}
interface Discussion {
  participant: boolean;
  owner: boolean;
  shares: Person[];
  comments: Array<{ id: string; body: string; createdAt: string; author: Person }>;
  candidates: Array<Person & { teams: string[] }>;
}

function when(iso: string) {
  return new Date(iso).toLocaleString('sk-SK', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Bratislava' });
}

/**
 * Konzultácia rozostavenia medzi trénermi: tréner družstva vyberie, s kým
 * rozostavenie zdieľa; zdieľaní tréneri ho vidia a môžu pod ním diskutovať.
 */
export function LineupDiscussion({ matchId, meId, isStaff }: { matchId: string; meId: string | undefined; isStaff: boolean }) {
  const [data, setData] = useState<Discussion | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Discussion>(`/matches/${matchId}/lineup-discussion`));
    } catch {
      /* bez prístupu */
    }
  }, [matchId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  if (!data || !data.participant) return null;

  async function run(fn: () => Promise<Discussion>) {
    setBusy(true);
    setError(null);
    try {
      setData(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Akcia zlyhala');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="lg:col-span-2">
      <h2 className="mb-1 font-semibold text-club-800">Konzultácia rozostavenia s trénermi</h2>
      <p className="mb-3 text-xs text-gray-500">
        Rozostavenie vidia a môžu ho komentovať len tréneri, s ktorými ho zdieľate.
      </p>

      <div className="mb-4 rounded-md bg-club-50 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-medium text-club-900">Zdieľané s: </span>
            {data.shares.length === 0 ? (
              <span className="text-gray-500">nikým</span>
            ) : (
              data.shares.map((s) => `${s.firstName} ${s.lastName}`).join(', ')
            )}
          </div>
          {data.owner && !editing && (
            <Button
              variant="ghost"
              onClick={() => {
                setPicked(data.shares.map((s) => s.id));
                setEditing(true);
              }}
            >
              Upraviť zdieľanie
            </Button>
          )}
        </div>
        {data.owner && editing && (
          <div className="mt-3">
            <label className={labelCls}>Vyberte trénerov</label>
            <div className="mt-1 grid max-h-48 gap-1 overflow-y-auto rounded-md border border-gray-200 bg-white p-2 sm:grid-cols-2">
              {data.candidates.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={picked.includes(c.id)}
                    onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                  />
                  <span>
                    {c.lastName} {c.firstName}
                    {c.teams.length > 0 && <span className="text-xs text-gray-500"> · {c.teams.join(', ')}</span>}
                  </span>
                </label>
              ))}
              {data.candidates.length === 0 && <p className="text-sm text-gray-400">Žiadni ďalší tréneri.</p>}
            </div>
            <div className="mt-2 flex gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Zrušiť
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await api<Discussion>(`/matches/${matchId}/lineup-shares`, {
                      method: 'PUT',
                      body: JSON.stringify({ userIds: picked }),
                    });
                    setEditing(false);
                    return r;
                  })
                }
              >
                Uložiť zdieľanie
              </Button>
            </div>
            <p className="mt-1 text-xs text-gray-500">Novým trénerom príde oznámenie do mobilnej aplikácie.</p>
          </div>
        )}
      </div>

      <ul className="mb-3 max-h-80 space-y-2 overflow-y-auto">
        {data.comments.map((c) => (
          <li key={c.id} className={`rounded-md p-2 text-sm ${c.author.id === meId ? 'bg-club-50' : 'bg-gray-50'}`}>
            <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
              <span className="font-medium text-club-800">
                {c.author.firstName} {c.author.lastName}
              </span>
              <span>
                {when(c.createdAt)}
                {(c.author.id === meId || isStaff) && (
                  <button
                    className="ml-2 text-red-500 hover:text-red-700"
                    title="Zmazať"
                    onClick={() => run(() => api<Discussion>(`/matches/${matchId}/lineup-comments/${c.id}`, { method: 'DELETE' }))}
                  >
                    ✕
                  </button>
                )}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
        {data.comments.length === 0 && <li className="text-sm text-gray-500">Zatiaľ nikto nekomentoval. Napíšte prvý názor.</li>}
      </ul>

      <textarea
        id="lineup-comment"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Napíšte názor k rozostaveniu…"
        className={inputCls}
      />
      <ErrorText>{error}</ErrorText>
      <div className="mt-2 flex justify-end">
        <Button
          disabled={busy || !text.trim()}
          onClick={() =>
            run(async () => {
              const r = await api<Discussion>(`/matches/${matchId}/lineup-comments`, {
                method: 'POST',
                body: JSON.stringify({ body: text }),
              });
              setText('');
              return r;
            })
          }
        >
          Odoslať
        </Button>
      </div>
    </Card>
  );
}
