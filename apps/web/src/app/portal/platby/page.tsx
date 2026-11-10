'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiUpload } from '@/lib/api';
import { Button, Card, ErrorText, Modal, inputCls, labelCls } from '@/components/ui';

interface Debtor {
  member: {
    id: string;
    firstName: string;
    lastName: string;
    guardians: Array<{ user: { email: string; phone: string | null } }>;
    memberships: Array<{ team: { teamCategory: { code: string } } }>;
  };
  owedCents: number;
  periods: string[];
}
interface FeePlan {
  id: string;
  name: string;
  amountCents: number;
  period: string;
  teamCategory: { code: string } | null;
  assignments: { id: string }[];
}
interface Category {
  code: string;
  name: string;
}

type Tab = 'debtors' | 'plans' | 'matching' | 'overview' | 'bank';

export default function PaymentsPage() {
  const [tab, setTab] = useState<Tab>('debtors');
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-club-900">Platby</h1>
      <div className="flex gap-2 border-b border-club-100">
        {(
          [
            ['debtors', 'Dlžníci'],
            ['plans', 'Predpisy'],
            ['matching', 'Párovanie platieb'],
            ['overview', 'Prehľad platieb'],
            ['bank', 'Upomienky'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === key ? 'border-b-2 border-club-600 text-club-800' : 'text-gray-500 hover:text-club-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'debtors' && <Debtors />}
      {tab === 'plans' && <Plans />}
      {tab === 'matching' && <PaymentMatching />}
      {tab === 'overview' && <PaymentsOverview />}
      {tab === 'bank' && <Bank />}
    </div>
  );
}

interface Obligation {
  id: string;
  periodLabel: string;
  amountCents: number;
  paidCents: number;
  status: string;
}

function Debtors() {
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manage, setManage] = useState<Debtor | null>(null);

  const load = useCallback(async () => {
    try {
      setDebtors(await api<Debtor[]>('/finance/debtors'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <ErrorText>{error}</ErrorText>
      {debtors.length === 0 && !error && <Card className="text-sm text-gray-500">Žiadne členské po splatnosti. 🎉</Card>}
      {debtors.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-club-100 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-club-50 text-left text-club-800">
              <tr>
                <th className="px-4 py-3">Hráč</th>
                <th className="px-4 py-3">Kategória</th>
                <th className="px-4 py-3">Kontakt</th>
                <th className="px-4 py-3">Obdobia</th>
                <th className="px-4 py-3 text-right">Dlh</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-club-100">
              {debtors.map((d) => (
                <tr key={d.member.id}>
                  <td className="px-4 py-3 font-medium">
                    {d.member.lastName} {d.member.firstName}
                  </td>
                  <td className="px-4 py-3">{d.member.memberships[0]?.team.teamCategory.code ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{d.member.guardians[0]?.user.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{d.periods.join(', ')}</td>
                  <td className="px-4 py-3 text-right font-semibold text-red-700">
                    {(d.owedCents / 100).toFixed(2)} €
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setManage(d)} className="text-club-600 hover:underline">
                      Spravovať
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manage && (
        <DebtorModal
          debtor={manage}
          onClose={() => setManage(null)}
          onChanged={() => {
            void load();
          }}
        />
      )}
    </div>
  );
}

function DebtorModal({ debtor, onClose, onChanged }: { debtor: Debtor; onClose: () => void; onChanged: () => void }) {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<Obligation[]>(`/finance/members/${debtor.member.id}/payments`);
      setObligations(list.filter((o) => o.status !== 'PAID' && o.status !== 'WAIVED'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }, [debtor.member.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function waive(id: string) {
    await api(`/finance/obligations/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'WAIVED' }) }).catch((e) =>
      setError(e instanceof Error ? e.message : 'Chyba'),
    );
    await load();
    onChanged();
  }
  async function setAmount(id: string, eur: string) {
    const amountCents = Math.round(parseFloat(eur) * 100);
    if (!Number.isFinite(amountCents)) return;
    await api(`/finance/obligations/${id}`, { method: 'PATCH', body: JSON.stringify({ amountCents }) }).catch((e) =>
      setError(e instanceof Error ? e.message : 'Chyba'),
    );
    await load();
    onChanged();
  }
  async function remove(id: string) {
    await api(`/finance/obligations/${id}`, { method: 'DELETE' }).catch((e) =>
      setError(e instanceof Error ? e.message : 'Chyba'),
    );
    await load();
    onChanged();
  }

  return (
    <Modal open onClose={onClose} title={`Dlh — ${debtor.member.lastName} ${debtor.member.firstName}`}>
      <div className="space-y-3">
        <ErrorText>{error}</ErrorText>
        {obligations.length === 0 ? (
          <p className="text-sm text-gray-500">Žiadne otvorené povinnosti.</p>
        ) : (
          <div className="divide-y divide-club-100 rounded-md border border-club-100">
            {obligations.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-gray-600">{o.periodLabel}</span>
                <div className="flex items-center gap-2">
                  <input
                    defaultValue={(o.amountCents / 100).toFixed(2)}
                    onBlur={(e) => setAmount(o.id, e.target.value)}
                    className="w-20 rounded border border-gray-300 px-2 py-1 text-right"
                  />
                  <span className="text-gray-400">€</span>
                  <button onClick={() => waive(o.id)} className="text-amber-600 hover:underline">
                    Odpustiť
                  </button>
                  <button onClick={() => remove(o.id)} className="text-red-600 hover:underline">
                    Zmazať
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-500">
          „Odpustiť" označí povinnosť ako odpísanú (nebude dlhom). Sumu upravíte prepísaním hodnoty.
        </p>
        <div className="flex justify-end">
          <Button onClick={onClose}>Zavrieť</Button>
        </div>
      </div>
    </Modal>
  );
}

function Plans() {
  const [plans, setPlans] = useState<FeePlan[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [open, setOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<FeePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlans(await api<FeePlan[]>('/finance/fee-plans'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }, []);
  useEffect(() => {
    void load();
    api<Category[]>('/seasons/categories').then(setCategories).catch(() => {});
    api<{ id: string }>('/seasons/active').then((s) => setSeasonId(s.id)).catch(() => {});
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setGenOpen(true)}>
          Vygenerovať mesiac
        </Button>
        <Button onClick={() => setOpen(true)}>+ Nový predpis</Button>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="overflow-x-auto rounded-lg border border-club-100 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-club-50 text-left text-club-800">
            <tr>
              <th className="px-4 py-3">Názov</th>
              <th className="px-4 py-3">Kategória</th>
              <th className="px-4 py-3">Suma</th>
              <th className="px-4 py-3">Periodicita</th>
              <th className="px-4 py-3">Priradení</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-club-100">
            {plans.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3">{p.teamCategory?.code ?? 'Celý klub'}</td>
                <td className="px-4 py-3">{(p.amountCents / 100).toFixed(2)} €</td>
                <td className="px-4 py-3">{p.period === 'MONTHLY' ? 'Mesačne' : p.period}</td>
                <td className="px-4 py-3">{p.assignments.length}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-3">
                    <button onClick={() => setEditPlan(p)} className="text-club-600 hover:underline">
                      Upraviť
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Zmazať predpis „${p.name}"? Zmažú sa aj jeho priradenia a povinnosti.`)) return;
                        await api(`/finance/fee-plans/${p.id}`, { method: 'DELETE' }).catch((e) =>
                          setError(e instanceof Error ? e.message : 'Chyba'),
                        );
                        void load();
                      }}
                      className="text-red-600 hover:underline"
                    >
                      Zmazať
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  Zatiaľ žiadne predpisy.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <FeePlanModal
          seasonId={seasonId}
          categories={categories}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void load();
          }}
        />
      )}
      {editPlan && (
        <PlanEditModal
          plan={editPlan}
          onClose={() => setEditPlan(null)}
          onDone={() => {
            setEditPlan(null);
            void load();
          }}
        />
      )}
      {genOpen && <GenerateModal onClose={() => setGenOpen(false)} />}
    </div>
  );
}

function PlanEditModal({ plan, onClose, onDone }: { plan: FeePlan; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(plan.name);
  const [amount, setAmount] = useState((plan.amountCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/finance/fee-plans/${plan.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, amountCents: Math.round(parseFloat(amount) * 100) }),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Upraviť predpis">
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Názov</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Suma (€)</label>
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Zrušiť
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Ukladám…' : 'Uložiť'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function FeePlanModal({
  seasonId,
  categories,
  onClose,
  onDone,
}: {
  seasonId: string;
  categories: Category[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('Členské mesačné');
  const [amount, setAmount] = useState('25');
  const [category, setCategory] = useState('');
  const [dueDay, setDueDay] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api('/finance/fee-plans', {
        method: 'POST',
        body: JSON.stringify({
          seasonId,
          name,
          amountCents: Math.round(parseFloat(amount) * 100),
          period: 'MONTHLY',
          dueDay: parseInt(dueDay, 10),
          teamCategoryCode: category || undefined,
        }),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Nový predpis poplatku">
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Názov</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Suma (€ / mesiac)</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Deň splatnosti</label>
            <input type="number" min="1" max="28" value={dueDay} onChange={(e) => setDueDay(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Kategória</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            <option value="">Celý klub</option>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">Predpis sa automaticky priradí aktívnym hráčom kategórie.</p>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Zrušiť
          </Button>
          <Button onClick={submit} disabled={busy || !seasonId}>
            {busy ? 'Ukladám…' : 'Vytvoriť'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function GenerateModal({ onClose }: { onClose: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const r = await api<{ created: number; total: number; period: string }>('/finance/obligations/generate', {
        method: 'POST',
        body: JSON.stringify({ year: parseInt(year, 10), month: parseInt(month, 10) }),
      });
      setResult(`Obdobie ${r.period}: vytvorených ${r.created} nových predpisov (z ${r.total}).`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Vygenerovať mesačné predpisy">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Vytvorí platobné povinnosti s variabilnými symbolmi pre daný mesiac zo všetkých mesačných predpisov.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Rok</label>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Mesiac</label>
            <input type="number" min="1" max="12" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} />
          </div>
        </div>
        {result && <p className="text-sm text-club-700">{result}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Zavrieť
          </Button>
          <Button onClick={generate} disabled={busy}>
            {busy ? 'Generujem…' : 'Vygenerovať'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface BankTx {
  id: string;
  date: string;
  amountCents: number;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  message: string | null;
  variableSymbol: string | null;
  matchStatus: 'UNMATCHED' | 'MATCHED' | 'MANUAL' | 'IGNORED';
  suggestedMember: { id: string; firstName: string; lastName: string } | null;
  matchedMember: { id: string; firstName: string; lastName: string } | null;
  matches: Array<{ amountCents: number; paymentObligation: { periodLabel: string } }>;
}
interface MemberOpt {
  id: string;
  firstName: string;
  lastName: string;
}
type MatchFilter = 'all' | 'suggested' | 'unmatched' | 'matched' | 'ignored';

function PaymentMatching() {
  const [txns, setTxns] = useState<BankTx[]>([]);
  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [filter, setFilter] = useState<MatchFilter>('suggested');
  const [error, setError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [picker, setPicker] = useState<BankTx | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setTxns(await api<BankTx[]>('/finance/bank/transactions'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
    }
  }, []);

  useEffect(() => {
    void load();
    api<MemberOpt[]>('/members').then(setMembers).catch(() => {});
  }, [load]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const r = await apiUpload<{ imported: number; matchedTransactions: number; suggestedTransactions: number }>(
        '/finance/bank/import-file',
        file,
      );
      setImportInfo(
        `Načítaných ${r.imported} platieb · automaticky spárovaných ${r.matchedTransactions} · návrhov ${r.suggestedTransactions}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import zlyhal');
    } finally {
      setImporting(false);
    }
  }

  async function assign(txId: string, memberId: string) {
    try {
      const r = await api<{ alsoMatched: number; learnedIban: string | null }>(`/finance/bank/${txId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ memberId }),
      });
      setPicker(null);
      if (r.alsoMatched > 0) {
        setImportInfo(`Účet zapamätaný — automaticky spárovaných ďalších ${r.alsoMatched} platieb z toho istého účtu.`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Priradenie zlyhalo');
    }
  }
  async function ignore(txId: string) {
    try {
      await api(`/finance/bank/${txId}/ignore`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  const counts = useMemo(() => {
    const c = { all: txns.length, suggested: 0, unmatched: 0, matched: 0, ignored: 0 };
    for (const t of txns) {
      if (t.matchStatus === 'IGNORED') c.ignored++;
      else if (t.matchStatus === 'MATCHED' || t.matchStatus === 'MANUAL') c.matched++;
      else if (t.suggestedMember) c.suggested++;
      else c.unmatched++;
    }
    return c;
  }, [txns]);

  const shown = txns.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'ignored') return t.matchStatus === 'IGNORED';
    if (filter === 'matched') return t.matchStatus === 'MATCHED' || t.matchStatus === 'MANUAL';
    if (filter === 'suggested') return t.matchStatus === 'UNMATCHED' && !!t.suggestedMember;
    return t.matchStatus === 'UNMATCHED' && !t.suggestedMember; // unmatched
  });

  const filters: [MatchFilter, string][] = [
    ['suggested', `Návrhy (${counts.suggested})`],
    ['unmatched', `Nespárované (${counts.unmatched})`],
    ['matched', `Spárované (${counts.matched})`],
    ['ignored', `Ignorované (${counts.ignored})`],
    ['all', `Všetky (${counts.all})`],
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-club-800">Import bankového výpisu</h2>
            <p className="text-sm text-gray-600">
              Nahrajte výpis z účtu (.xls/.xlsx). Platby z už známych účtov sa spárujú automaticky, ostatné
              dostanú návrh podľa mena — po potvrdení si systém účet zapamätá.
            </p>
          </div>
          <input ref={fileRef} type="file" accept=".xls,.xlsx" onChange={onFile} className="hidden" />
          <Button onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? 'Importujem…' : '⬆ Nahrať výpis'}
          </Button>
        </div>
        {importInfo && <p className="text-sm font-medium text-club-700">{importInfo}</p>}
      </Card>

      <ErrorText>{error}</ErrorText>

      <div className="flex flex-wrap gap-2">
        {filters.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === key ? 'border-club-600 bg-club-600 text-white' : 'border-gray-300 text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-club-100 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-club-50 text-left text-club-800">
            <tr>
              <th className="px-3 py-3">Dátum</th>
              <th className="px-3 py-3">Platca</th>
              <th className="px-3 py-3">Poznámka</th>
              <th className="px-3 py-3 text-right">Suma</th>
              <th className="px-3 py-3">Člen / stav</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-club-100">
            {shown.map((t) => (
              <tr key={t.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                  {new Date(t.date).toLocaleDateString('sk-SK')}
                </td>
                <td className="px-3 py-3">
                  <div className="font-medium">{t.counterpartyName ?? '—'}</div>
                  <div className="text-xs text-gray-400">{t.counterpartyIban ?? ''}</div>
                </td>
                <td className="px-3 py-3 text-gray-600">{t.message ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">
                  {(t.amountCents / 100).toFixed(2)} €
                </td>
                <td className="px-3 py-3">
                  {t.matchStatus === 'IGNORED' ? (
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Ignorované</span>
                  ) : t.matchedMember ? (
                    <div>
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        {t.matchStatus === 'MANUAL' ? 'Ručne' : 'Auto'}
                      </span>{' '}
                      <span className="font-medium">
                        {t.matchedMember.lastName} {t.matchedMember.firstName}
                      </span>
                      {t.matches.length > 0 && (
                        <div className="text-xs text-gray-400">
                          {t.matches.map((m) => m.paymentObligation.periodLabel).join(', ')}
                        </div>
                      )}
                    </div>
                  ) : t.suggestedMember ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Návrh: {t.suggestedMember.lastName} {t.suggestedMember.firstName}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">nespárované</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {t.matchStatus !== 'IGNORED' && (
                    <div className="flex justify-end gap-2">
                      {t.suggestedMember && !t.matchedMember && (
                        <button
                          onClick={() => assign(t.id, t.suggestedMember!.id)}
                          className="font-medium text-green-700 hover:underline"
                        >
                          Potvrdiť
                        </button>
                      )}
                      <button onClick={() => setPicker(t)} className="text-club-600 hover:underline">
                        {t.matchedMember ? 'Zmeniť' : 'Priradiť'}
                      </button>
                      {!t.matchedMember && (
                        <button onClick={() => ignore(t.id)} className="text-gray-400 hover:underline">
                          Ignorovať
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  Žiadne pohyby v tejto kategórii.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {picker && (
        <MemberPicker
          tx={picker}
          members={members}
          onClose={() => setPicker(null)}
          onPick={(memberId) => assign(picker.id, memberId)}
        />
      )}
    </div>
  );
}

function MemberPicker({
  tx,
  members,
  onClose,
  onPick,
}: {
  tx: BankTx;
  members: MemberOpt[];
  onClose: () => void;
  onPick: (memberId: string) => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    const list = members
      .filter((m) =>
        !s
          ? true
          : `${m.lastName} ${m.firstName}`
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
              .includes(s),
      )
      .slice(0, 40);
    return list;
  }, [q, members]);

  return (
    <Modal open onClose={onClose} title="Priradiť platbu členovi">
      <div className="space-y-3">
        <div className="rounded-md bg-club-50 p-3 text-sm text-gray-600">
          <div>
            <strong>{tx.counterpartyName ?? '—'}</strong> · {(tx.amountCents / 100).toFixed(2)} €
          </div>
          {tx.message && <div>Poznámka: {tx.message}</div>}
          {tx.counterpartyIban && (
            <div className="text-xs text-gray-400">Účet {tx.counterpartyIban} sa zapamätá pre budúce platby.</div>
          )}
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Hľadať člena…"
          className={inputCls}
        />
        <div className="max-h-72 divide-y divide-club-100 overflow-y-auto rounded-md border border-club-100">
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => onPick(m.id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-club-50"
            >
              <span>
                {m.lastName} {m.firstName}
              </span>
              {tx.suggestedMember?.id === m.id && <span className="text-xs text-amber-600">návrh</span>}
            </button>
          ))}
          {filtered.length === 0 && <p className="px-3 py-4 text-sm text-gray-400">Žiadny člen.</p>}
        </div>
      </div>
    </Modal>
  );
}

function Bank() {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runMatch() {
    setBusy(true);
    try {
      const r = await api<{ matchedTransactions: number }>('/finance/bank/match', { method: 'POST' });
      setResult(`Spárovaných pohybov: ${r.matchedTransactions}.`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  async function runDunning() {
    setBusy(true);
    try {
      const r = await api<{ membersNotified: number }>('/finance/dunning/run', { method: 'POST' });
      setResult(`Upomienky odoslané ${r.membersNotified} dlžníkom (push + e-mail).`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  async function sendApology() {
    setBusy(true);
    try {
      const p = await api<{ members: string[]; userIds: string[]; emails: string[] }>('/finance/dunning/apology');
      if (p.userIds.length === 0) {
        setResult('Žiadnemu rodičovi zatiaľ neodišla upomienka.');
        return;
      }
      const ok = window.confirm(
        `Odoslať oznam „upomienky boli len testovacie“ ${p.userIds.length} rodičom (${p.emails.length} e-mailov) ` +
          `za ${p.members.length} hráčov?\n\n${p.members.slice(0, 15).join(', ')}${p.members.length > 15 ? ', …' : ''}`,
      );
      if (!ok) return;
      const r = await api<{ members: number; recipients: number; emailsSent: number; emailError: string | null }>('/finance/dunning/apology', { method: 'POST' });
      setResult(`Oznam odoslaný: ${r.recipients} rodičov (push), ${r.emailsSent} e-mailov, ${r.members} hráčov.` +
          (r.emailError ? ` ⚠ E-maily sa neodoslali: ${r.emailError}` : ''));
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="font-semibold text-club-800">Oznam: upomienky boli testovacie</h2>
        <p className="text-sm text-gray-600">
          Pošle všetkým rodičom, ktorým kedykoľvek odišla upomienka (oprávnená aj neoprávnená), push aj e-mail, že
          správa bola len testovacia a nemá nič spoločné s úhradami. Pred odoslaním sa zobrazí zoznam a potvrdenie.
        </p>
        <Button variant="ghost" onClick={sendApology} disabled={busy}>
          Poslať oznam rodičom
        </Button>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold text-club-800">Prepárovať pohyby</h2>
        <p className="text-sm text-gray-600">
          Import výpisu a párovanie nájdete v záložke „Párovanie platieb". Tu môžete znovu spustiť automatické
          párovanie (napr. po pridaní nových predpisov alebo po naučení účtov).
        </p>
        <Button onClick={runMatch} disabled={busy}>
          Spustiť párovanie
        </Button>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold text-club-800">Upomienky dlžníkom</h2>
        <p className="text-sm text-gray-600">
          Bežia automaticky denne o 8:00; tu ich viete spustiť manuálne. Rodičia dostanú push aj e-mail.
        </p>
        <Button variant="ghost" onClick={runDunning} disabled={busy}>
          Spustiť upomienky teraz
        </Button>
      </Card>
      {result && <p className="text-sm text-club-700">{result}</p>}
    </div>
  );
}

interface OverviewRow {
  memberId: string;
  firstName: string;
  lastName: string;
  months: Record<string, { amountCents: number; paidCents: number; status: string }>;
}
const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Máj', 'Jún', 'Júl', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

function PaymentsOverview() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api<OverviewRow[]>(`/finance/overview?year=${year}`)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Chyba'));
  }, [year]);

  const shown = rows.filter((r) => `${r.lastName} ${r.firstName}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button className="rounded border px-2 py-1 text-sm" onClick={() => setYear(year - 1)}>←</button>
        <span className="font-semibold">{year}</span>
        <button className="rounded border px-2 py-1 text-sm" onClick={() => setYear(year + 1)}>→</button>
        <input className={`${inputCls} max-w-xs`} placeholder="Hľadať priezvisko / meno" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="ml-auto flex items-center gap-3 text-xs text-gray-600">
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-green-500" /> uhradené</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-red-500" /> neuhradené</span>
        </span>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="px-2 py-2">Priezvisko a meno</th>
              {MONTH_NAMES.map((m) => (
                <th key={m} className="px-1 py-2 text-center">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.memberId} className="border-t border-club-50">
                <td className="whitespace-nowrap px-2 py-1.5 font-medium">{r.lastName} {r.firstName}</td>
                {MONTHS.map((m) => {
                  const c = r.months[m];
                  if (!c) return <td key={m} className="px-1 py-1.5 text-center text-gray-300">–</td>;
                  const paid = c.status === 'PAID' || c.status === 'WAIVED' || c.paidCents >= c.amountCents;
                  return (
                    <td key={m} className="px-1 py-1.5 text-center">
                      <span
                        title={`${(c.paidCents / 100).toFixed(2)} / ${(c.amountCents / 100).toFixed(2)} €`}
                        className={`inline-block min-w-[3rem] rounded px-1.5 py-0.5 text-xs font-medium text-white ${paid ? 'bg-green-500' : 'bg-red-500'}`}
                      >
                        {(c.amountCents / 100).toFixed(0)} €
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={13} className="px-2 py-6 text-center text-gray-500">Žiadne platby pre rok {year}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
