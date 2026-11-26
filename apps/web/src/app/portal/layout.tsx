'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, getToken, setToken } from '@/lib/api';
import { canManage, isGkCoachOnly, isStaff, useMe } from '@/lib/auth';

const PUBLIC_SITE_URL = 'https://fkknv.sk';

type Ctx = { staff: boolean; manage: boolean; gkOnly?: boolean };
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
      { href: '/portal/presuny', label: 'Presuny', show: ({ manage, gkOnly }) => manage && !gkOnly },
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
  { kind: 'leaf', href: '/portal/prehlady', label: 'Štatistiky', show: ({ manage, gkOnly }) => manage && !gkOnly },
  { kind: 'leaf', href: '/portal/ulohy', label: 'Úlohy', show: ({ manage, gkOnly }) => manage && !gkOnly },
  { kind: 'leaf', href: '/portal/chat', label: 'Komunikácia', show: () => true },
  { kind: 'leaf', href: '/portal/novinky', label: 'Novinky', show: () => true },
  { kind: 'leaf', href: '/portal/pomoc', label: 'Pomoc', show: () => true },
  { kind: 'leaf', href: '/portal/video', label: 'Videá zo zápasov', show: ({ manage }) => manage },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { me } = useMe();
  const [pendingRegs, setPendingRegs] = useState(0);
  const [unreadChat, setUnreadChat] = useState({ channels: 0, messages: 0 });
  const [unseenNews, setUnseenNews] = useState(0);
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

  // neprečítaná komunikácia — ikonka pri „Komunikácia“ ešte pred otvorením (obnova pri zmene stránky,
  // každú minútu a hneď po prečítaní kanála)
  useEffect(() => {
    if (!me) return;
    let alive = true;
    const load = () =>
      api<{ channels: number; messages: number }>('/chat/unread')
        .then((u) => alive && setUnreadChat(u))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 60_000);
    window.addEventListener('fkknv:chat-read', load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('fkknv:chat-read', load);
    };
  }, [me, pathname]);

  // nové (nevidené) novinky — značka pri „Novinky“ v menu
  useEffect(() => {
    if (!me) return;
    let alive = true;
    const load = () =>
      api<{ count: number }>('/app-news/unseen-count')
        .then((u) => alive && setUnseenNews(u.count))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 120_000);
    const onSeen = () => alive && setUnseenNews(0);
    window.addEventListener('fkknv:news-seen', onSeen);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('fkknv:news-seen', onSeen);
    };
  }, [me, pathname]);

  // zavri rozbalené menu pri prechode na inú stránku
  useEffect(() => {
    setOpenGroup(null);
  }, [pathname]);

  const ctx: Ctx = { staff, manage: canManage(me), gkOnly: isGkCoachOnly(me) };
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const flatCls = (active: boolean) =>
    active ? 'border-b-[3px] border-club-500 py-1 font-bold text-white' : 'py-1 text-club-200 hover:text-[var(--lime)]';

  return (
    <div className="relative isolate min-h-screen bg-[var(--bg)]">
      {/* pozadie ako na webe fkknv.sk (štadión) — stlmené, aby zostal obsah čitateľný */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-top"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(8,14,19,.72) 0%, rgba(8,14,19,.86) 55%, rgba(8,14,19,.94) 100%), url('/verejne/hero-bg-v2.jpg')",
        }}
      />
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
                    <Link
                      key={entry.href}
                      href={entry.href}
                      className={`${flatCls(isActive(entry.href))} ${entry.href === '/portal/chat' && unreadChat.messages > 0 ? 'inline-flex items-center' : ''}`}
                    >
                      {entry.href === '/portal/novinky' && unseenNews > 0 ? (
                        <span className="inline-flex items-center gap-1.5" title={`Nové novinky: ${unseenNews}`}>
                          {entry.label}
                          <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-4 text-white">{unseenNews}</span>
                        </span>
                      ) : entry.href === '/portal/chat' && unreadChat.messages > 0 ? (
                        <span
                          className="inline-flex items-center gap-1.5"
                          title={`Neprečítané správy: ${unreadChat.messages} v ${unreadChat.channels} kanáloch`}
                        >
                          <span className="relative inline-flex">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
                              <path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                            </svg>
                            <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 animate-pulse rounded-full bg-red-500 ring-2 ring-club-900" />
                          </span>
                          {entry.label}
                          <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-4 text-white">
                            {unreadChat.messages > 99 ? '99+' : unreadChat.messages}
                          </span>
                        </span>
                      ) : (
                        entry.label
                      )}
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
      <footer className="mx-auto max-w-6xl border-t border-club-100 px-6 py-5 text-xs text-gray-500">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} FK Košická Nová Ves</span>
          <span className="flex flex-wrap gap-4">
            <Link href="/dokumenty/ochrana-osobnych-udajov" className="hover:text-club-700 hover:underline">
              Ochrana osobných údajov (GDPR)
            </Link>
            <Link href="/podpora" className="hover:text-club-700 hover:underline">
              Podpora
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
