'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatEventDateSk } from '@fkknv/shared';
import { api, API_URL } from '@/lib/api';
import { canManage, useMe } from '@/lib/auth';
import { Card, ErrorText, inputCls } from '@/components/ui';
import { VideoIcon } from '@/components/video-icon';

interface MediaMatch {
  id: string;
  opponent: string;
  isHome: boolean;
  isFriendly?: boolean;
  scoreUs: number | null;
  scoreThem: number | null;
  videoUrl: string | null;
  highlightsUrl: string | null;
  sportnetUrl: string | null;
  event: {
    title: string;
    startAt: string;
    team: { id: string; name: string } | null;
    parent?: { id: string; title: string } | null;
  };
  photos: Array<{ id: string }>;
  videos: Array<{ id: string; mimeType: string; title: string | null; filename: string | null; size: number }>;
}

const photoUrl = (id: string) => `${API_URL}/matches/photos/${id}`;
const videoFileUrl = (id: string) => `${API_URL}/matches/videos/${id}`;
const MONTHS = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];
const stripDia = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function monthKey(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function LinkBtn({ href, children, tone = 'club' }: { href: string; children: React.ReactNode; tone?: 'club' | 'lime' | 'gray' }) {
  const cls =
    tone === 'lime'
      ? 'bg-[var(--lime)] text-[#0d1718] hover:brightness-110'
      : tone === 'gray'
        ? 'border border-club-100 text-club-800 hover:bg-club-50'
        : 'bg-club-600 text-white hover:brightness-110';
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {children}
    </a>
  );
}

export default function VideoPage() {
  const { me, loading } = useMe();
  const [matches, setMatches] = useState<MediaMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teamId, setTeamId] = useState('');
  const [kind, setKind] = useState<'all' | 'video' | 'photo'>('all');
  const [q, setQ] = useState('');
  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number } | null>(null);

  useEffect(() => {
    api<MediaMatch[]>('/matches/played?media=true')
      .then(setMatches)
      .catch((e) => setError(e instanceof Error ? e.message : 'Načítanie zlyhalo'));
  }, []);

  const teams = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of matches ?? []) if (x.event.team) m.set(x.event.team.id, x.event.team.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'sk'));
  }, [matches]);

  const filtered = useMemo(() => {
    const needle = stripDia(q.trim());
    return (matches ?? []).filter((x) => {
      if (teamId && x.event.team?.id !== teamId) return false;
      const hasVideo = !!x.videoUrl || !!x.highlightsUrl || x.videos.length > 0;
      if (kind === 'video' && !hasVideo) return false;
      if (kind === 'photo' && x.photos.length === 0) return false;
      if (needle && !stripDia(`${x.opponent} ${x.event.title} ${x.event.team?.name ?? ''}`).includes(needle)) return false;
      return true;
    });
  }, [matches, teamId, kind, q]);

  // zoznam podľa dátumu: mesiace od najnovšieho, v nich zápasy od najnovšieho
  const groups = useMemo(() => {
    const g = new Map<string, MediaMatch[]>();
    for (const x of filtered) {
      const k = monthKey(x.event.startAt);
      g.set(k, [...(g.get(k) ?? []), x]);
    }
    return [...g.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  if (!loading && !canManage(me)) {
    return <Card className="text-sm text-gray-500">Táto stránka je len pre trénerov a vedenie klubu.</Card>;
  }

  const totals = {
    matches: filtered.length,
    videos: filtered.reduce((n, x) => n + (x.videoUrl ? 1 : 0) + (x.highlightsUrl ? 1 : 0) + x.videos.length, 0),
    photos: filtered.reduce((n, x) => n + x.photos.length, 0),
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-club-900">
          <VideoIcon size={26} /> Video a fotky zo zápasov
        </h1>
        <p className="text-sm text-gray-500">
          Všetky odkazy, videá a fotky zo zápasov na jednom mieste, od najnovších.
          {matches && ` · ${totals.matches} zápasov · ${totals.videos} videí/odkazov · ${totals.photos} fotiek`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
          <option value="">Všetky družstvá</option>
          {teams.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        {(
          [
            ['all', 'Všetko'],
            ['video', 'Len video'],
            ['photo', 'Len fotky'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-md px-3 py-1.5 text-sm ${kind === k ? 'bg-club-600 text-white' : 'bg-club-50 text-club-700'}`}
          >
            {label}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hľadať súpera alebo družstvo…" className={`${inputCls} ml-auto max-w-xs`} />
      </div>

      <ErrorText>{error}</ErrorText>
      {!matches && !error && <Card className="text-sm text-gray-500">Načítavam…</Card>}
      {matches && groups.length === 0 && <Card className="text-sm text-gray-500">Žiadne zápasy s videom alebo fotkami.</Card>}

      {groups.map(([key, list]) => (
        <section key={key} className="space-y-2">
          <h2 className="sticky top-0 z-[5] bg-[var(--bg)]/90 py-1 text-sm font-semibold uppercase tracking-wider text-club-700 backdrop-blur">
            {monthLabel(key)} <span className="font-normal text-gray-500">· {list.length}</span>
          </h2>
          {list.map((x) => {
            const photos = x.photos.map((p) => photoUrl(p.id));
            const score = x.scoreUs != null && x.scoreThem != null ? `${x.scoreUs}:${x.scoreThem}` : null;
            return (
              <Card key={x.id} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/portal/zapasy/${x.id}`} className="text-base font-semibold text-club-900 hover:underline">
                      {x.event.team ? `${x.event.team.name} · ` : ''}
                      {x.isHome ? 'vs.' : '@'} {x.opponent}
                      {score && <span className="ml-2 rounded bg-club-100 px-1.5 py-0.5 text-sm tabular-nums">{score}</span>}
                    </Link>
                    <p className="text-xs text-gray-500">
                      {formatEventDateSk(x.event.startAt)}
                      {x.isFriendly ? ' · priateľský' : ''}
                      {x.event.parent ? ` · ${x.event.parent.title}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {x.videoUrl && (
                      <LinkBtn href={x.videoUrl} tone="lime">
                        <VideoIcon size={13} /> Video zápasu
                      </LinkBtn>
                    )}
                    {x.highlightsUrl && (
                      <LinkBtn href={x.highlightsUrl} tone="lime">
                        ★ Highlighty
                      </LinkBtn>
                    )}
                    {x.sportnetUrl && <LinkBtn href={x.sportnetUrl} tone="gray">Sportnet</LinkBtn>}
                  </div>
                </div>

                {x.videos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {x.videos.map((v, i) => (
                      <LinkBtn key={v.id} href={videoFileUrl(v.id)}>
                        ▶ {v.title || v.filename || `Nahrané video ${i + 1}`}
                      </LinkBtn>
                    ))}
                  </div>
                )}

                {photos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {photos.slice(0, 8).map((u, i) => (
                      <button key={u} type="button" onClick={() => setLightbox({ photos, index: i })} className="relative h-16 w-24 overflow-hidden rounded border border-club-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
                        {i === 7 && photos.length > 8 && (
                          <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-bold text-white">+{photos.length - 8}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </section>
      ))}

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.photos[lightbox.index]} alt="" className="max-h-full max-w-full object-contain" />
          <button type="button" className="absolute left-4 top-1/2 -translate-y-1/2 text-4xl text-white" aria-label="Predchádzajúca"
            onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index + lightbox.photos.length - 1) % lightbox.photos.length }); }}>‹</button>
          <button type="button" className="absolute right-4 top-1/2 -translate-y-1/2 text-4xl text-white" aria-label="Nasledujúca"
            onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index + 1) % lightbox.photos.length }); }}>›</button>
          <button type="button" className="absolute right-4 top-4 text-2xl text-white" aria-label="Zavrieť" onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
