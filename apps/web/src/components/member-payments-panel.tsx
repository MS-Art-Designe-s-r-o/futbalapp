'use client';

import { api } from '@/lib/api';
import { useEffect, useState } from 'react';
import { formatEventDateSk } from '@fkknv/shared';

interface MemberPayment {
  id: string;
  periodLabel: string;
  amountCents: number;
  paidCents: number;
  status: 'PENDING' | 'PAID' | 'PARTIAL' | 'OVERDUE' | 'WAIVED';
  dueDate: string;
  variableSymbol: string | null;
  planName?: string | null;
}

const PAYMENT_STATUS: Record<string, { label: string; cls: string }> = {
  PAID: { label: 'Uhradené', cls: 'bg-club-600 text-white' },
  PARTIAL: { label: 'Čiastočne', cls: 'bg-amber-500 text-white' },
  PENDING: { label: 'Čaká', cls: 'bg-gray-100 text-gray-600' },
  OVERDUE: { label: 'Po splatnosti', cls: 'bg-red-600 text-white' },
  WAIVED: { label: 'Odpustené', cls: 'bg-teal-600 text-white' },
};

function eur(cents: number) {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

/** Platby člena (karta hráča) — predpisy, úhrady a nedoplatok. */
export function MemberPaymentsPanel({ memberId }: { memberId: string }) {
  const [items, setItems] = useState<MemberPayment[] | null>(null);

  useEffect(() => {
    setItems(null);
    api<MemberPayment[]>(`/finance/members/${memberId}/payments`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [memberId]);

  if (!items) return <p className="text-xs text-gray-500">Načítavam…</p>;
  if (items.length === 0) return <p className="text-xs text-gray-500">Žiadne platby</p>;

  const active = items.filter((p) => p.status !== 'WAIVED');
  const total = active.reduce((a, p) => a + p.amountCents, 0);
  const paid = active.reduce((a, p) => a + p.paidCents, 0);
  const owed = active.reduce((a, p) => a + Math.max(0, p.amountCents - p.paidCents), 0);

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-club-50 p-2">
          <div className="text-gray-500">Celkom predpísané</div>
          <div className="text-sm font-semibold">{eur(total)}</div>
        </div>
        <div className="rounded-md bg-club-50 p-2">
          <div className="text-gray-500">Uhradené</div>
          <div className="text-sm font-semibold">{eur(paid)}</div>
        </div>
        <div className={`rounded-md p-2 ${owed > 0 ? 'bg-red-50 text-red-700' : 'bg-club-50'}`}>
          <div className="text-gray-500">Nedoplatok</div>
          <div className="text-sm font-semibold">{eur(owed)}</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-gray-500">
            <tr>
              <th className="py-1 pr-2">Obdobie</th>
              <th className="py-1 pr-2">Predpis</th>
              <th className="py-1 pr-2 text-right">Suma</th>
              <th className="py-1 pr-2 text-right">Uhradené</th>
              <th className="py-1 pr-2">Splatnosť</th>
              <th className="py-1 pr-2">VS</th>
              <th className="py-1">Stav</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const st = PAYMENT_STATUS[p.status] ?? { label: p.status, cls: 'bg-gray-100 text-gray-600' };
              return (
                <tr key={p.id} className="border-t border-club-100">
                  <td className="py-1 pr-2">{p.periodLabel}</td>
                  <td className="py-1 pr-2">{p.planName ?? '—'}</td>
                  <td className="py-1 pr-2 text-right">{eur(p.amountCents)}</td>
                  <td className="py-1 pr-2 text-right">{eur(p.paidCents)}</td>
                  <td className="py-1 pr-2">{p.dueDate ? formatEventDateSk(p.dueDate) : '—'}</td>
                  <td className="py-1 pr-2">{p.variableSymbol ?? '—'}</td>
                  <td className="py-1">
                    <span className={`rounded px-1.5 py-0.5 ${st.cls}`}>{st.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

