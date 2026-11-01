'use client';

import { SURFACE_CODES, SURFACE_LABELS_SK, type SurfaceCode } from '@fkknv/shared';
import { inputCls, labelCls } from '@/components/ui';

interface Pitch {
  id: string;
  name: string;
  surface: SurfaceCode;
}

/** Výber hracej plochy zo zoznamu z nastavení, alebo „Iné" = miesto a povrch textom. */
export function PitchPicker({
  pitches,
  pitchId,
  onPitch,
  location,
  onLocation,
  surface,
  onSurface,
  address,
  onAddress,
}: {
  pitches: Pitch[];
  pitchId: string;
  onPitch: (id: string) => void;
  location: string;
  onLocation: (v: string) => void;
  surface: string;
  onSurface: (v: string) => void;
  address: string;
  onAddress: (v: string) => void;
}) {
  const other = !pitchId;
  return (
    <>
      {pitches.length > 0 && (
        <div>
          <label className={labelCls}>Hracia plocha</label>
          <select value={pitchId} onChange={(e) => onPitch(e.target.value)} className={inputCls}>
            {pitches.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {SURFACE_LABELS_SK[p.surface]}
              </option>
            ))}
            <option value="">Iné (napísať)…</option>
          </select>
        </div>
      )}
      {other && (
        <>
          <div>
            <label className={labelCls}>Miesto</label>
            <input value={location} onChange={(e) => onLocation(e.target.value)} className={inputCls} placeholder="Ihrisko KNV" list="venue-list" />
          </div>
          <div>
            <label className={labelCls}>Povrch</label>
            <select value={surface} onChange={(e) => onSurface(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {SURFACE_CODES.map((s) => (
                <option key={s} value={s}>
                  {s} — {SURFACE_LABELS_SK[s]}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <AddressField value={address} onChange={onAddress} />
    </>
  );
}

export function AddressField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={labelCls}>Adresa (pre mapu)</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={300} className={inputCls} placeholder="Agátová 1, 040 14 Košice" />
    </div>
  );
}
