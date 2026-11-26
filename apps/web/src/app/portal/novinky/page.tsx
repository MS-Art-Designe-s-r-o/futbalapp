'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiUploadWithProgress, API_URL, type UploadHandle } from '@/lib/api';
import { isAdmin, useMe } from '@/lib/auth';
import { Button, Card, ErrorText, inputCls, labelCls } from '@/components/ui';

interface NewsItem {
  id: string;
  title: string;
  body: string | null;
  videoUrl: string | null;
  hasVideo: boolean;
  videoMimeType: string | null;
  videoSize: number | null;
  createdAt: string;
  publishedAt: string | null;
  seen: boolean;
  viewsCount?: number;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('sk-SK');
const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);

/** Novinky pre členov: všetci vidia zverejnené (video + text), admin ich vytvára v hornej časti stránky. */
export default function NewsPage() {
  const { me } = useMe();
  const admin = isAdmin(me);
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [totalUsers, setTotalUsers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // „Nové“ zostane viditeľné počas tohto otvorenia stránky, aj keď sa už označí ako videné
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await api<{ totalUsers: number; items: NewsItem[] }>('/app-news');
      setItems(res.items);
      setTotalUsers(res.totalUsers);
      setNewIds((prev) => new Set([...prev, ...res.items.filter((n) => n.publishedAt && !n.seen).map((n) => n.id)]));
      // otvorenie Noviniek = všetko videné → zruší sa značka v menu
      if (res.items.some((n) => n.publishedAt && !n.seen)) {
        await api('/app-news/seen', { method: 'POST' }).catch(() => undefined);
        window.dispatchEvent(new Event('fkknv:news-seen'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // --- tvorba novinky (admin) ---
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<'file' | 'link'>('file');
  const [link, setLink] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [notify, setNotify] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<UploadHandle<unknown> | null>(null);

  async function publish() {
    setError(null);
    if (!title.trim()) {
      setError('Zadajte názov novinky');
      return;
    }
    setBusy(true);
    try {
      const created = await api<{ id: string }>('/app-news', {
        method: 'POST',
        body: JSON.stringify({ title, body, videoUrl: mode === 'link' ? link : undefined }),
      });
      if (mode === 'file' && file) {
        setProgress(0);
        handleRef.current = apiUploadWithProgress<unknown>(`/app-news/${created.id}/video`, file, (f) => setProgress(f));
        await handleRef.current.promise;
      }
      await api(`/app-news/${created.id}/publish`, { method: 'POST', body: JSON.stringify({ notify }) });
      setTitle('');
      setBody('');
      setLink('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
      await load(); // nezverejnený koncept ostane v zozname (dá sa zverejniť/zmazať)
    } finally {
      setBusy(false);
      setProgress(null);
      handleRef.current = null;
    }
  }

  async function publishDraft(id: string) {
    await api(`/app-news/${id}/publish`, { method: 'POST', body: JSON.stringify({ notify }) }).catch((e) => setError(e instanceof Error ? e.message : 'Zlyhalo'));
    await load();
  }
  async function remove(id: string) {
    if (!window.confirm('Naozaj zmazať túto novinku aj s videom?')) return;
    await api(`/app-news/${id}`, { method: 'DELETE' }).catch((e) => setError(e instanceof Error ? e.message : 'Zmazanie zlyhalo'));
    await load();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-club-900">Novinky</h1>
        <p className="text-sm text-gray-500">Čo je nové v portáli a aplikáciách FK KNV.</p>
      </div>

      {admin && (
        <Card className="space-y-3">
          <h2 className="font-semibold text-club-800">Nová novinka (len admin)</h2>
          <div>
            <label className={labelCls}>Názov</label>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Napr. Nová funkcia: fotky a videá z tréningov" />
          </div>
          <div>
            <label className={labelCls}>Krátky popis</label>
            <textarea className={inputCls} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Video</label>
            <div className="mb-2 flex gap-2">
              {(
                [
                  ['file', 'Nahrať video'],
                  ['link', 'Vložiť odkaz (YouTube / Veo)'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMode(k)}
                  className={`rounded-md px-3 py-1.5 text-sm ${mode === k ? 'bg-club-600 text-white' : 'bg-club-50 text-club-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === 'file' ? (
              <div className="rounded-md border-2 border-dashed border-[#435461] p-4 text-center text-sm text-gray-500">
                <input ref={fileRef} type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {file && <p className="mt-1">{file.name} · {fmtSize(file.size)}</p>}
              </div>
            ) : (
              <input className={inputCls} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
            )}
            {progress !== null && (
              <div className="mt-2 h-2 overflow-hidden rounded bg-club-100">
                <div className="h-full bg-club-600" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            🔔 Poslať push notifikáciu všetkým členom
          </label>
          <Button onClick={publish} disabled={busy}>
            {busy ? (progress !== null ? `Nahrávam… ${Math.round(progress * 100)} %` : 'Ukladám…') : 'Zverejniť'}
          </Button>
        </Card>
      )}

      <ErrorText>{error}</ErrorText>
      {!items && !error && <Card className="text-sm text-gray-500">Načítavam…</Card>}
      {items && items.length === 0 && <Card className="text-sm text-gray-500">Zatiaľ nie sú žiadne novinky.</Card>}

      {(items ?? []).map((n) => (
        <Card key={n.id} className="space-y-3 p-0">
          {n.hasVideo && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video controls preload="metadata" className="max-h-[420px] w-full bg-black" src={`${API_URL}/app-news/videos/${n.id}#t=0.1`} />
          )}
          <div className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              {newIds.has(n.id) && <span className="rounded bg-[var(--lime)] px-1.5 py-0.5 font-extrabold text-[#0d1718]">NOVÉ</span>}
              {!n.publishedAt && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">KONCEPT</span>}
              <span>{fmtDate(n.publishedAt ?? n.createdAt)}</span>
              {admin && n.publishedAt && (
                <span>
                  · videlo {n.viewsCount ?? 0} z {totalUsers} používateľov
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-club-900">{n.title}</h2>
            {n.body && <p className="whitespace-pre-line text-sm text-gray-600">{n.body}</p>}
            {n.videoUrl && (
              <a href={n.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-block rounded bg-[var(--lime)] px-3 py-1.5 text-sm font-bold text-[#0d1718] hover:brightness-110">
                ▶ Pozrieť video
              </a>
            )}
            {admin && (
              <div className="flex gap-2 pt-1">
                {!n.publishedAt && (
                  <Button variant="ghost" onClick={() => publishDraft(n.id)}>
                    Zverejniť koncept
                  </Button>
                )}
                <Button variant="ghost" onClick={() => remove(n.id)}>
                  Zmazať
                </Button>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
