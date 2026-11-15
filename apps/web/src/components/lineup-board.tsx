'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  LINEUP_FORMATS,
  PLAYER_POSITION_LABELS_SK,
  PLAYER_POSITION_SHORT,
  defaultLineupFormat,
  type MatchLineup,
  type PlayerPosition,
} from '@fkknv/shared';
import { api } from '@/lib/api';
import { Button, Card, ErrorText, inputCls, labelCls } from '@/components/ui';

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  position?: string | null;
}

const ORDER: PlayerPosition[] = ['GK', 'CB', 'FB', 'WB', 'CDM', 'CM', 'CAM', 'WM', 'W', 'SS', 'ST'];
const short = (p: string) => (PLAYER_POSITION_SHORT as Record<string, string>)[p] ?? p;
const label = (p: string) => (PLAYER_POSITION_LABELS_SK as Record<string, string>)[p]?.replace(/ \(.*\)$/, '') ?? p;

/**
 * Rozostavenie hráčov na malom ihrisku podľa postavenia. Tréner/vedenie
 * skladá zostavu z nominovaných hráčov, ostatní vidia uloženú zostavu.
 */
export function LineupBoard({
  matchId,
  players,
  lineup,
  categoryCode,
  manage,
  onSaved,
}: {
  matchId: string;
  players: Player[];
  lineup: MatchLineup | null | undefined;
  categoryCode?: string | null;
  manage: boolean;
  onSaved: () => void;
}) {
  const [format, setFormat] = useState(lineup?.format ?? defaultLineupFormat(categoryCode));
  const [formation, setFormation] = useState(lineup?.formation ?? Object.keys(LINEUP_FORMATS[format].formations)[0]);
  const [slots, setSlots] = useState<Record<string, string>>(lineup?.slots ?? {});
  const [selPlayer, setSelPlayer] = useState<string | null>(null);
  const [selSlot, setSelSlot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // po načítaní uloženej zostavy zo servera ju prevezmi
  const lineupKey = JSON.stringify(lineup ?? null);
  useEffect(() => {
    if (lineup && LINEUP_FORMATS[lineup.format]?.formations[lineup.formation]) {
      setFormat(lineup.format);
      setFormation(lineup.formation);
      setSlots(lineup.slots);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineupKey]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const formationSlots = LINEUP_FORMATS[format]?.formations[formation] ?? [];
  const used = new Set(Object.values(slots).filter((id) => byId.has(id)));

  if (!manage && !lineup) return null;

  function changeFormat(f: string) {
    setFormat(f);
    setFormation(Object.keys(LINEUP_FORMATS[f].formations)[0]);
    setSlots({});
    setSelPlayer(null);
    setSelSlot(null);
  }
  function changeFormation(f: string) {
    setFormation(f);
    setSlots({});
    setSelPlayer(null);
    setSelSlot(null);
  }
  function place(slot: number, playerId: string) {
    setSlots((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([, id]) => id !== playerId));
      next[String(slot)] = playerId;
      return next;
    });
    setSelPlayer(null);
    setSelSlot(null);
    setSaved(false);
  }
  function clickSlot(i: number) {
    if (!manage) return;
    if (selPlayer) return place(i, selPlayer);
    if (slots[String(i)]) {
      setSlots((prev) => {
        const next = { ...prev };
        delete next[String(i)];
        return next;
      });
      setSaved(false);
      return;
    }
    setSelSlot(selSlot === i ? null : i);
  }
  function clickPlayer(id: string) {
    if (selSlot !== null) return place(selSlot, id);
    setSelPlayer(selPlayer === id ? null : id);
  }
  function suggest() {
    const taken = new Set<string>();
    const next: Record<string, string> = {};
    formationSlots.forEach((s, i) => {
      const c = players.find((p) => p.position === s.pos && !taken.has(p.id));
      if (c) {
        next[String(i)] = c.id;
        taken.add(c.id);
      }
    });
    setSlots(next);
    setSaved(false);
  }
  async function save(clear = false) {
    setBusy(true);
    setError(null);
    try {
      await api(`/matches/${matchId}/lineup`, {
        method: 'PUT',
        body: JSON.stringify(clear || Object.keys(slots).length === 0 ? null : { format, formation, slots }),
      });
      if (clear) setSlots({});
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  const groups = ORDER.map((pos) => ({ pos, list: players.filter((p) => p.position === pos) })).filter((g) => g.list.length);
  const noPos = players.filter((p) => !p.position || !ORDER.includes(p.position as PlayerPosition));
  if (noPos.length) groups.push({ pos: '' as PlayerPosition, list: noPos });

  return (
    <Card className="lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-semibold text-club-800">
          Rozostavenie ({Object.keys(slots).length} / {formationSlots.length})
        </h2>
        {manage && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className={labelCls}>Formát</label>
              <select value={format} onChange={(e) => changeFormat(e.target.value)} className={inputCls}>
                {Object.entries(LINEUP_FORMATS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Rozostavenie</label>
              <select value={formation} onChange={(e) => changeFormation(e.target.value)} className={inputCls}>
                {Object.keys(LINEUP_FORMATS[format].formations).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="mx-auto w-full max-w-[420px]">
          <div
            className="relative w-full overflow-hidden rounded-md"
            style={{
              aspectRatio: '68 / 100',
              background: 'repeating-linear-gradient(180deg,#2f8a52 0 12.5%,#36955a 12.5% 25%)',
            }}
          >
            <svg viewBox="0 0 68 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
              <g fill="none" stroke="rgba(255,255,255,.75)" strokeWidth=".5">
                <rect x="2" y="2" width="64" height="96" />
                <line x1="2" y1="50" x2="66" y2="50" />
                <circle cx="34" cy="50" r="8" />
                <rect x="16" y="2" width="36" height="14" />
                <rect x="26" y="2" width="16" height="5" />
                <rect x="16" y="84" width="36" height="14" />
                <rect x="26" y="93" width="16" height="5" />
              </g>
            </svg>
            {formationSlots.map((s, i) => {
              const p = byId.get(slots[String(i)] ?? '');
              const off = p && p.position !== s.pos;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!manage}
                  onClick={() => clickSlot(i)}
                  aria-label={`${label(s.pos)}${p ? `: ${p.lastName} ${p.firstName}` : ': voľné'}`}
                  className="absolute grid w-[22%] min-w-[60px] -translate-x-1/2 -translate-y-1/2 justify-items-center gap-0.5"
                  style={{ left: `${s.x}%`, top: `${s.y}%` }}
                >
                  <span
                    className="grid h-9 w-9 place-items-center rounded-full text-[11px] font-bold"
                    style={{
                      border: `2px ${p ? 'solid' : 'dashed'} ${off ? '#ffc861' : '#fff'}`,
                      background: p ? '#fff' : 'rgba(0,0,0,.18)',
                      color: p ? '#14201a' : '#fff',
                      boxShadow: selSlot === i ? '0 0 0 4px rgba(255,255,255,.55)' : undefined,
                    }}
                  >
                    {short(s.pos)}
                  </span>
                  <span className="max-w-full break-words text-center text-[11px] font-semibold leading-tight text-white [text-shadow:0_1px_2px_rgba(0,0,0,.7)]">
                    {p ? p.lastName : ''}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Biely kruh = hráč na svojom postavení, oranžový okraj = na inom postavení, čiarkovaný = voľný post.
          </p>
        </div>

        <div>
          {manage ? (
            <>
              <p className="mb-2 text-xs text-gray-500">
                Kliknite na hráča a potom na post (alebo naopak). Kliknutím na obsadený post hráča zložíte.
              </p>
              <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                {groups.map((g) => (
                  <div key={g.pos || 'none'}>
                    <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                      {g.pos ? label(g.pos) : 'Bez postavenia'} ({g.list.length})
                    </h3>
                    {g.list.map((p) => {
                      const on = used.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => clickPlayer(p.id)}
                          className={`mb-1 flex w-full items-center justify-between gap-2 rounded border px-3 py-1.5 text-left text-sm ${
                            selPlayer === p.id ? 'border-club-600 bg-club-50' : 'border-gray-200 hover:bg-club-50'
                          } ${on ? 'opacity-50' : ''}`}
                        >
                          <span>
                            {p.lastName} {p.firstName}
                          </span>
                          <span className="text-xs text-gray-500">{on ? 'v zostave' : p.position ? short(p.position) : ''}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {players.length === 0 && <p className="text-sm text-gray-500">Najprv nominujte hráčov.</p>}
              </div>
              <ErrorText>{error}</ErrorText>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="ghost" onClick={suggest} disabled={players.length === 0}>
                  Navrhnúť podľa postavenia
                </Button>
                <Button variant="ghost" onClick={() => setSlots({})}>
                  Vyčistiť
                </Button>
                <Button onClick={() => save()} disabled={busy}>
                  {busy ? 'Ukladám…' : saved ? 'Uložené ✓' : 'Uložiť rozostavenie'}
                </Button>
              </div>
            </>
          ) : (
            <ul className="space-y-1 text-sm">
              {formationSlots.map((s, i) => {
                const p = byId.get(slots[String(i)] ?? '');
                return p ? (
                  <li key={i} className="flex justify-between gap-2 border-b border-club-100 py-1">
                    <span>
                      {p.lastName} {p.firstName}
                    </span>
                    <span className="text-xs text-gray-500">{short(s.pos)}</span>
                  </li>
                ) : null;
              })}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
