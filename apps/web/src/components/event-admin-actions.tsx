'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SURFACE_CODES, SURFACE_LABELS_SK, addMinutesToHhmm } from '@fkknv/shared';
import { api } from '@/lib/api';
import { Button, ErrorText, Modal, inputCls, labelCls } from '@/components/ui';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/**
 * Akcie pre admina/vedúceho nad udalosťou v kalendári:
 *  - Presunúť (na iný termín)
 *  - Zrušiť (len zápas) — stav CANCELLED, ostane v prehľade ako „Zrušený"
 *  - Odstrániť — natrvalo zmaže udalosť (kaskádovo aj zápas, nomináciu, dochádzku).
 * Pri opakovanom tréningu možno odstrániť len tento termín alebo aj všetky budúce.
 */
export function EventAdminActions({
  eventId,
  startAt,
  endAt,
  kind,
  title,
  location,
  address,
  surface,
  matchId,
  matchState,
  opponent,
  recurrenceGroupId,
  onChanged,
}: {
  eventId: string;
  startAt: string;
  endAt?: string | null;
  kind: 'match' | 'training' | 'tournament';
  title?: string;
  location?: string | null;
  address?: string | null;
  surface?: string | null;
  matchId?: string;
  matchState?: string;
  /** Súper (zadaj len ak sa dá meniť — priateľský/interný zápas). */
  opponent?: string;
  recurrenceGroupId?: string | null;
  onChanged: () => void;
}) {
  const router = useRouter();
  const d = new Date(startAt);
  const [date, setDate] = useState(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  const [time, setTime] = useState(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`);
  const e0 = endAt ? new Date(endAt) : null;
  const [endTime, setEndTime] = useState(e0 ? `${pad(e0.getUTCHours())}:${pad(e0.getUTCMinutes())}` : '');
  const [titleVal, setTitleVal] = useState(title ?? '');
  const [locationVal, setLocationVal] = useState(location ?? '');
  const [addressVal, setAddressVal] = useState(address ?? '');
  const [surfaceVal, setSurfaceVal] = useState(surface ?? '');
  const [opponentVal, setOpponentVal] = useState(opponent ?? '');
  const [clubs, setClubs] = useState<Array<{ id: string; name: string }>>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [venues, setVenues] = useState<string[]>([]);

  useEffect(() => {
    if (moveOpen && venues.length === 0) {
      api<string[]>('/events/locations').then(setVenues).catch(() => {});
    }
    if (moveOpen && opponent !== undefined && clubs.length === 0) {
      api<Array<{ id: string; name: string }>>('/clubs').then(setClubs).catch(() => {});
    }
  }, [moveOpen, venues.length, opponent, clubs.length]);

  const label = kind === 'match' ? 'zápas' : kind === 'tournament' ? 'turnaj' : 'tréning';
  const canReschedule = kind !== 'match' || matchState === 'PLANNED';
  const canCancel = kind === 'match' && matchState === 'PLANNED';

  const endInvalid = !!time && !!endTime && endTime <= time;

  async function save() {
    if (endInvalid) return setError('Koniec musí byť po začiatku');
    setBusy(true);
    setError(null);
    try {
      const startMs = Date.parse(`${date}T${time}:00Z`);
      const body: Record<string, unknown> = {
        startAt: new Date(startMs).toISOString(),
        location: locationVal || undefined,
        surface: surfaceVal || undefined,
        address: addressVal.trim() || null,
      };
      let newTitle = titleVal.trim();
      const oppNew = opponentVal.trim();
      if (opponent !== undefined && oppNew && oppNew !== opponent) {
        body.opponent = oppNew;
        // názov „X vs Súper" sa prepíše na nového súpera
        if (newTitle && opponent && newTitle.includes(opponent)) newTitle = newTitle.replace(opponent, oppNew);
      }
      if (newTitle) body.title = newTitle;
      if (endTime) {
        body.endAt = new Date(Date.parse(`${date}T${endTime}:00Z`)).toISOString();
      } else if (endAt) {
        const dur = Date.parse(endAt) - Date.parse(startAt);
        if (dur > 0) body.endAt = new Date(startMs + dur).toISOString();
      }
      await api(`/events/${eventId}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMoveOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Úprava zlyhala');
    } finally {
      setBusy(false);
    }
  }

  async function cancelMatch() {
    setBusy(true);
    setError(null);
    try {
      await api(`/matches/${matchId}/state`, { method: 'POST', body: JSON.stringify({ state: 'CANCELLED' }) });
      setCancelOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Zrušenie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  async function deleteEvent(scope: 'one' | 'future') {
    setBusy(true);
    setError(null);
    try {
      await api(`/events/${eventId}?scope=${scope}`, { method: 'DELETE' });
      router.push('/portal/udalosti');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Odstránenie zlyhalo');
      setBusy(false);
    }
  }

  return (
    <>
      {canReschedule && (
        <Button variant="ghost" onClick={() => setMoveOpen(true)}>
          Upraviť
        </Button>
      )}
      {canCancel && (
        <Button variant="ghost" onClick={() => setCancelOpen(true)}>
          Zrušiť
        </Button>
      )}
      <Button variant="danger" onClick={() => setDeleteOpen(true)}>
        Odstrániť
      </Button>

      {/* Upraviť (termín, miesto, povrch, názov) */}
      <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title={`Upraviť ${label}`}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Dátum</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Začiatok</label>
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  const v = e.target.value;
                  // posun konca spolu so začiatkom (zachová dĺžku) alebo predvolená dĺžka
                  if (v) {
                    const [h, m] = v.split(':').map(Number);
                    const dur = endAt ? Math.max(1, Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60000)) : 90;
                    setEndTime(addMinutesToHhmm(`${pad(h)}:${pad(m)}`, dur));
                  }
                  setTime(v);
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Koniec</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
            </div>
          </div>
          {title !== undefined && (
            <div>
              <label className={labelCls}>Názov</label>
              <input value={titleVal} onChange={(e) => setTitleVal(e.target.value)} className={inputCls} />
            </div>
          )}
          {opponent !== undefined && (
            <div>
              <label className={labelCls}>Súper</label>
              <input
                value={opponentVal}
                onChange={(e) => setOpponentVal(e.target.value)}
                className={inputCls}
                placeholder="Hľadať v registri klubov alebo napísať názov…"
              />
              {(() => {
                const q = opponentVal.trim().toLowerCase();
                const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
              const list = clubs.filter((c) => norm(c.name).includes(norm(q)) && c.name !== opponentVal);
                return list.length > 0 ? (
                  <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-gray-200 p-1">
                    {list.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setOpponentVal(c.name)}
                        className="block w-full rounded px-2 py-1 text-left text-sm text-gray-700 hover:bg-club-50"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                ) : null;
              })()}
            </div>
          )}
          <div>
            <label className={labelCls}>Miesto</label>
            <input value={locationVal} onChange={(e) => setLocationVal(e.target.value)} className={inputCls} list="venue-list-edit" />
            <datalist id="venue-list-edit">
              {venues.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={labelCls}>Adresa (pre mapu)</label>
            <input value={addressVal} onChange={(e) => setAddressVal(e.target.value)} maxLength={300} className={inputCls} placeholder="Agátová 1, 040 14 Košice" />
          </div>
          <div>
            <label className={labelCls}>Povrch</label>
            <select value={surfaceVal} onChange={(e) => setSurfaceVal(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {SURFACE_CODES.map((s) => (
                <option key={s} value={s}>
                  {s} — {SURFACE_LABELS_SK[s]}
                </option>
              ))}
            </select>
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMoveOpen(false)}>
              Späť
            </Button>
            <Button onClick={save} disabled={busy || !date || !time || endInvalid}>
              {busy ? 'Ukladám…' : 'Uložiť'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Zrušiť (len zápas) — CANCELLED, ostane v prehľade */}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Zrušiť zápas">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Zápas sa označí ako <strong>zrušený</strong> (napr. zväzom či klubom) a ostane v prehľade so stavom
            „Zrušený". Ak ide o chybný zápis, použite radšej <strong>Odstrániť</strong>.
          </p>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Späť
            </Button>
            <Button variant="danger" onClick={cancelMatch} disabled={busy}>
              {busy ? 'Rušim…' : 'Označiť ako zrušený'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Odstrániť natrvalo */}
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title={`Odstrániť ${label}`}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {kind === 'match'
              ? 'Natrvalo odstrániť tento zápas vrátane nominácie a zápisu? Túto akciu nie je možné vrátiť.'
              : kind === 'tournament'
                ? 'Natrvalo odstrániť tento turnaj vrátane všetkých jeho zápasov, nominácií a zápisov? Túto akciu nie je možné vrátiť.'
                : recurrenceGroupId
                ? 'Tento tréning je súčasťou opakovanej série. Odstrániť len tento termín, alebo aj všetky budúce? Vrátane dochádzky, nedá sa vrátiť.'
                : 'Natrvalo odstrániť tento tréning vrátane dochádzky? Túto akciu nie je možné vrátiť.'}
          </p>
          <ErrorText>{error}</ErrorText>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Späť
            </Button>
            {kind === 'training' && recurrenceGroupId ? (
              <>
                <Button variant="danger" onClick={() => deleteEvent('one')} disabled={busy}>
                  Len tento termín
                </Button>
                <Button variant="danger" onClick={() => deleteEvent('future')} disabled={busy}>
                  Tento aj budúce
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => deleteEvent('one')} disabled={busy}>
                {busy ? 'Odstraňujem…' : 'Odstrániť natrvalo'}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
