'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

const input = 'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-club-500 focus:outline-none';
const label = 'block text-sm font-medium text-gray-700';
const hint = 'mt-1 text-xs text-gray-500';
const OPTIONAL_HINT = 'Ak ho nepoznáte alebo nemáte, nechajte prázdne.';

interface TeamOption {
  id: string;
  name: string;
  categoryName: string;
}

interface InfoResponse {
  valid: boolean;
  expired?: boolean;
  alreadyReceived?: boolean;
  parentName?: string | null;
  childFirstName?: string | null;
  childLastName?: string | null;
  childBirthDate?: string | null;
  registrationNumber?: string | null;
  motherClub?: string | null;
  guestClub?: string | null;
  clubAffiliation?: string | null;
  requestedTeamId?: string | null;
  teams?: TeamOption[];
}

/** Zmenší obrázok na max. 800 px (JPEG) a vráti data URL. */
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Fotku sa nepodarilo načítať.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Súbor nie je platný obrázok.'));
      img.onload = () => {
        const max = 800;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Fotku sa nepodarilo spracovať.'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-club-50 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-xl rounded-lg border border-club-100 bg-white p-5 shadow-sm sm:p-8">{children}</div>
    </main>
  );
}

export default function InfoRequestPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const [info, setInfo] = useState<InfoResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [motherClub, setMotherClub] = useState('');
  const [guestClub, setGuestClub] = useState('');
  const [clubAffiliation, setClubAffiliation] = useState('');
  const [teamId, setTeamId] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);

  const [captcha, setCaptcha] = useState<{ token: string; svg: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const reloadCaptcha = useCallback(() => {
    setCaptchaAnswer('');
    api<{ token: string; svg: string }>('/captcha')
      .then(setCaptcha)
      .catch(() => setCaptcha(null));
  }, []);

  useEffect(() => {
    if (!token) return;
    api<InfoResponse>(`/registration/info/${encodeURIComponent(token)}`)
      .then((r) => {
        setInfo(r);
        setFirstName(r.childFirstName ?? '');
        setLastName(r.childLastName ?? '');
        setBirthDate(r.childBirthDate ? r.childBirthDate.slice(0, 10) : '');
        setRegistrationNumber(r.registrationNumber ?? '');
        setMotherClub(r.motherClub ?? '');
        setGuestClub(r.guestClub ?? '');
        setClubAffiliation(r.clubAffiliation ?? '');
        setTeamId(r.requestedTeamId ?? '');
      })
      .catch(() => setLoadFailed(true));
    reloadCaptcha();
  }, [token, reloadCaptcha]);

  const groupedTeams = useMemo(() => {
    const map = new Map<string, TeamOption[]>();
    for (const t of info?.teams ?? []) {
      const list = map.get(t.categoryName) ?? [];
      list.push(t);
      map.set(t.categoryName, list);
    }
    return Array.from(map.entries());
  }, [info]);

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Vyberte súbor s obrázkom.');
      return;
    }
    try {
      setPhoto(await resizeImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotku sa nepodarilo spracovať.');
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      setError('Vyplňte meno a priezvisko hráča.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      setError('Zadajte platný dátum narodenia.');
      return;
    }
    setLoading(true);
    try {
      await api(`/registration/info/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthDate,
          registrationNumber: registrationNumber.trim() || undefined,
          motherClub: motherClub.trim() || undefined,
          guestClub: guestClub.trim() || undefined,
          clubAffiliation: clubAffiliation.trim() || undefined,
          teamId: teamId || undefined,
          photoBase64: photo || undefined,
          captcha: { token: captcha?.token, answer: captchaAnswer },
        }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Odoslanie zlyhalo');
      reloadCaptcha();
    } finally {
      setLoading(false);
    }
  }

  if (loadFailed || (info && (!info.valid || info.expired))) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-club-900">Doplnenie údajov o hráčovi</h1>
        <p className="mt-4 text-gray-700">
          Odkaz je neplatný alebo vypršal. Kontaktujte nás na{' '}
          <a href="mailto:info@fkknv.sk" className="text-club-600 underline">
            info@fkknv.sk
          </a>
          .
        </p>
      </Shell>
    );
  }

  if (!info) {
    return (
      <Shell>
        <p className="text-gray-500">Načítavam…</p>
      </Shell>
    );
  }

  if (done || info.alreadyReceived) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-club-800">{done ? 'Ďakujeme! ✓' : 'Údaje už boli prijaté ✓'}</h1>
        <p className="mt-3 text-gray-600">
          {done
            ? 'Údaje sme prijali. Klub ich skontroluje, dokončí registráciu hráča a aktivuje prístup do portálu. Ozveme sa vám e-mailom.'
            : 'Údaje o hráčovi sme od vás už prijali. Klub dokončí registráciu a ozve sa vám e-mailom.'}
        </p>
        <Link href="/" className="mt-6 inline-block text-club-600 hover:underline">
          ← Späť na úvod
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-bold text-club-900">Doplnenie údajov o hráčovi</h1>
      {info.parentName && <p className="mt-1 text-sm text-gray-500">Dobrý deň, {info.parentName}.</p>}
      <p className="mt-3 text-sm text-gray-600">
        Pri vašej registrácii sme nenašli platnú registráciu hráča v systéme ISSF. Na dokončenie registrácie a aktiváciu
        prístupu do portálu potrebujeme od vás údaje o hráčovi uvedené nižšie.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>1. Meno</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required minLength={2} className={input} />
          </div>
          <div>
            <label className={label}>2. Priezvisko</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} required minLength={2} className={input} />
          </div>
        </div>

        <div>
          <label className={label}>3. Dátum narodenia</label>
          <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required className={input} />
        </div>

        <div>
          <label className={label}>4. Registračné číslo hráča (nepovinné)</label>
          <input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} className={input} />
          <p className={hint}>{OPTIONAL_HINT}</p>
        </div>

        <div>
          <label className={label}>5. Materský klub (nepovinné)</label>
          <input value={motherClub} onChange={(e) => setMotherClub(e.target.value)} className={input} />
          <p className={hint}>{OPTIONAL_HINT}</p>
        </div>

        <div>
          <label className={label}>6. Hosťujúci klub (nepovinné)</label>
          <input value={guestClub} onChange={(e) => setGuestClub(e.target.value)} className={input} />
          <p className={hint}>{OPTIONAL_HINT}</p>
        </div>

        <div>
          <label className={label}>7. Klubová príslušnosť (nepovinné)</label>
          <input value={clubAffiliation} onChange={(e) => setClubAffiliation(e.target.value)} className={input} />
          <p className={hint}>{OPTIONAL_HINT}</p>
        </div>

        <div>
          <label className={label}>8. Skupina / družstvo</label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={input}>
            <option value="">— neviem / nevyberám —</option>
            {groupedTeams.map(([category, teams]) => (
              <optgroup key={category} label={category}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label className={label}>9. Fotografia hráča (nepovinné)</label>
          <div className="mt-1 flex items-center gap-3">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="Náhľad fotky" className="h-20 w-20 rounded-md object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-md bg-gray-100 text-xs text-gray-400">foto</div>
            )}
            <input type="file" accept="image/*" onChange={onPhotoChange} className="min-w-0 text-sm" />
          </div>
          <p className={hint}>Portrét, tvár spredu, svetlé pozadie, bez čiapky a okuliarov.</p>
        </div>

        <div>
          <label className={label}>Opíšte kód z obrázka</label>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span
              className="inline-flex h-12 w-[150px] items-center justify-center overflow-hidden rounded-md border border-gray-300 bg-slate-100"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: captcha?.svg ?? '' }}
            />
            <button
              type="button"
              onClick={reloadCaptcha}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              title="Nový kód"
            >
              ↻
            </button>
            <input
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              required
              autoComplete="off"
              className={`${input} min-w-[8rem] flex-1`}
              placeholder="Kód z obrázka"
              aria-label="Kód z obrázka"
            />
          </div>
          <p className={hint}>Ochrana proti automatickému spamu.</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || !captcha || !captchaAnswer}
          className="w-full rounded-md bg-club-600 px-4 py-3 font-semibold text-white hover:bg-club-700 disabled:opacity-50"
        >
          {loading ? 'Odosielam…' : 'Odoslať údaje'}
        </button>
      </form>
    </Shell>
  );
}
