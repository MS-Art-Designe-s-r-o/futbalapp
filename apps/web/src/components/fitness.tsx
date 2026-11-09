'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  FITNESS_DISCIPLINES,
  fitnessDelta,
  formatFitnessDate,
  previousFitnessValue,
  enduranceMinutesFor,
  fitnessDisciplineLabel,
  FITNESS_CATEGORIES,
  type FitnessCategory,
  type FitnessDiscipline,
  type FitnessDisciplineKey,
} from '@fkknv/shared';

import { api } from '@/lib/api';
import { Button, ErrorText, inputCls, labelCls } from '@/components/ui';

export interface FitnessTest {
  id: string;
  memberId: string;
  teamId: string | null;
  testedAt: string; // YYYY-MM-DD
  run10m: number | null;
  run30m: number | null;
  shuttleRun: number | null;
  dribbleSlalom: number | null;
  enduranceRun: number | null;
  enduranceMinutes: number | null;
  standingJump: number | null;
  pullUpHang: number | null;
  shuttleEndurance: number | null;
  sitUps30: number | null;
  medicineBallThrow: number | null;
  juggling: number | null;
  passesRunning: number | null;
  shooting: number | null;
  member: { id: string; firstName: string; lastName: string };
  team: { id: string; name: string } | null;
}

export type DisciplineKey = FitnessDisciplineKey;
export const DISCIPLINES = FITNESS_DISCIPLINES;
export const formatDate = formatFitnessDate;
export { fitnessDisciplineLabel };

export const disciplinesOf = (category: FitnessCategory) => FITNESS_DISCIPLINES.filter((d) => d.category === category);

/** Prepínač kategórií disciplín (Silové / Vytrvalostné / Technické). */
export function CategoryTabs({ value, onChange }: { value: FitnessCategory; onChange: (c: FitnessCategory) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-club-300 text-sm">
      {FITNESS_CATEGORIES.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onChange(c.key)}
          className={`px-3 py-1.5 ${value === c.key ? 'bg-club-600 text-white' : 'bg-white text-club-700 hover:bg-club-50'}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** Poznámka k vytrvalostnému behu (dĺžka v minútach) pri hodnote v tabuľke. */
export const enduranceNote = (t: Pick<FitnessTest, 'enduranceMinutes'>, key: DisciplineKey) =>
  key === 'enduranceRun' && t.enduranceMinutes ? `${t.enduranceMinutes} min` : undefined;

/** Porovnanie s predchádzajúcou previerkou hráča (ktorá mala v danej disciplíne hodnotu). */
export const previousOf = (all: FitnessTest[], test: FitnessTest, key: DisciplineKey) =>
  previousFitnessValue(all, test, key);

/** Hodnota farebne: zlepšenie zelená, zhoršenie červená, rovnaká čierna; v zátvorke rozdiel. */
export function ValueCell({
  value,
  previous,
  discipline,
  note,
}: {
  value: number | null;
  previous: number | null;
  discipline: FitnessDiscipline;
  note?: string;
}) {
  const { text, trend } = fitnessDelta(value, previous, discipline);
  if (trend === 'none' && value == null) return <span className="text-gray-300">–</span>;
  const cls =
    trend === 'better' ? 'font-semibold text-green-600' : trend === 'worse' ? 'font-semibold text-red-600' : trend === 'same' ? 'text-black' : '';
  return (
    <span className={cls}>
      {text}
      {note && <span className="ml-1 text-xs font-normal text-gray-400">{note}</span>}
    </span>
  );
}

export const LEGEND = (
  <p className="text-xs text-gray-500">
    <span className="font-semibold text-green-600">Zelená</span> = zlepšenie,{' '}
    <span className="font-semibold text-red-600">červená</span> = zhoršenie, čierna = bez zmeny oproti predchádzajúcej
    testovaní (v zátvorke rozdiel).
  </p>
);

const emptyForm = () => ({
  testedAt: new Date().toISOString().slice(0, 10),
  teamId: '',
  ...(Object.fromEntries(DISCIPLINES.map((d) => [d.key, ''])) as Record<DisciplineKey, string>),
});

/** Zoznam previerok hráča + pridanie / úprava / zmazanie (karta hráča). */
export function PlayerFitnessPanel({
  memberId,
  teams,
}: {
  memberId: string;
  teams: Array<{ id: string; name: string; teamCategory?: { code: string; name?: string } }>;
}) {
  const [tests, setTests] = useState<FitnessTest[]>([]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<FitnessCategory>('SILOVE');

  const load = useCallback(() => {
    api<FitnessTest[]>(`/fitness-tests?member=${memberId}`)
      .then(setTests)
      .catch((e) => setError(e instanceof Error ? e.message : 'Načítanie previerok zlyhalo'));
  }, [memberId]);
  useEffect(load, [load]);

  function startEdit(t: FitnessTest | null) {
    setError(null);
    if (!t) {
      setForm({ ...emptyForm(), teamId: teams[0]?.id ?? '' });
      setEditing('new');
      return;
    }
    setForm({
      ...emptyForm(),
      testedAt: t.testedAt,
      teamId: t.teamId ?? '',
      ...(Object.fromEntries(DISCIPLINES.map((d) => [d.key, t[d.key]?.toString() ?? ''])) as Record<DisciplineKey, string>),
    });
    setEditing(t.id);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
    const body = {
      testedAt: form.testedAt,
      ...(Object.fromEntries(DISCIPLINES.map((d) => [d.key, num(form[d.key])])) as Record<DisciplineKey, number | null>),
      ...(editing === 'new' ? { memberId, teamId: form.teamId || null } : {}),
    };
    try {
      if (editing === 'new') await api('/fitness-tests', { method: 'POST', body: JSON.stringify(body) });
      else await api(`/fitness-tests/${editing}`, { method: 'PATCH', body: JSON.stringify(body) });
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Zmazať toto testovanie?')) return;
    try {
      await api(`/fitness-tests/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Zmazanie zlyhalo');
    }
  }

  const desc = [...tests].reverse();
  const editedTest = editing && editing !== 'new' ? tests.find((t) => t.id === editing) : null;
  const formMinutes =
    editing === 'new'
      ? enduranceMinutesFor(
          teams.find((t) => t.id === form.teamId)?.teamCategory?.code,
          teams.find((t) => t.id === form.teamId)?.teamCategory?.name,
        )
      : (editedTest?.enduranceMinutes ?? null);

  return (
    <div className="space-y-2 rounded-md border border-club-100 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-club-800">Testovanie</h3>
        {editing === null && (
          <Button variant="ghost" onClick={() => startEdit(null)} className="!px-2 !py-1 !text-xs">
            + Pridať testovanie
          </Button>
        )}
      </div>

      {editing !== null && (
        <div className="space-y-2 rounded-md bg-club-50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Dátum</label>
              <input type="date" value={form.testedAt} onChange={(e) => setForm({ ...form, testedAt: e.target.value })} className={inputCls} />
            </div>
            {editing === 'new' && teams.length > 0 && (
              <div>
                <label className={labelCls}>Družstvo</label>
                <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} className={inputCls}>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-span-2">
              <CategoryTabs value={category} onChange={setCategory} />
            </div>
            {disciplinesOf(category).map((d) => (
              <div key={d.key}>
                <label className={labelCls}>
                  {fitnessDisciplineLabel(d, formMinutes)} ({d.unit})
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={d.step}
                  min="0"
                  value={form[d.key]}
                  onChange={(e) => setForm({ ...form, [d.key]: e.target.value })}
                  className={inputCls}
                />
              </div>
            ))}
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Zrušiť
            </Button>
            <Button onClick={save} disabled={busy || !form.testedAt}>
              {busy ? 'Ukladám…' : 'Uložiť'}
            </Button>
          </div>
        </div>
      )}
      {editing === null && <ErrorText>{error}</ErrorText>}

      {desc.length === 0 ? (
        <p className="text-xs text-gray-500">Zatiaľ žiadne testovania.</p>
      ) : (
        <div className="space-y-2">
          {editing === null && <CategoryTabs value={category} onChange={setCategory} />}
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="px-1 py-1 text-left">Dátum</th>
                {disciplinesOf(category).map((d) => (
                  <th key={d.key} className="whitespace-nowrap px-1 py-1 text-left font-medium">
                    {d.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-club-100">
              {desc.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap px-1 py-1">{formatDate(t.testedAt)}</td>
                  {disciplinesOf(category).map((d) => (
                    <td key={d.key} className="whitespace-nowrap px-1 py-1">
                      <ValueCell value={t[d.key]} previous={previousOf(tests, t, d.key)} discipline={d} note={enduranceNote(t, d.key)} />
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-1 py-1 text-right">
                    <button onClick={() => startEdit(t)} className="text-club-600 hover:underline">
                      Upraviť
                    </button>{' '}
                    <button onClick={() => remove(t.id)} className="text-red-600 hover:underline">
                      Zmazať
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      {desc.length > 1 && LEGEND}
    </div>
  );
}
