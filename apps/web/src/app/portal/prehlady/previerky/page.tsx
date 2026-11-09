'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { FitnessCategory } from '@fkknv/shared';
import { api } from '@/lib/api';
import { Card, ErrorText, inputCls } from '@/components/ui';
import {
  CategoryTabs,
  LEGEND,
  ValueCell,
  disciplinesOf,
  enduranceNote,
  formatDate,
  previousOf,
  type FitnessTest,
} from '@/components/fitness';

type Mode = 'players' | 'dates';
type Sel = { kind: 'player'; memberId: string } | { kind: 'date'; date: string; teamId: string | null } | null;

const collator = new Intl.Collator('sk');
const fullName = (m: { firstName: string; lastName: string }) => `${m.lastName} ${m.firstName}`;

export default function FitnessTestsPage() {
  const [tests, setTests] = useState<FitnessTest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('players');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'team' | 'date'>('name');
  const [sel, setSel] = useState<Sel>(null);
  const [teamFilter, setTeamFilter] = useState('');
  const [category, setCategory] = useState<FitnessCategory>('SILOVE');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(() => {
    api<FitnessTest[]>('/fitness-tests')
      .then(setTests)
      .catch((e) => setError(e instanceof Error ? e.message : 'Načítanie zlyhalo'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  // družstvá, v ktorých existujú previerky (na filter)
  const teamOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tests) if (t.team) m.set(t.team.id, t.team.name);
    return [...m.entries()].sort((a, b) => collator.compare(a[1], b[1]));
  }, [tests]);

  async function removeGroup(date: string, teamId: string | null, label: string) {
    if (!window.confirm(`Vymazať testovanie ${label}? Zmažú sa výsledky všetkých hráčov z tohto dňa.`)) return;
    const key = `${date}|${teamId ?? ''}`;
    setBusyKey(key);
    setError(null);
    try {
      for (const t of tests.filter((x) => x.testedAt === date && x.teamId === teamId)) {
        await api(`/fitness-tests/${t.id}`, { method: 'DELETE' });
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vymazanie zlyhalo');
      load();
    } finally {
      setBusyKey(null);
    }
  }

  const q = search.trim().toLowerCase();

  // zoznam hráčov (posledné družstvo = družstvo z najnovšej previerky)
  const players = useMemo(() => {
    const map = new Map<string, { member: FitnessTest['member']; team: string; count: number; last: string }>();
    for (const t of tests) {
      if (teamFilter && t.teamId !== teamFilter) continue;
      const cur = map.get(t.memberId);
      if (!cur) map.set(t.memberId, { member: t.member, team: t.team?.name ?? '', count: 1, last: t.testedAt });
      else {
        cur.count++;
        if (t.testedAt >= cur.last) {
          cur.last = t.testedAt;
          cur.team = t.team?.name ?? cur.team;
        }
      }
    }
    return [...map.values()]
      .filter((p) => !q || fullName(p.member).toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .sort((a, b) =>
        sortBy === 'team'
          ? collator.compare(a.team, b.team) || collator.compare(fullName(a.member), fullName(b.member))
          : sortBy === 'date'
            ? b.last.localeCompare(a.last)
            : collator.compare(fullName(a.member), fullName(b.member)),
      );
  }, [tests, q, sortBy, teamFilter]);

  // zoznam previerok: dátum + družstvo
  const dates = useMemo(() => {
    const map = new Map<string, { date: string; teamId: string | null; team: string; count: number }>();
    for (const t of tests) {
      if (teamFilter && t.teamId !== teamFilter) continue;
      const key = `${t.testedAt}|${t.teamId ?? ''}`;
      const cur = map.get(key);
      if (cur) cur.count++;
      else map.set(key, { date: t.testedAt, teamId: t.teamId, team: t.team?.name ?? '—', count: 1 });
    }
    return [...map.values()]
      .filter((d) => !q || d.team.toLowerCase().includes(q) || formatDate(d.date).includes(q))
      .sort((a, b) =>
        sortBy === 'team'
          ? collator.compare(a.team, b.team) || b.date.localeCompare(a.date)
          : b.date.localeCompare(a.date) || collator.compare(a.team, b.team),
      );
  }, [tests, q, sortBy, teamFilter]);

  const thCls = 'whitespace-nowrap px-3 py-2 text-left font-medium';
  const rowCls = 'cursor-pointer hover:bg-club-50';

  // ---------- detail ----------
  if (sel?.kind === 'player') {
    const rows = tests.filter((t) => t.memberId === sel.memberId); // už zoradené podľa dátumu
    const member = rows[0]?.member;
    return (
      <div className="space-y-5">
        <button onClick={() => setSel(null)} className="text-sm text-club-600 hover:underline">
          ← Testovanie
        </button>
        <h1 className="text-2xl font-bold text-club-900">{member ? fullName(member) : 'Hráč'}</h1>
        <CategoryTabs value={category} onChange={setCategory} />
        <div className="overflow-x-auto rounded-lg border border-club-100 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-club-50 text-club-800">
              <tr>
                <th className={thCls}>Dátum</th>
                {disciplinesOf(category).map((d) => (
                  <th key={d.key} className={thCls}>
                    {d.label} ({d.unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-club-100">
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{formatDate(t.testedAt)}</td>
                  {disciplinesOf(category).map((d) => (
                    <td key={d.key} className="whitespace-nowrap px-3 py-2">
                      <ValueCell value={t[d.key]} previous={previousOf(tests, t, d.key)} discipline={d} note={enduranceNote(t, d.key)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {LEGEND}
      </div>
    );
  }

  if (sel?.kind === 'date') {
    const rows = tests
      .filter((t) => t.testedAt === sel.date && t.teamId === sel.teamId)
      .sort((a, b) => collator.compare(fullName(a.member), fullName(b.member)));
    return (
      <div className="space-y-5">
        <button onClick={() => setSel(null)} className="text-sm text-club-600 hover:underline">
          ← Testovanie
        </button>
        <h1 className="text-2xl font-bold text-club-900">
          Testovanie {formatDate(sel.date)}
          {rows[0]?.team ? ` — ${rows[0].team.name}` : ''}
        </h1>
        <CategoryTabs value={category} onChange={setCategory} />
        <div className="overflow-x-auto rounded-lg border border-club-100 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-club-50 text-club-800">
              <tr>
                <th className={thCls}>Meno hráča</th>
                <th className={thCls}>Družstvo</th>
                {disciplinesOf(category).map((d) => (
                  <th key={d.key} className={thCls}>
                    {d.label} ({d.unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-club-100">
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{fullName(t.member)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{t.team?.name ?? '—'}</td>
                  {disciplinesOf(category).map((d) => (
                    <td key={d.key} className="whitespace-nowrap px-3 py-2">
                      <ValueCell value={t[d.key]} previous={previousOf(tests, t, d.key)} discipline={d} note={enduranceNote(t, d.key)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {LEGEND}
      </div>
    );
  }

  // ---------- zoznamy ----------
  return (
    <div className="space-y-5">
      <Link href="/portal/prehlady" className="text-sm text-club-600 hover:underline">
        ← Štatistiky
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-club-900">Testovanie</h1>
        <Link
          href="/portal/prehlady/previerky/nova"
          className="rounded-md bg-club-600 px-4 py-2 text-sm font-semibold text-white hover:bg-club-700"
        >
          + Nové testovanie
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-club-300 text-sm">
          {(
            [
              ['players', 'Podľa hráčov'],
              ['dates', 'Podľa dátumu'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setSortBy(m === 'dates' ? 'date' : 'name');
              }}
              className={`px-3 py-1.5 ${mode === m ? 'bg-club-600 text-white' : 'bg-white text-club-700 hover:bg-club-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={mode === 'players' ? 'Hľadať priezvisko / družstvo…' : 'Hľadať družstvo / dátum…'}
          className={`${inputCls} !mt-0 max-w-xs`}
        />
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">Všetky družstvá</option>
          {teamOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          {mode === 'players' ? <option value="name">Triediť: priezvisko</option> : null}
          <option value="team">Triediť: družstvo</option>
          <option value="date">Triediť: dátum</option>
        </select>
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Card className="text-sm text-gray-500">Načítavam…</Card>
      ) : (mode === 'players' ? players.length : dates.length) === 0 ? (
        <Card className="text-sm text-gray-500">
          Žiadne testovania. Vytvoríte ich tlačidlom „Nové testovanie“, z tréningu alebo v karte hráča.
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-club-100 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-club-50 text-club-800">
              {mode === 'players' ? (
                <tr>
                  <th className={thCls}>Hráč</th>
                  <th className={thCls}>Družstvo</th>
                  <th className={thCls}>Posledné testovanie</th>
                  <th className={thCls}>Počet previerok</th>
                </tr>
              ) : (
                <tr>
                  <th className={thCls}>Dátum</th>
                  <th className={thCls}>Družstvo</th>
                  <th className={thCls}>Počet hráčov</th>
                  <th />
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-club-100">
              {mode === 'players'
                ? players.map((p) => (
                    <tr key={p.member.id} className={rowCls} onClick={() => setSel({ kind: 'player', memberId: p.member.id })}>
                      <td className="px-3 py-2 font-medium text-club-800">{fullName(p.member)}</td>
                      <td className="px-3 py-2">{p.team || '—'}</td>
                      <td className="px-3 py-2">{formatDate(p.last)}</td>
                      <td className="px-3 py-2">{p.count}</td>
                    </tr>
                  ))
                : dates.map((d) => (
                    <tr key={`${d.date}|${d.teamId}`} className={rowCls} onClick={() => setSel({ kind: 'date', date: d.date, teamId: d.teamId })}>
                      <td className="px-3 py-2 font-medium text-club-800">{formatDate(d.date)}</td>
                      <td className="px-3 py-2">{d.team}</td>
                      <td className="px-3 py-2">{d.count}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        {d.teamId && (
                          <Link
                            href={`/portal/prehlady/previerky/nova?team=${d.teamId}&date=${d.date}`}
                            className="text-club-600 hover:underline"
                          >
                            Upraviť
                          </Link>
                        )}{' '}
                        <button
                          onClick={() => removeGroup(d.date, d.teamId, `${formatDate(d.date)} — ${d.team}`)}
                          disabled={busyKey === `${d.date}|${d.teamId ?? ''}`}
                          className="text-red-600 hover:underline disabled:opacity-50"
                        >
                          Vymazať
                        </button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
