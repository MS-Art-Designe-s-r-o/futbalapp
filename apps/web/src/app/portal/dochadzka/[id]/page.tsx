'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SURFACE_LABELS_SK, formatEventDateTimeSk, type SurfaceCode } from '@fkknv/shared';
import { api } from '@/lib/api';
import { coachTeams, isStaff, useMe } from '@/lib/auth';
import { Card } from '@/components/ui';
import { AddressLink } from '@/components/AddressLink';
import { MapEmbed } from '@/components/MapEmbed';
import { EventAdminActions } from '@/components/event-admin-actions';

interface AttendanceRow {
  id: string;
  status: string;
  member: { id: string; firstName: string; lastName: string };
}
interface EventDetail {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  location: string | null;
  address: string | null;
  surface: SurfaceCode | null;
  recurrenceGroupId: string | null;
  team: { id: string; name: string } | null;
  attendances: AttendanceRow[];
}

const STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED', 'INJURED', 'SICK'] as const;
const labels: Record<string, string> = {
  PRESENT: 'Prítomný',
  ABSENT: 'Neprítomný',
  EXCUSED: 'Ospravedlnený',
  INJURED: 'Zranený',
  SICK: 'Chorý',
  UNKNOWN: '—',
};
const colors: Record<string, string> = {
  PRESENT: 'bg-club-600 text-white',
  ABSENT: 'bg-red-600 text-white',
  EXCUSED: 'bg-amber-500 text-white',
  INJURED: 'bg-purple-600 text-white',
  SICK: 'bg-teal-600 text-white',
  UNKNOWN: 'bg-gray-100 text-gray-600',
};

export default function AttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEvent(await api<EventDetail>(`/events/${id}/attendance`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(row: AttendanceRow, status: string) {
    // opätovný klik na už zvolený stav ho zruší (žiadna voľba = UNKNOWN)
    const next = row.status === status ? 'UNKNOWN' : status;
    setEvent((prev) =>
      prev ? { ...prev, attendances: prev.attendances.map((a) => (a.id === row.id ? { ...a, status: next } : a)) } : prev,
    );
    await api(`/events/${id}/attendance`, {
      method: 'POST',
      body: JSON.stringify({ memberId: row.member.id, status: next }),
    }).catch(() => load());
  }

  const present = event?.attendances.filter((a) => a.status === 'PRESENT').length ?? 0;
  // vedenie spravuje všetko; tréner len udalosti svojich družstiev
  const canEdit =
    isStaff(me) || (!!event?.team && coachTeams(me).some((t) => t.id === event.team!.id));

  return (
    <div className="space-y-5">
      <Link href="/portal/udalosti" className="text-sm text-club-600 hover:underline">
        ← Kalendár
      </Link>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {event && (
        <>
          <div>
            <h1 className="text-2xl font-bold text-club-900">{event.title}</h1>
            <p className="text-sm text-gray-500">
              {event.team?.name} · {formatEventDateTimeSk(event.startAt)}
              {event.location ? ` · ${event.location}` : ''}
              {event.surface ? ` · ${SURFACE_LABELS_SK[event.surface]}` : ''} · Prítomní: {present}/
              {event.attendances.length}
            </p>
            {event.address && (
              <div className="mt-1 text-sm text-gray-600">
                <AddressLink address={event.address} />
                <MapEmbed address={event.address} />
              </div>
            )}
            {canEdit && event.team && (
              <div className="mt-3">
                <Link
                  href={`/portal/prehlady/previerky/nova?team=${event.team.id}`}
                  className="inline-block rounded-md border border-club-300 px-3 py-1.5 text-sm font-semibold text-club-700 hover:bg-club-50"
                >
                  ⏱️ Vytvoriť testovanie
                </Link>
              </div>
            )}
            {canEdit && (
              <div className="mt-3 flex gap-2">
                <EventAdminActions
                  eventId={event.id}
                  startAt={event.startAt}
                  endAt={event.endAt}
                  kind="training"
                  title={event.title}
                  location={event.location}
                  address={event.address}
                  surface={event.surface}
                  recurrenceGroupId={event.recurrenceGroupId}
                  onChanged={load}
                />
              </div>
            )}
          </div>
          <Card className="p-0">
            <ul className="divide-y divide-club-100">
              {event.attendances.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="font-medium">
                    {row.member.lastName} {row.member.firstName}
                  </span>
                  <div className="flex gap-1">
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        onClick={() => setStatus(row, s)}
                        className={`rounded px-2 py-1 text-xs font-medium ${
                          row.status === s ? colors[s] : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {labels[s]}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
              {event.attendances.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-gray-500">
                  Žiadni hráči — družstvo zatiaľ nemá priradených členov.
                </li>
              )}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
