'use client';

import { labelCls } from '@/components/ui';

export type JerseyColor = 'DARK' | 'LIGHT';

/** Ikonka dresu — tmavý (tmavomodrý) alebo svetlý (biely). */
export function JerseyIcon({ color, size = 18, title }: { color: JerseyColor; size?: number; title?: string }) {
  const fill = color === 'DARK' ? '#16223c' : '#ffffff';
  const stroke = color === 'DARK' ? '#16223c' : '#9ca3af';
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path
        d="M8.5 3 4 5.5 5.5 9l1.7-.8V20a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V8.2L18.5 9 20 5.5 15.5 3a3.5 3.5 0 0 1-7 0Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Výber dresov nášho mužstva: biely a/alebo modrý (oba = hráči prinesú oba). */
export function JerseyPicker({
  value,
  onChange,
  compact,
}: {
  value: JerseyColor[];
  onChange: (v: JerseyColor[]) => void;
  compact?: boolean;
}) {
  const opts = [
    { val: 'LIGHT', label: 'Biely' },
    { val: 'DARK', label: 'Modrý' },
  ] as const;
  const toggle = (c: JerseyColor) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  const status =
    value.length === 0
      ? 'Dres zatiaľ neurčený'
      : value.length === 2
        ? 'Hráči prinesú oba dresy (biely aj modrý)'
        : `Hráči prinesú: ${value[0] === 'LIGHT' ? 'biely' : 'modrý'} dres`;
  return (
    <div>
      <label className={compact ? 'block text-xs text-gray-500' : labelCls}>Dres</label>
      <div className={`flex gap-2 ${compact ? 'mt-1' : ''}`}>
        {opts.map((o) => {
          const on = value.includes(o.val);
          return (
            <button
              key={o.val}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(o.val)}
              className={`flex items-center gap-2 rounded-md border text-sm ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} ${
                on ? 'border-club-600 bg-club-50 font-medium text-club-900' : 'border-gray-300 text-gray-600'
              }`}
            >
              <JerseyIcon color={o.val} size={compact ? 16 : 18} />
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-gray-600">{status}</p>
      <p className="text-xs text-gray-400">Ak ešte neviete, vyberte oba.</p>
    </div>
  );
}

/** Malý štítok „Dresy: biely / modrý / biely aj modrý (prineste oba)". */
export function JerseyBadges({ colors, size = 14 }: { colors?: JerseyColor[] | null; size?: number }) {
  if (!colors || colors.length === 0) return null;
  const both = colors.length >= 2;
  const text = both ? 'biely aj modrý (prineste oba)' : colors[0] === 'LIGHT' ? 'biely' : 'modrý';
  const icons: JerseyColor[] = both ? ['LIGHT', 'DARK'] : [colors[0]];
  return (
    <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700">
      {icons.map((c) => (
        <JerseyIcon key={c} color={c} size={size} />
      ))}
      Dresy: {text}
    </span>
  );
}
