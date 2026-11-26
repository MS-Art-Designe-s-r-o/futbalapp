'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatEventDateTimeSk, formatEventTimeSk } from '@fkknv/shared';
import { api } from '@/lib/api';
import { canManage, coachTeams, isStaff, useMe } from '@/lib/auth';
import { Button, Card, ErrorText } from '@/components/ui';
import { AddressLink } from '@/components/AddressLink';
import { MapEmbed } from '@/components/MapEmbed';
import { ParentMeetingIcon } from '@/components/training-icon';
import { ParentMeetingModal, type MeetingEvent } from '@/components/parent-meeting-modal';

export default function ParentMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const router = useRouter();
  const [ev, setEv] = useState<MeetingEvent | null>(null);
  const [teams, setTeams] = useState<Array<{ id: string; name: string; isGoalkeeperGroup?: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    api<MeetingEvent>(`/events/${id}`)
      .then(setEv)
      .catch((e) => setError(e instanceof Error ? e.message : 'Načítanie zlyhalo'));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (canManage(me)) api<typeof teams>('/seasons/teams?withGk=1').then(setTeams).catch(() => {});
  }, [me]);

  const aud = ev?.audienceTeams ?? [];
  const mine = new Set(coachTeams(me).map((t) => t.id));
  const canEdit = !!ev && canManage(me) && (isStaff(me) || (aud.length > 0 && aud.every((t) => mine.has(t.id))));
  const available = isStaff(me) ? teams : teams.filter((t) => mine.has(t.id));
  const regular = available.filter((t) => !t.isGoalkeeperGroup);

  return (
    <div className="space-y-4">
      <Link href="/portal/udalosti" className="text-sm text-club-700 hover:underline">
        ← Kalendár
      </Link>
      <ErrorText>{error}</ErrorText>
      {ev && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="flex items-center gap-2 text-xl font-bold text-club-900">
              <ParentMeetingIcon size={20} /> {ev.title}
            </h1>
            {canEdit && (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditOpen(true)}>
                  Upraviť
                </Button>
                <Button variant="danger" onClick={() => setEditOpen(true)}>
                  Odstrániť
                </Button>
              </div>
            )}
          </div>
          <div className="text-sm text-gray-700">
            {formatEventDateTimeSk(ev.startAt)}
            {ev.endAt ? `–${formatEventTimeSk(ev.endAt)}` : ''}
          </div>
          <div className="text-sm text-club-700">Pre: {aud.length ? aud.map((t) => t.name).join(', ') : 'celý klub'}</div>
          {ev.location && <div className="text-sm text-gray-700">Miesto: {ev.location}</div>}
          {ev.address && (
            <>
              <AddressLink address={ev.address} />
              <MapEmbed address={ev.address} defaultOpen />
            </>
          )}
        </Card>
      )}
      <ParentMeetingModal
        open={editOpen}
        event={ev}
        onClose={() => setEditOpen(false)}
        teams={regular}
        canWholeClub={isStaff(me)}
        onDone={() => {
          setEditOpen(false);
          load();
        }}
        onDeleted={() => router.push('/portal/udalosti')}
      />
    </div>
  );
}
