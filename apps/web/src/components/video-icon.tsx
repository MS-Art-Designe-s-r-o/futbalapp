/** Ikona videa (kamera) — rovnaká ako v hlavnom menu. */
export function VideoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="M15.5 10.5 21.5 7v10l-6-3.5z" />
    </svg>
  );
}

/** Ikona fotoaparátu (fotky). */
export function PhotoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.4-2h7.2L17 7h2.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

/** Značka v kalendári: tréning obsahuje video a/alebo fotky. */
export function MediaBadge({ photos = 0, videos = 0, size = 13 }: { photos?: number; videos?: number; size?: number }) {
  if (!photos && !videos) return null;
  const label = [videos ? `video (${videos})` : '', photos ? `fotky (${photos})` : ''].filter(Boolean).join(' a ');
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5" title={`Tréning obsahuje ${label}`} role="img" aria-label={`Tréning obsahuje ${label}`}>
      {videos > 0 && <VideoIcon size={size} />}
      {photos > 0 && <PhotoIcon size={size} />}
    </span>
  );
}
