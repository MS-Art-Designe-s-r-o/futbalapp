'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, setToken } from '@/lib/api';
import PortalGuide from '@/components/portal-guide';

const inputCls = 'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-club-500 focus:outline-none';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(result.accessToken);
      router.push('/portal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prihlásenie zlyhalo');
    } finally {
      setLoading(false);
    }
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setForgotSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodarilo sa odoslať');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-club-50 px-6 py-10">
      <div className="mx-auto grid max-w-6xl items-start gap-8 lg:grid-cols-[minmax(0,1fr)_28rem]">
      <div className="order-2 min-w-0 rounded-lg border border-club-100 bg-white p-6 shadow-sm lg:order-1 lg:p-8">
        <PortalGuide />
      </div>
      <div className="order-1 w-full rounded-lg border border-club-100 bg-white p-8 shadow-sm lg:sticky lg:top-6 lg:order-2">
        <Link href="/" className="text-sm text-club-600 hover:underline">
          ← fkknv.sk
        </Link>

        {mode === 'login' ? (
          <>
            <h1 className="mt-4 text-2xl font-bold text-club-900">Prihlásenie do portálu</h1>
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">E-mail</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Heslo</label>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full rounded-md bg-club-600 px-4 py-2 font-semibold text-white hover:bg-club-700 disabled:opacity-50"
              >
                {loading ? 'Prihlasujem…' : 'Prihlásiť sa'}
              </button>
            </form>
            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                setError(null);
              }}
              className="mt-4 text-sm text-club-600 hover:underline"
            >
              Zabudli ste heslo?
            </button>
            <p className="mt-6 border-t border-club-100 pt-4 text-xs text-gray-500">
              Nedostali ste prihlasovacie údaje alebo potrebujete pomoc?{' '}
              <Link href="/podpora" className="text-club-600 hover:underline">
                Podpora
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-2xl font-bold text-club-900">Obnovenie hesla</h1>
            {forgotSent ? (
              <div className="mt-6 space-y-4">
                <p className="text-sm text-gray-600">
                  Ak je e-mail <strong>{email}</strong> v systéme, poslali sme naň odkaz na nastavenie nového hesla.
                  Skontrolujte aj priečinok spam. Odkaz je platný 1 hodinu.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setForgotSent(false);
                  }}
                  className="text-sm text-club-600 hover:underline"
                >
                  ← Späť na prihlásenie
                </button>
              </div>
            ) : (
              <form onSubmit={onForgot} className="mt-6 space-y-4">
                <p className="text-sm text-gray-600">Zadajte e-mail, ktorým sa prihlasujete. Pošleme naň odkaz na obnovenie hesla.</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700">E-mail</label>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full rounded-md bg-club-600 px-4 py-2 font-semibold text-white hover:bg-club-700 disabled:opacity-50"
                >
                  {loading ? 'Odosielam…' : 'Poslať odkaz'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className="text-sm text-club-600 hover:underline"
                >
                  ← Späť na prihlásenie
                </button>
              </form>
            )}
          </>
        )}
      </div>
      </div>
    </main>
  );
}
