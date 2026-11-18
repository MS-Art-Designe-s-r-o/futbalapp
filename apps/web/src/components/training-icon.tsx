/** Ikony tréningov v kalendári: futbalový tréning = loptička + kužeľ, brankársky tréning = bránka. */
export function trainingLabel(isGoalkeeper: boolean): string {
  return isGoalkeeper ? 'Brankársky tréning' : 'Futbalový tréning';
}

export function TrainingIcon({ goalkeeper, size = 14 }: { goalkeeper: boolean; size?: number }) {
  const w = goalkeeper ? size : Math.round(size * 1.6);
  return (
    <svg
      viewBox={goalkeeper ? '0 0 20 16' : '0 0 32 20'}
      width={w}
      height={goalkeeper ? Math.round(size * 0.8) : Math.round(size * 1.6 * 0.625)}
      role="img"
      aria-label={trainingLabel(goalkeeper)}
      className="shrink-0"
    >
      <title>{trainingLabel(goalkeeper)}</title>
      {goalkeeper ? (
        <>
          {/* bránka: konštrukcia + sieť */}
          <path d="M2 15V3h16v12" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinejoin="round" />
          <path d="M6 3v12M10 3v12M14 3v12M2 7h16M2 11h16" stroke="#ffffff" strokeOpacity=".55" strokeWidth="1" />
        </>
      ) : (
        <>
          {/* loptička */}
          <circle cx="9" cy="10" r="8" fill="#ffffff" stroke="#16223c" strokeWidth="1.2" />
          <path d="M9 5.2l3.2 2.3-1.2 3.8H7L5.8 7.5z" fill="#16223c" />
          <path d="M9 5.2V2.4M12.2 7.5l2.6-.9M11 11.3l1.7 2.4M7 11.3l-1.7 2.4M5.8 7.5l-2.6-.9" stroke="#16223c" strokeWidth="1" />
          {/* kužeľ */}
          <path d="M26 3l5 15H21z" fill="#ff8a1f" />
          <path d="M24.2 9h3.6l.9 3h-5.4z" fill="#ffffff" />
          <rect x="19.5" y="17.5" width="13" height="2" rx="1" fill="#e06d00" />
        </>
      )}
    </svg>
  );
}
