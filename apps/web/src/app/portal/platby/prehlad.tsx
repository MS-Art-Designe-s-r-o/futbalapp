'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Card, ErrorText, inputCls, labelCls } from '@/components/ui';

interface Totals {
  prescribedCents?: number;
  paidCents?: number;
  outstandingCents?: number;
  overdueCents?: number;
  otherIncomeCents?: number;
  expensesPaidCents?: number;
  expensesPlannedCents?: number;
  balanceCents?: number;
}
interface ByMonth {
  month?: number;
  day?: number;
  prescribedCents?: number;
  paidCents?: number;
  otherIncomeCents?: number;
  expensesCents?: number;
}
interface StatusEntry {
  count?: number;
  cents?: number;
}
interface Overview {
  period?: { year: number; month: number | null };
  totals?: Totals;
  byMonth?: ByMonth[];
  byDay?: ByMonth[];
  statusCounts?: Record<string, StatusEntry>;
  byTeam?: { teamName: string; prescribedCents?: number; paidCents?: number }[];
  topDebtors?: { memberId: string; name: string; owedCents: number }[];
  expensesByPayee?: { payee: string; cents: number }[];
}

// Farby: modrá = predpísané, zelená = uhradené, oranžová = výdavky (rozlíšiteľné aj pri CVD)
const C = {
  prescribed: '#94a3b8',
  paid: '#16a34a',
  expense: '#ea580c',
  balance: '#2563eb',
  grid: '#e5e7eb',
  text: '#6b7280',
};
const STATUS_META: [string, string, string][] = [
  ['PAID', 'Uhradené', '#16a34a'],
  ['PARTIAL', 'Čiastočne', '#eab308'],
  ['PENDING', 'Čaká', '#94a3b8'],
  ['OVERDUE', 'Po splatnosti', '#dc2626'],
  ['WAIVED', 'Odpustené', '#7c3aed'],
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Máj', 'Jún', 'Júl', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

const eur = (c: number | undefined) =>
  `${((c ?? 0) / 100).toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const eurShort = (c: number) => {
  const v = c / 100;
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace('.0', '')}k` : String(Math.round(v));
};

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export default function PrehladTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(0);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = `year=${year}${month ? `&month=${String(month).padStart(2, '0')}` : ''}`;
    api<Overview>(`/finance/overview?${qs}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const t = data?.totals ?? {};
  const rate = (t.prescribedCents ?? 0) > 0 ? Math.round(((t.paidCents ?? 0) / (t.prescribedCents ?? 1)) * 100) : null;

  const rows = useMemo(() => {
    const list = [...(data?.byMonth ?? []), ...(data?.byDay ?? [])].map((m) => ({
      label: m.day != null ? `${m.day}.` : MONTHS[(m.month ?? 1) - 1] ?? String(m.month),
      key: m.day ?? m.month ?? 0,
      prescribed: m.prescribedCents ?? 0,
      paid: m.paidCents ?? 0,
      other: m.otherIncomeCents ?? 0,
      expenses: m.expensesCents ?? 0,
    }));
    return list.sort((a, b) => a.key - b.key);
  }, [data]);

  const hasData =
    !!data &&
    ((t.prescribedCents ?? 0) > 0 ||
      (t.paidCents ?? 0) > 0 ||
      (t.otherIncomeCents ?? 0) > 0 ||
      (t.expensesPaidCents ?? 0) > 0 ||
      rows.some((r) => r.prescribed || r.paid || r.expenses || r.other));

  const balance = t.balanceCents ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={labelCls}>Rok</label>
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className={inputCls}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Mesiac</label>
          <select value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))} className={inputCls}>
            <option value={0}>Celý rok</option>
            {MONTHS.map((_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
        {loading && <span className="pb-2 text-sm text-gray-400">Načítavam…</span>}
      </div>
      <ErrorText>{error}</ErrorText>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Predpísané" value={eur(t.prescribedCents)} />
        <Kpi
          label="Uhradené"
          value={eur(t.paidCents)}
          sub={rate !== null ? `${rate} % úspešnosť` : undefined}
          tone="text-green-700"
        />
        <Kpi
          label="Nedoplatok"
          value={eur(t.outstandingCents)}
          sub={`z toho po splatnosti ${eur(t.overdueCents)}`}
          tone={(t.overdueCents ?? 0) > 0 ? 'text-red-700' : undefined}
        />
        <Kpi label="Iné platby" value={eur(t.otherIncomeCents)} sub="prijaté mimo predpisov" />
        <Kpi
          label="Výdavky"
          value={eur(t.expensesPaidCents)}
          sub={(t.expensesPlannedCents ?? 0) > 0 ? `plánované ${eur(t.expensesPlannedCents)}` : undefined}
          tone="text-orange-700"
        />
        <Kpi label="Bilancia" value={eur(balance)} tone={balance < 0 ? 'text-red-700' : 'text-green-700'} sub="príjmy − výdavky" />
      </div>

      {!hasData && !loading && !error && (
        <Card className="text-sm text-gray-500">Pre zvolené obdobie zatiaľ nie sú žiadne údaje.</Card>
      )}

      {hasData && (
        <>
          <Card className="space-y-2">
            <h2 className="font-semibold text-club-800">{month ? 'Priebeh po dňoch' : 'Priebeh po mesiacoch'}</h2>
            <Legend
              items={[
                ['Predpísané', C.prescribed],
                ['Uhradené', C.paid],
                ['Výdavky', C.expense],
              ]}
            />
            <BarChart rows={rows} />
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">Zobraziť ako tabuľku</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-right">
                  <thead>
                    <tr className="text-left text-club-800">
                      <th className="py-1">Obdobie</th>
                      <th className="text-right">Predpísané</th>
                      <th className="text-right">Uhradené</th>
                      <th className="text-right">Iné</th>
                      <th className="text-right">Výdavky</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t border-club-100">
                        <td className="py-1 text-left">{r.label}</td>
                        <td>{eur(r.prescribed)}</td>
                        <td>{eur(r.paid)}</td>
                        <td>{eur(r.other)}</td>
                        <td>{eur(r.expenses)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>

          <Card className="space-y-2">
            <h2 className="font-semibold text-club-800">Kumulatívna bilancia</h2>
            <p className="text-xs text-gray-500">Priebežný súčet uhradených platieb a iných príjmov mínus výdavky.</p>
            <BalanceChart rows={rows} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <StatusCard counts={data?.statusCounts} />
            <TeamCard teams={data?.byTeam} />
            <DebtorsCard debtors={data?.topDebtors} />
            <PayeeCard payees={data?.expensesByPayee} />
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-club-100 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-bold leading-tight ${tone ?? 'text-club-900'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-gray-600">
      {items.map(([l, c]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}

type Row = { label: string; key: number; prescribed: number; paid: number; other: number; expenses: number };

const W = 720;
const H = 240;
const PAD = { l: 44, r: 8, t: 10, b: 24 };

function BarChart({ rows }: { rows: Row[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...rows.flatMap((r) => [r.prescribed, r.paid, r.expenses])));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const gw = iw / Math.max(rows.length, 1);
  const bw = Math.max(2, Math.min(18, (gw - 8) / 3));
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const h = hover !== null ? rows[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Stĺpcový graf predpísaných, uhradených platieb a výdavkov"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(tv)} y2={y(tv)} stroke={C.grid} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(tv) + 3} textAnchor="end" fontSize={10} fill={C.text}>
              {eurShort(tv)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x0 = PAD.l + i * gw + (gw - bw * 3 - 4) / 2;
          const bars: [number, string][] = [
            [r.prescribed, C.prescribed],
            [r.paid, C.paid],
            [r.expenses, C.expense],
          ];
          return (
            <g key={r.key} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <rect x={PAD.l + i * gw} y={PAD.t} width={gw} height={ih + PAD.b} fill={hover === i ? '#00000008' : 'transparent'} />
              {bars.map(([v, col], j) => (
                <rect
                  key={j}
                  x={x0 + j * (bw + 2)}
                  y={y(v)}
                  width={bw}
                  height={Math.max(0, PAD.t + ih - y(v))}
                  rx={2}
                  fill={col}
                />
              ))}
              <text x={PAD.l + i * gw + gw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill={C.text}>
                {rows.length > 20 && i % 2 ? '' : r.label}
              </text>
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="pointer-events-none absolute right-2 top-0 rounded-md border border-club-100 bg-white/95 px-2 py-1 text-xs shadow">
          <div className="font-medium text-club-800">{h.label}</div>
          <div>Predpísané: {eur(h.prescribed)}</div>
          <div>Uhradené: {eur(h.paid)}</div>
          <div>Výdavky: {eur(h.expenses)}</div>
        </div>
      )}
    </div>
  );
}

function BalanceChart({ rows }: { rows: Row[] }) {
  const pts = useMemo(() => {
    let acc = 0;
    return rows.map((r) => {
      acc += r.paid + r.other - r.expenses;
      return acc;
    });
  }, [rows]);
  if (pts.length === 0) return <p className="text-sm text-gray-500">Bez údajov.</p>;
  const lo = Math.min(0, ...pts);
  const hi = Math.max(0, ...pts);
  const span = hi - lo || 1;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - ((v - lo) / span) * ih;
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const ticks = [lo, lo + span / 2, hi];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Kumulatívna bilancia v čase">
      {ticks.map((tv, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(tv)} y2={y(tv)} stroke={C.grid} />
          <text x={PAD.l - 6} y={y(tv) + 3} textAnchor="end" fontSize={10} fill={C.text}>
            {eurShort(tv)}
          </text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#9ca3af" strokeDasharray="3 3" />
      <path d={area} fill={C.balance} fillOpacity={0.12} />
      <path d={line} fill="none" stroke={C.balance} strokeWidth={2} strokeLinejoin="round" />
      {pts.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill={C.balance} stroke="#fff" strokeWidth={2}>
          <title>{`${rows[i].label}: ${eur(v)}`}</title>
        </circle>
      ))}
      {rows.map((r, i) => (
        <text key={r.key} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={C.text}>
          {rows.length > 20 && i % 2 ? '' : r.label}
        </text>
      ))}
    </svg>
  );
}

function StatusCard({ counts }: { counts?: Record<string, StatusEntry> }) {
  const items = STATUS_META.map(([k, label, color]) => ({
    k,
    label,
    color,
    count: counts?.[k]?.count ?? 0,
    cents: counts?.[k]?.cents ?? 0,
  }));
  const total = items.reduce((s, i) => s + i.count, 0);
  const R = 52;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold text-club-800">Stav predpisov</h2>
      {total === 0 ? (
        <p className="text-sm text-gray-500">Žiadne predpisy.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label="Podiel stavov predpisov">
            <g transform="rotate(-90 70 70)">
              {items
                .filter((i) => i.count > 0)
                .map((i) => {
                  const len = (i.count / total) * CIRC;
                  const el = (
                    <circle
                      key={i.k}
                      cx={70}
                      cy={70}
                      r={R}
                      fill="none"
                      stroke={i.color}
                      strokeWidth={20}
                      strokeDasharray={`${Math.max(0, len - 2)} ${CIRC - Math.max(0, len - 2)}`}
                      strokeDashoffset={-offset}
                    >
                      <title>{`${i.label}: ${i.count}`}</title>
                    </circle>
                  );
                  offset += len;
                  return el;
                })}
            </g>
            <text x={70} y={68} textAnchor="middle" fontSize={20} fontWeight={700} fill="#111827">
              {total}
            </text>
            <text x={70} y={84} textAnchor="middle" fontSize={10} fill={C.text}>
              predpisov
            </text>
          </svg>
          <ul className="min-w-0 flex-1 space-y-1 text-sm">
            {items.map((i) => (
              <li key={i.k} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
                  {i.label}
                </span>
                <span className="text-gray-600">
                  {i.count} · {eur(i.cents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function TeamCard({ teams }: { teams?: { teamName: string; prescribedCents?: number; paidCents?: number }[] }) {
  const list = (teams ?? []).filter((t) => (t.prescribedCents ?? 0) > 0 || (t.paidCents ?? 0) > 0);
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold text-club-800">Uhradenosť podľa družstva</h2>
      {list.length === 0 ? (
        <p className="text-sm text-gray-500">Žiadne údaje.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((t) => {
            const p = t.prescribedCents ?? 0;
            const pct = p > 0 ? Math.min(100, Math.round(((t.paidCents ?? 0) / p) * 100)) : 0;
            return (
              <li key={t.teamName} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{t.teamName}</span>
                  <span className="text-gray-600">
                    {eur(t.paidCents)} / {eur(p)} · {pct} %
                  </span>
                </div>
                <div
                  className="mt-1 h-2.5 overflow-hidden rounded-full bg-gray-200"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${t.teamName} uhradené`}
                >
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: C.paid }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function DebtorsCard({ debtors }: { debtors?: { memberId: string; name: string; owedCents: number }[] }) {
  const list = debtors ?? [];
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold text-club-800">Najväčší dlžníci</h2>
      {list.length === 0 ? (
        <p className="text-sm text-gray-500">Žiadni dlžníci.</p>
      ) : (
        <ol className="divide-y divide-club-100 text-sm">
          {list.map((d, i) => (
            <li key={d.memberId} className="flex justify-between gap-2 py-1.5">
              <span>
                <span className="mr-2 text-gray-400">{i + 1}.</span>
                {d.name}
              </span>
              <span className="font-semibold text-red-700">{eur(d.owedCents)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function PayeeCard({ payees }: { payees?: { payee: string; cents: number }[] }) {
  const list = payees ?? [];
  const max = Math.max(1, ...list.map((p) => p.cents));
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold text-club-800">Výdavky podľa príjemcu</h2>
      {list.length === 0 ? (
        <p className="text-sm text-gray-500">Žiadne výdavky.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((p) => (
            <li key={p.payee} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium">{p.payee}</span>
                <span className="shrink-0 text-gray-600">{eur(p.cents)}</span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full" style={{ width: `${(p.cents / max) * 100}%`, background: C.expense }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
