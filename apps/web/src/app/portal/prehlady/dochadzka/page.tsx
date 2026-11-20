'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { coachTeams, isStaff, useMe } from '@/lib/auth';
import { Card, ErrorText, Modal } from '@/components/ui';

interface Team {
  id: string;
  name: string;
  teamCategory: { code: string };
}
interface Training {
  id: string;
  startAt: string;
}
interface SheetRow {
  id: string;
  firstName: string;
  lastName: string;
  cells: Record<string, string>;
  summary: Record<string, number>;
}
interface Sheet {
  trainings: Training[];
  rows: SheetRow[];
}

const STATUS_ORDER = ['PRESENT', 'ABSENT', 'EXCUSED', 'SICK', 'INJURED'] as const;
const STATUS_META: Record<string, { abbr: string; label: string; cls: string }> = {
  PRESENT: { abbr: 'P', label: 'Prítomný', cls: 'bg-club-600 text-white' },
  ABSENT: { abbr: 'N', label: 'Neprítomný', cls: 'bg-red-600 text-white' },
  EXCUSED: { abbr: 'O', label: 'Ospravedlnený', cls: 'bg-amber-500 text-white' },
  SICK: { abbr: 'Ch', label: 'Chorý', cls: 'bg-teal-600 text-white' },
  INJURED: { abbr: 'Z', label: 'Zranený', cls: 'bg-purple-600 text-white' },
};

function dayLabel(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AttendanceReportPage() {
  const { me } = useMe();
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ row: SheetRow; training: Training } | null>(null);
  const [saving, setSaving] = useState(false);

  // tréner vidí len svoje družstvá; vedenie všetky
  const availableTeams = useMemo(() => {
    if (isStaff(me)) return teams;
    const ids = new Set(coachTeams(me).map((t) => t.id));
    return teams.filter((t) => ids.has(t.id));
  }, [teams, me]);

  useEffect(() => {
    api<Team[]>('/seasons/teams?withGk=1').then(setTeams).catch(() => {});
  }, []);
  useEffect(() => {
    if (!teamId && availableTeams[0]) setTeamId(availableTeams[0].id);
  }, [availableTeams, teamId]);

  const load = useCallback(async () => {
    if (!teamId || !month) return;
    setLoading(true);
    setError(null);
    try {
      setSheet(await api<Sheet>(`/events/attendance-sheet?team=${teamId}&month=${month}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
      setSheet(null);
    } finally {
      setLoading(false);
    }
  }, [teamId, month]);
  useEffect(() => {
    void load();
  }, [load]);

  // vedenie upravuje všetko; tréner len dochádzku svojho družstva
  const canEdit = isStaff(me) || coachTeams(me).some((t) => t.id === teamId);

  /** Zapíše (alebo zruší) účasť hráča na tréningu a hneď prepočíta list. */
  async function setStatus(row: SheetRow, training: Training, status: string) {
    setSaving(true);
    setError(null);
    try {
      await api(`/events/${training.id}/attendance`, {
        method: 'POST',
        body: JSON.stringify({ memberId: row.id, status }),
      });
      setSheet((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map((r) => {
                if (r.id !== row.id) return r;
                const cells = { ...r.cells, [training.id]: status };
                const summary: Record<string, number> = Object.fromEntries(STATUS_ORDER.map((st) => [st, 0]));
                for (const v of Object.values(cells)) if (v in summary) summary[v]!++;
                return { ...r, cells, summary };
              }),
            }
          : prev,
      );
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link href="/portal/prehlady" className="text-sm text-club-600 hover:underline">
        ← Štatistiky
      </Link>
      <h1 className="text-2xl font-bold text-club-900">Dochádzkový list</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Družstvo:</label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            {availableTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Mesiac:</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
        </div>
      </div>

      {/* legenda */}
      <div className="flex flex-wrap gap-2 text-xs">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={`inline-flex h-5 w-6 items-center justify-center rounded font-bold ${STATUS_META[s].cls}`}>
              {STATUS_META[s].abbr}
            </span>
            <span className="text-gray-600">{STATUS_META[s].label}</span>
          </span>
        ))}
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Card className="text-sm text-gray-500">Načítavam…</Card>
      ) : !sheet || sheet.trainings.length === 0 ? (
        <Card className="text-sm text-gray-500">V zvolenom mesiaci nie sú žiadne tréningy.</Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-club-100 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-club-50 text-club-800">
              <tr>
                <th className="sticky left-0 z-20 whitespace-nowrap bg-club-50 px-3 py-2 text-left shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                  Hráč
                </th>
                {sheet.trainings.map((t) => (
                  <th key={t.id} className="whitespace-nowrap px-2 py-2 text-center font-medium">
                    {dayLabel(t.startAt)}
                  </th>
                ))}
                <th className="whitespace-nowrap px-3 py-2 text-center">Súhrn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-club-100">
              {sheet.rows.map((r) => (
                <tr key={r.id}>
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2 font-medium shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                    {r.lastName} {r.firstName}
                  </td>
                  {sheet.trainings.map((t) => {
                    const st = r.cells[t.id];
                    const meta = st ? STATUS_META[st] : null;
                    const badge = meta ? (
                      <span className={`inline-flex h-6 w-7 items-center justify-center rounded text-xs font-bold ${meta.cls}`}>
                        {meta.abbr}
                      </span>
                    ) : (
                      <span className="text-gray-300">·</span>
                    );
                    return (
                      <td key={t.id} className="px-2 py-1.5 text-center">
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => setEditing({ row: r, training: t })}
                            title="Zmeniť účasť"
                            className="inline-flex h-7 min-w-8 items-center justify-center rounded hover:ring-2 hover:ring-club-300"
                          >
                            {badge}
                          </button>
                        ) : (
                          badge
                        )}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-3 py-1.5 text-center">
                    <span className="inline-flex gap-1">
                      {STATUS_ORDER.filter((s) => r.summary[s] > 0).map((s) => (
                        <span
                          key={s}
                          title={STATUS_META[s].label}
                          className={`inline-flex items-center gap-0.5 rounded px-1 text-xs font-semibold ${STATUS_META[s].cls}`}
                        >
                          {STATUS_META[s].abbr}
                          {r.summary[s]}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
              {sheet.rows.length === 0 && (
                <tr>
                  <td colSpan={sheet.trainings.length + 2} className="px-4 py-8 text-center text-gray-500">
                    Žiadni hráči s dochádzkou.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        {canEdit
          ? 'Kliknutím na políčko doplníte alebo zmeníte účasť hráča na tréningu.'
          : 'Prehľad je len na čítanie. Dochádzku upravuje tréner družstva alebo vedenie.'}
      </p>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.row.lastName} ${editing.row.firstName} · ${dayLabel(editing.training.startAt)}` : ''}
      >
        {editing && (
          <div className="space-y-2">
            {STATUS_ORDER.map((st) => {
              const active = editing.row.cells[editing.training.id] === st;
              return (
                <button
                  key={st}
                  type="button"
                  disabled={saving}
                  onClick={() => void setStatus(editing.row, editing.training, st)}
                  className={`flex w-full items-center gap-3 rounded border px-3 py-2 text-left text-sm hover:bg-club-50 ${active ? 'border-club-600 ring-1 ring-club-600' : 'border-club-100'}`}
                >
                  <span className={`inline-flex h-6 w-7 items-center justify-center rounded text-xs font-bold ${STATUS_META[st].cls}`}>
                    {STATUS_META[st].abbr}
                  </span>
                  {STATUS_META[st].label}
                </button>
              );
            })}
            <button
              type="button"
              disabled={saving}
              onClick={() => void setStatus(editing.row, editing.training, 'UNKNOWN')}
              className="w-full rounded border border-club-100 px-3 py-2 text-left text-sm text-gray-600 hover:bg-club-50"
            >
              Zrušiť zápis (nezapísané)
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
