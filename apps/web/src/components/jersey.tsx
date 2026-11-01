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

/** Výber dresu Tmavý / Svetlý / nezadané (opätovné kliknutie zruší výber). */
export function JerseyPicker({
  label,
  value,
  onChange,
  compact,
}: {
  label: string;
  value: JerseyColor | null | '';
  onChange: (v: JerseyColor | null) => void;
  compact?: boolean;
}) {
  return (
    <div>
      <label className={compact ? 'block text-xs text-gray-500' : labelCls}>{label}</label>
      <div className={`flex gap-2 ${compact ? 'mt-1' : ''}`}>
        {([
          { val: 'DARK', label: 'Tmavý' },
          { val: 'LIGHT', label: 'Svetlý' },
        ] as const).map((o) => (
          <button
            key={o.val}
            type="button"
            onClick={() => onChange(value === o.val ? null : o.val)}
            className={`flex items-center gap-2 rounded-md border text-sm ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} ${
              value === o.val ? 'border-club-600 bg-club-50 font-medium text-club-900' : 'border-gray-300 text-gray-600'
            }`}
          >
            <JerseyIcon color={o.val} size={compact ? 16 : 18} />
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Malé štítky „Náš dres" / „Dres súpera". */
export function JerseyBadges({
  ours,
  theirs,
  size = 14,
}: {
  ours?: JerseyColor | null;
  theirs?: JerseyColor | null;
  size?: number;
}) {
  if (!ours && !theirs) return null;
  const name = (c: JerseyColor) => (c === 'DARK' ? 'tmavý' : 'svetlý');
  return (
    <>
      {ours && (
        <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700">
          <JerseyIcon color={ours} size={size} />
          Náš dres: {name(ours)}
        </span>
      )}
      {theirs && (
        <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700">
          <JerseyIcon color={theirs} size={size} />
          Dres súpera: {name(theirs)}
        </span>
      )}
    </>
  );
}
