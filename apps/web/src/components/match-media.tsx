'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api, apiUploadWithProgress, API_URL, type UploadHandle } from '@/lib/api';

export interface MatchPhotoItem {
  id: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface MatchVideoItem {
  id: string;
  mimeType: string;
  size: number;
  filename: string | null;
  title: string | null;
  createdAt: string;
}

/** Limit fotky na serveri (POST /matches/:id/photos). */
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|3gp|3g2|mkv)$/i;

type Kind = 'photo' | 'video';

interface QueueItem {
  key: string;
  kind: Kind;
  name: string;
  size: number;
  preview: string | null;
  progress: number;
  status: 'waiting' | 'uploading' | 'done' | 'error';
  error?: string;
  file: File;
  handle?: UploadHandle<unknown>;
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function kindOf(file: File): Kind | null {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('video/') || VIDEO_EXT.test(file.name)) return 'video';
  return null;
}


/**
 * Médiá zo zápasu — výrazné nahrávanie fotiek a videí (galéria aj priamo fotoaparát
 * na mobile), fronta s náhľadom a priebehom, galéria fotiek a prehrávač videí.
 */
export function MatchMedia({
  matchId,
  manage,
  photos,
  videos,
  onChanged,
  basePath = '/matches',
  subject = 'zo zápasu',
}: {
  matchId: string;
  /** '/matches' (zápas) alebo '/events' (tréning) */
  basePath?: '/matches' | '/events';
  /** doplnok do nadpisov: „zo zápasu“ / „z tréningu“ */
  subject?: string;
  manage: boolean;
  photos: MatchPhotoItem[];
  videos: MatchVideoItem[];
  onChanged: () => Promise<void> | void;
}) {
  const photoUrl = (id: string) => `${API_URL}${basePath}/photos/${id}`;
  const videoUrl = (id: string) => `${API_URL}${basePath}/videos/${id}`;
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const running = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;

  // uvoľniť object URL náhľadov pri odchode zo stránky
  useEffect(
    () => () => {
      for (const q of queueRef.current) if (q.preview) URL.revokeObjectURL(q.preview);
    },
    [],
  );

  const patch = (key: string, p: Partial<QueueItem>) =>
    setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, ...p } : q)));

  async function runQueue() {
    if (running.current) return;
    running.current = true;
    let uploaded = 0;
    try {
      // postupne po jednom — šetrí mobilné pripojenie a server
      for (;;) {
        const next = queueRef.current.find((q) => q.status === 'waiting');
        if (!next) break;
        const path = next.kind === 'photo' ? `${basePath}/${matchId}/photos` : `${basePath}/${matchId}/videos`;
        const handle = apiUploadWithProgress<unknown>(path, next.file, (f) => patch(next.key, { progress: f }));
        patch(next.key, { status: 'uploading', handle });
        // queueRef sa aktualizuje až po renderi — označíme hneď, aby sa položka nezobrala znova
        next.status = 'uploading';
        try {
          await handle.promise;
          patch(next.key, { status: 'done', progress: 1, handle: undefined });
          uploaded++;
        } catch (e) {
          patch(next.key, {
            status: 'error',
            error: e instanceof Error ? e.message : 'Nahrávanie zlyhalo',
            handle: undefined,
          });
        }
      }
    } finally {
      running.current = false;
    }
    if (uploaded) {
      await onChanged();
      // hotové položky po chvíli zmiznú z fronty
      setTimeout(() => {
        setQueue((prev) => {
          for (const q of prev) if (q.status === 'done' && q.preview) URL.revokeObjectURL(q.preview);
          return prev.filter((q) => q.status !== 'done');
        });
      }, 2500);
    }
  }

  function addFiles(list: FileList | File[] | null, only?: Kind) {
    if (!list) return;
    setError(null);
    const items: QueueItem[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(list)) {
      const kind = kindOf(file);
      if (!kind || (only && kind !== only)) {
        rejected.push(`${file.name}: nepodporovaný typ súboru`);
        continue;
      }
      if (kind === 'photo' && file.size > MAX_PHOTO_BYTES) {
        rejected.push(`${file.name}: fotka je väčšia ako 15 MB`);
        continue;
      }
      items.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind,
        name: file.name,
        size: file.size,
        preview: kind === 'photo' ? URL.createObjectURL(file) : null,
        progress: 0,
        status: 'waiting',
        file,
      });
    }
    if (rejected.length) setError(rejected.join(' · '));
    if (!items.length) return;
    queueRef.current = [...queueRef.current, ...items];
    setQueue(queueRef.current);
    void runQueue();
  }

  function retry(key: string) {
    const item = queueRef.current.find((q) => q.key === key);
    if (!item) return;
    item.status = 'waiting';
    patch(key, { status: 'waiting', progress: 0, error: undefined });
    void runQueue();
  }

  function dismiss(key: string) {
    const item = queueRef.current.find((q) => q.key === key);
    if (item?.handle) item.handle.abort();
    if (item?.preview) URL.revokeObjectURL(item.preview);
    queueRef.current = queueRef.current.filter((q) => q.key !== key);
    setQueue(queueRef.current);
  }

  async function deletePhoto(photoId: string) {
    if (!window.confirm('Zmazať túto fotku?')) return;
    setError(null);
    try {
      await api(`${basePath}/${matchId}/photos/${photoId}`, { method: 'DELETE' });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Zmazanie fotky zlyhalo');
    }
  }

  async function deleteVideo(videoId: string) {
    if (!window.confirm('Zmazať toto video?')) return;
    setError(null);
    try {
      await api(`${basePath}/${matchId}/videos/${videoId}`, { method: 'DELETE' });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Zmazanie videa zlyhalo');
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  const busy = queue.some((q) => q.status === 'uploading' || q.status === 'waiting');

  const pickBtn =
    'flex min-h-[64px] cursor-pointer flex-col items-center justify-center gap-0.5 border border-[#435461] bg-[#0d161d] px-3 py-3 text-center text-sm font-bold uppercase tracking-wide text-club-900 transition hover:border-[#c8f567] hover:bg-[#15212a]';

  return (
    <div className="space-y-5">
      {manage && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`border-2 border-dashed p-4 transition ${
            dragOver ? 'border-[#c8f567] bg-[#15212a]' : 'border-[#435461]'
          }`}
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <span className="fk-kicker">Pridať médiá {subject}</span>
            <span className="hidden text-xs text-gray-500 sm:inline">alebo sem súbory pretiahnite myšou</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className={`${pickBtn} col-span-2 border-[#2874ed] bg-club-600 text-white hover:bg-[#408bff] sm:col-span-1`}>
              <span className="text-lg leading-none">+ Pridať fotky</span>
              <span className="text-[11px] font-medium normal-case tracking-normal text-white/80">z galérie, aj viac naraz</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files, 'photo');
                  e.target.value = '';
                }}
              />
            </label>
            <label className={pickBtn}>
              <span>📷 Odfotiť</span>
              <span className="text-[11px] font-medium normal-case tracking-normal text-gray-500">fotoaparát</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files, 'photo');
                  e.target.value = '';
                }}
              />
            </label>
            <label className={pickBtn}>
              <span>🎥 Natočiť video</span>
              <span className="text-[11px] font-medium normal-case tracking-normal text-gray-500">kamera telefónu</span>
              <input
                type="file"
                accept="video/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files, 'video');
                  e.target.value = '';
                }}
              />
            </label>
            <label className={pickBtn}>
              <span>+ Video z galérie</span>
              <span className="text-[11px] font-medium normal-case tracking-normal text-gray-500">mp4, mov, webm</span>
              <input
                type="file"
                accept="video/*,.mp4,.mov,.m4v,.webm,.3gp"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files, 'video');
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {queue.length > 0 && (
            <ul className="mt-3 space-y-2">
              {queue.map((q) => (
                <li key={q.key} className="flex items-center gap-3 border border-club-100 bg-[#0d161d] p-2">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden bg-[#17222b] text-xl">
                    {q.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={q.preview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span aria-hidden>🎬</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="truncate text-club-900">{q.name}</span>
                      <span className="shrink-0 text-gray-500">
                        {q.status === 'waiting' && 'čaká…'}
                        {q.status === 'uploading' && `${Math.round(q.progress * 100)} %`}
                        {q.status === 'done' && '✓ nahrané'}
                        {q.status === 'error' && 'chyba'}
                        {' · '}
                        {formatSize(q.size)}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden bg-[#17222b]">
                      <div
                        className={`h-full transition-[width] ${
                          q.status === 'error' ? 'bg-red-600' : q.status === 'done' ? 'bg-[#c8f567]' : 'bg-club-600'
                        }`}
                        style={{ width: `${Math.round((q.status === 'error' ? 1 : q.progress) * 100)}%` }}
                      />
                    </div>
                    {q.error && <p className="mt-1 text-xs text-red-600">{q.error}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2 text-xs">
                    {q.status === 'error' && (
                      <button onClick={() => retry(q.key)} className="text-club-700 hover:underline">
                        znova
                      </button>
                    )}
                    {q.status !== 'done' && (
                      <button
                        onClick={() => dismiss(q.key)}
                        className="text-gray-400 hover:text-white"
                        title={q.status === 'uploading' ? 'Zrušiť nahrávanie' : 'Odstrániť z fronty'}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {busy && (
            <p className="mt-2 text-xs text-gray-500">
              Nahrávam… nechajte stránku otvorenú. Veľké videá odporúčame nahrávať cez Wi-Fi.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Videá */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-gray-700">Videá ({videos.length})</h3>
        {videos.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {videos.map((v) => (
              <div key={v.id} className="border border-club-100 bg-[#0d161d]">
                <video
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-video w-full bg-black"
                  src={`${videoUrl(v.id)}#t=0.1`}
                >
                  <a href={videoUrl(v.id)}>Stiahnuť video</a>
                </video>
                <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                  <span className="truncate text-gray-500">
                    {v.title || v.filename || 'Video'} · {formatSize(v.size)}
                  </span>
                  <span className="flex shrink-0 gap-3">
                    <a href={videoUrl(v.id)} target="_blank" rel="noopener noreferrer" className="text-club-700 hover:underline">
                      otvoriť
                    </a>
                    {manage && (
                      <button onClick={() => deleteVideo(v.id)} className="text-red-600 hover:underline">
                        zmazať
                      </button>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Zatiaľ žiadne nahrané videá.</p>
        )}
      </div>

      {/* Fotky */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-gray-700">Fotky ({photos.length})</h3>
        {photos.length ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((p) => (
              <div key={p.id} className="group relative">
                <a href={photoUrl(p.id)} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrl(p.id)}
                    alt={`Fotka ${subject}`}
                    loading="lazy"
                    className="aspect-square w-full rounded-md object-cover"
                  />
                </a>
                {manage && (
                  <button
                    onClick={() => deletePhoto(p.id)}
                    className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white sm:hidden sm:group-hover:block"
                    title="Zmazať fotku"
                    aria-label="Zmazať fotku"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Zatiaľ žiadne fotky.</p>
        )}
      </div>
    </div>
  );
}
