'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';
import { MemberPaymentsPanel } from '@/components/member-payments-panel';

interface Me {
  firstName: string;
  lastName: string;
  memberId: string | null;
  children: Array<{ id: string; firstName: string; lastName: string }>;
}

/** Platby hráča / dieťaťa — pre hráča a rodiča (predpis a stav úhrady). */
export default function MyPaymentsPage() {
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Me>('/auth/me')
      .then((me) => {
        const list = me.children.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` }));
        if (me.memberId && !list.some((p) => p.id === me.memberId)) {
          list.unshift({ id: me.memberId, name: `${me.firstName} ${me.lastName}` });
        }
        setPeople(list);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-club-900">Moje platby</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {people.length === 0 && !error && <p className="text-sm text-gray-500">Žiadni hráči.</p>}
      {people.map((p) => (
        <Card key={p.id}>
          <h2 className="mb-2 font-semibold text-club-800">{p.name}</h2>
          <MemberPaymentsPanel memberId={p.id} />
        </Card>
      ))}
    </div>
  );
}
