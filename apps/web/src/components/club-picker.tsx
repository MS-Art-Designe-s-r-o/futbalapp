'use client';

import { useState } from 'react';
import { inputCls, labelCls } from '@/components/ui';

export interface ClubOption {
  id: string;
  name: string;
  logoUrl?: string | null;
}

/** Výber zúčastnených mužstiev: register klubov (zaškrtávacie políčka + hľadanie) a pridanie nového. */
export function ClubPicker({
  clubs,
  selected,
  onChange,
}: {
  clubs: ClubOption[];
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const [newName, setNewName] = useState('');
  const lc = q.trim().toLowerCase();
  // register + vybrané (aj čerstvo pridané, ktoré v registri ešte nie sú)
  const all = [...clubs.map((c) => c.name), ...selected.filter((s) => !clubs.some((c) => c.name === s))];
  const shown = all.filter((n) => !lc || n.toLowerCase().includes(lc));

  function toggle(name: string) {
    onChange(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name]);
  }
  function addNew() {
    const n = newName.trim();
    if (!n) return;
    const existing = all.find((x) => x.toLowerCase() === n.toLowerCase());
    const name = existing ?? n;
    if (!selected.includes(name)) onChange([...selected, name]);
    setNewName('');
  }

  return (
    <div className="space-y-2">
      <label className={labelCls}>Zúčastnené mužstvá ({selected.length})</label>
      <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} placeholder="Hľadať v registri klubov…" />
      <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2">
        {shown.map((n) => (
          <label key={n} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={selected.includes(n)} onChange={() => toggle(n)} />
            {n}
          </label>
        ))}
        {shown.length === 0 && <p className="text-sm text-gray-400">Žiadne mužstvá.</p>}
      </div>
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addNew();
            }
          }}
          className={inputCls}
          placeholder="Pridať nové mužstvo"
        />
        <button type="button" onClick={addNew} className="mt-1 border border-[#63707a] px-3 text-sm font-bold text-club-900">
          Pridať
        </button>
      </div>
    </div>
  );
}
