'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, getToken, setToken } from '@/lib/api';
import { canManage, isStaff, useMe } from '@/lib/auth';

const PUBLIC_SITE_URL = 'https://fkknv.sk';

type Ctx = { staff: boolean; manage: boolean };
interface Leaf {
  href: string;
  label: string;
  show: (ctx: Ctx) => boolean;
}
type Entry = ({ kind: 'leaf' } & Leaf) | { kind: 'group'; label: string; children: Leaf[] };

// Poradie a zoskupenie hlavného menu.
const navigation: Entry[] = [
  { kind: 'leaf', href: '/portal', label: 'Prehľad', show: () => true },
  {
    kind: 'group',
    label: 'Klub',
    children: [
      { href: '/portal/clenovia', label: 'Členovia', show: ({ manage }) => manage },
      { href: '/portal/presuny', label: 'Presuny', show: ({ manage }) => manage },
      { href: '/portal/registracie', label: 'Registrácie', show: ({ staff }) => staff },
      { href: '/portal/clanky', label: 'Články', show: ({ staff }) => staff },
      { href: '/portal/obsah', label: 'Obsah webu', show: ({ staff }) => staff },
      { href: '/portal/platby', label: 'Platby', show: ({ staff }) => staff },
      { href: '/portal/moje-platby', label: 'Moje platby', show: ({ staff, manage }) => !staff && !manage },
      { href: '/portal/prispevok', label: 'Príspevok', show: () => true },
      { href: '/portal/nastavenia', label: 'Nastavenia', show: ({ staff }) => staff },
    ],
  },
  { kind: 'leaf', href: '/portal/udalosti', label: 'Kalendár', show: () => true },
  { kind: 'leaf', href: '/portal/tabulka', label: 'Tabuľka', show: () => true },
  { kind: 'leaf', href: '/portal/prehlady', label: 'Štatistiky', show: ({ manage }) => manage },
  { kind: 'leaf', href: '/portal/ulohy', label: 'Úlohy', show: ({ manage }) => manage },
  { kind: 'leaf', href: '/portal/chat', label: 'Komunikácia', show: () => true },
  { kind: 'leaf', href: '/portal/pomoc', label: 'Pomoc', show: () => true },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { me } = useMe();
  const [pendingRegs, setPendingRegs] = useState(0);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) router.replace('/prihlasenie');
  }, [router]);

  const staff = isStaff(me);
  // počet nevybavených registrácií — na zvýraznenie
  useEffect(() => {
    if (!staff) return;
    api<Array<{ id: string }>>('/registration/pending')
      .then((r) => setPendingRegs(r.length))
      .catch(() => {});
  }, [staff, pathname]);

  // zavri rozbalené menu pri prechode na inú stránku
  useEffect(() => {
    setOpenGroup(null);
  }, [pathname]);

  const ctx: Ctx = { staff, manage: canManage(me) };
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const flatCls = (active: boolean) =>
    active ? 'border-b-[3px] border-club-500 py-1 font-bold text-white' : 'py-1 text-club-200 hover:text-[var(--lime)]';

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="relative border-b border-club-100 bg-club-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <a href={PUBLIC_SITE_URL} className="flex items-center gap-2 font-semibold" title="Verejný web klubu">
              <Image src="/logo.png" alt="FKKNV" width={24} height={38} className="h-8 w-auto" />
              FKKNV portál
            </a>
            <nav className="flex flex-wrap items-center gap-4 text-sm">
              {navigation.map((entry) => {
                if (entry.kind === 'leaf') {
                  if (!entry.show(ctx)) return null;
                  return (
                    <Link key={entry.href} href={entry.href} className={flatCls(isActive(entry.href))}>
                      {entry.label}
                    </Link>
                  );
                }

                // group (dropdown)
                const children = entry.children.filter((c) => c.show(ctx));
                if (children.length === 0) return null;
                const groupActive = children.some((c) => isActive(c.href));
                const groupBadge = children.some((c) => c.href === '/portal/registracie') && pendingRegs > 0 ? pendingRegs : 0;
                const open = openGroup === entry.label;
                return (
                  <div key={entry.label} className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenGroup(open ? null : entry.label)}
                      className={`inline-flex items-center gap-1 ${
                        groupActive || open ? 'font-semibold text-white' : 'text-club-200 hover:text-white'
                      }`}
                    >
                      {entry.label}
                      {groupBadge > 0 && (
                        <span className="inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-brandred-500 px-1 text-xs font-bold text-white">
                          {groupBadge}
                        </span>
                      )}
                      <span className="text-[0.6rem]">▾</span>
                    </button>
                    {open && (
                      <div className="absolute left-0 top-full z-40 mt-2 min-w-[12rem] overflow-hidden border border-[#435461] bg-white py-1 text-club-800 shadow-2xl">
                        {children.map((c) => {
                          const showBadge = c.href === '/portal/registracie' && pendingRegs > 0;
                          return (
                            <Link
                              key={c.href}
                              href={c.href}
                              className={`flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-club-50 ${
                                isActive(c.href) ? 'bg-club-50 font-semibold text-club-900' : ''
                              }`}
                            >
                              {c.label}
                              {showBadge && (
                                <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-brandred-500 px-1 text-xs font-bold text-white">
                                  {pendingRegs}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {me && (
              <Link href="/portal/heslo" className="text-club-100 hover:text-white" title="Zmena hesla">
                {me.firstName} {me.lastName}
              </Link>
            )}
            <button
              onClick={() => {
                setToken(null);
                window.location.href = PUBLIC_SITE_URL;
              }}
              className="border border-[#63707a] px-3 py-1 text-club-100 hover:bg-white/10"
            >
              Odhlásiť
            </button>
          </div>
        </div>
        {/* podklad na zatvorenie rozbaleného menu klikom mimo */}
        {openGroup && <button type="button" aria-hidden className="fixed inset-0 z-30 cursor-default" onClick={() => setOpenGroup(null)} />}
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
