'use client';

import Link from 'next/link';

interface TileDef {
  href: string | null;
  emoji: string;
  title: string;
  desc: string;
}

const TILES: TileDef[] = [
  { href: '/portal/prehlady/dochadzka', emoji: '📋', title: 'Dochádzka', desc: 'Dochádzkový list družstva za mesiac.' },
  { href: '/portal/prehlady/previerky', emoji: '⏱️', title: 'Testovanie', desc: 'Výsledky testovania výkonnosti hráčov: behy, člnkový beh, skok z miesta.' },
  { href: null, emoji: '📊', title: 'Štatistiky hráča', desc: 'Pripravujeme.' },
  { href: null, emoji: '⚽', title: 'Zápasy', desc: 'Pripravujeme.' },
];

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-club-900">Štatistiky</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => {
          const inner = (
            <>
              <div className="text-3xl">{t.emoji}</div>
              <h2 className="mt-3 font-semibold text-club-800">{t.title}</h2>
              <p className="mt-1 text-sm text-gray-500">{t.desc}</p>
            </>
          );
          return t.href ? (
            <Link
              key={t.title}
              href={t.href}
              className="rounded-lg border border-club-100 bg-white p-6 shadow-sm transition hover:border-club-300 hover:shadow"
            >
              {inner}
            </Link>
          ) : (
            <div key={t.title} className="cursor-not-allowed rounded-lg border border-dashed border-club-100 bg-club-50/40 p-6 opacity-70">
              {inner}
              <span className="mt-2 inline-block rounded bg-club-100 px-2 py-0.5 text-xs text-club-600">čoskoro</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
