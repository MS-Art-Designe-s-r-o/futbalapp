'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button, ErrorText, Modal, inputCls, labelCls } from '@/components/ui';
import { AddressField } from '@/components/pitch-picker';

export interface MeetingEvent {
  id: string;
  title: string;
  startAt: string;
  endAt?: string | null;
  location: string | null;
  address: string | null;
  audienceTeams?: Array<{ id: string; name: string }>;
}

/** Rodičovské združenie: pre vybrané družstvá alebo celý klub (vytvorenie, úprava aj odstránenie). */
export function ParentMeetingModal({
  open,
  onClose,
  teams,
  canWholeClub,
  onDone,
  onDeleted,
  event,
  initialDate,
}: {
  open: boolean;
  onClose: () => void;
  teams: Array<{ id: string; name: string }>;
  canWholeClub: boolean;
  onDone: () => void;
  /** voliteľne: po odstránení (inak sa volá onDone) */
  onDeleted?: () => void;
  event?: MeetingEvent | null;
  initialDate?: string;
}) {
  const [title, setTitle] = useState('Rodičovské združenie');
  const [wholeClub, setWholeClub] = useState(false);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('17:00');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p2 = (n: number) => String(n).padStart(2, '0');

  // naplnenie formulára pri otvorení (úprava = hodnoty udalosti, nové = predvolené)
  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmDelete(false);
    if (event) {
      const d = new Date(event.startAt);
      setTitle(event.title);
      setDate(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`);
      setTime(`${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`);
      setLocation(event.location ?? '');
      setAddress(event.address ?? '');
      const aud = event.audienceTeams ?? [];
      setWholeClub(aud.length === 0);
      setTeamIds(aud.map((t) => t.id));
    } else {
      setTitle('Rodičovské združenie');
      setDate(initialDate ?? '');
      setTime('17:00');
      setLocation('');
      setAddress('');
      setWholeClub(false);
      setTeamIds([]);
    }
  }, [open, event, initialDate]);

  // tréner nemôže robiť celoklubové združenie
  useEffect(() => {
    if (!canWholeClub && wholeClub) setWholeClub(false);
  }, [canWholeClub, wholeClub]);

  function toggleTeam(id: string) {
    setTeamIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        title,
        startAt: `${date}T${time}:00.000Z`,
        location: location || undefined,
        address: event ? address.trim() || null : address.trim() || undefined,
        audienceTeamIds: wholeClub ? [] : teamIds,
      };
      if (event) {
        await api(`/events/${event.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/events', { method: 'POST', body: JSON.stringify({ type: 'PARENT_MEETING', ...body }) });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!event) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/events/${event.id}?scope=one`, { method: 'DELETE' });
      (onDeleted ?? onDone)();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Odstránenie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  const valid = !!date && (wholeClub || teamIds.length > 0);

  return (
    <Modal open={open} onClose={onClose} title={event ? 'Upraviť rodičovské združenie' : 'Nové rodičovské združenie'}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Názov</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>Pre koho</label>
          {canWholeClub && (
            <label className="mb-2 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={wholeClub} onChange={(e) => setWholeClub(e.target.checked)} />
              Celý klub (všetky družstvá)
            </label>
          )}
          {!wholeClub && (
            <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-gray-200 p-2">
              {teams.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                  {t.name}
                </label>
              ))}
              {teams.length === 0 && <p className="text-sm text-gray-400">Žiadne družstvá.</p>}
            </div>
          )}
          <p className="mt-1 text-xs text-gray-500">Vyberte jedno či viac družstiev, alebo celý klub.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Dátum</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Čas</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Miesto</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} list="venue-list" placeholder="Klubovňa / ihrisko KNV" />
        </div>
        <AddressField value={address} onChange={setAddress} />

        <ErrorText>{error}</ErrorText>
        {confirmDelete && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Natrvalo odstrániť toto rodičovské združenie? Túto akciu nie je možné vrátiť.
            <div className="mt-2 flex gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Späť
              </Button>
              <Button variant="danger" onClick={remove} disabled={busy}>
                {busy ? 'Odstraňujem…' : 'Odstrániť natrvalo'}
              </Button>
            </div>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <div>
            {event && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                Odstrániť
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Zrušiť
            </Button>
            <Button onClick={submit} disabled={busy || !valid}>
              {busy ? 'Ukladám…' : event ? 'Uložiť' : 'Vytvoriť'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
