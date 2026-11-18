'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiUpload, ApiError } from '@/lib/api';
import { Button, Card, ErrorText, Modal, inputCls, labelCls } from '@/components/ui';

type Kind = 'RENT' | 'OTHER';
interface CostItem {
  id: string;
  name: string;
  hasKinds: boolean;
  sortOrder: number;
}
interface CostGroup {
  id: string;
  name: string;
  sortOrder: number;
  items: CostItem[];
}
interface BankTx {
  id: string;
  date: string;
  amountCents: number;
  counterpartyName: string | null;
  variableSymbol: string | null;
  message: string | null;
}
interface Expense {
  id: string;
  payee: string;
  description: string | null;
  amountCents: number;
  variableSymbol: string | null;
  iban: string | null;
  dueDate: string | null;
  status: 'PLANNED' | 'PAID';
  paidAt: string | null;
  costItem: { id: string; name: string; hasKinds: boolean; group: { id: string; name: string } } | null;
  kind: Kind | null;
  period: string | null;
  matchedBy: 'AUTO' | 'MANUAL' | null;
  bankTransaction: BankTx | null;
  createdAt: string;
}
interface Debit {
  id: string;
  date: string;
  amountCents: number;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  variableSymbol: string | null;
  message: string | null;
  matchedExpenseId: string | null;
}

const eur = (c: number) => `${(c / 100).toFixed(2)} €`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('sk-SK') : '—');
const KIND_LABEL: Record<Kind, string> = { RENT: 'Nájomné', OTHER: 'Ostatné náklady' };
const MONTHS = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];
const fmtPeriod = (p: string | null) => {
  if (!p) return '—';
  const [y, m] = p.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};
const errMsg = (e: unknown, fb = 'Chyba') => (e instanceof Error ? e.message : fb);

const isMatched = (x: Expense) => !!x.bankTransaction;

export default function NakladyTab() {
  const now = new Date();
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [groupId, setGroupId] = useState('');
  const [matched, setMatched] = useState('');
  const [items, setItems] = useState<Expense[]>([]);
  const [structure, setStructure] = useState<CostGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Expense | 'new' | null>(null);
  const [manage, setManage] = useState(false);
  const [matching, setMatching] = useState<Expense | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadStructure = useCallback(async () => {
    try {
      const s = await api<CostGroup[]>('/finance/cost-structure');
      setStructure(Array.isArray(s) ? s : []);
    } catch (e) {
      setError(errMsg(e, 'Načítanie štruktúry zlyhalo'));
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (year) qs.set('year', year);
      if (month) qs.set('month', month.padStart(2, '0'));
      if (groupId) qs.set('groupId', groupId);
      if (matched) qs.set('matched', matched);
      const list = await api<Expense[]>(`/finance/expenses?${qs.toString()}`);
      setItems(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e) {
      setError(errMsg(e, 'Načítanie zlyhalo'));
    }
  }, [year, month, groupId, matched]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadStructure();
  }, [loadStructure]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      setError(null);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const r = await apiUpload<{
        imported: number;
        matchedTransactions: number;
        suggestedTransactions: number;
        expensesMatched: number;
        expensesCreated: number;
      }>('/finance/bank/import-file', file);
      setImportInfo(
        `Naimportovaných ${r.imported} pohybov, spárovaných výdavkov ${r.expensesMatched ?? 0}, nových uhradených výdavkov ${r.expensesCreated ?? 0}.`,
      );
      await load();
    } catch (err) {
      setError(errMsg(err, 'Import zlyhal'));
    } finally {
      setImporting(false);
    }
  }

  // Zoskupenie: skupina -> (položka | nezaradené)
  const sections = useMemo(() => {
    const out: { key: string; name: string; rows: Expense[] }[] = [];
    for (const g of structure) {
      const rows = items.filter((x) => x.costItem?.group.id === g.id);
      if (rows.length) out.push({ key: g.id, name: g.name, rows });
    }
    const known = new Set(structure.map((g) => g.id));
    // skupiny, ktoré nie sú v štruktúre (defenzívne)
    const extra = new Map<string, Expense[]>();
    for (const x of items) {
      const gid = x.costItem?.group.id;
      if (gid && !known.has(gid)) extra.set(gid, [...(extra.get(gid) ?? []), x]);
    }
    extra.forEach((rows, gid) => out.push({ key: gid, name: rows[0].costItem!.group.name, rows }));
    const loose = items.filter((x) => !x.costItem);
    if (loose.length) out.push({ key: 'none', name: 'Nezaradené', rows: loose });
    return out;
  }, [items, structure]);

  const total = items.reduce((s, x) => s + x.amountCents, 0);
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  function renderRow(x: Expense, showItem: boolean) {
    return (
      <tr key={x.id} className="align-top">
        <td className="px-3 py-2">
          {showItem ? (
            <div className="font-medium">{x.costItem?.name ?? x.description ?? '—'}</div>
          ) : (
            <div className="pl-4 font-medium">{x.kind ? KIND_LABEL[x.kind] : '—'}</div>
          )}
          {x.kind === 'OTHER' && x.description && (
            <div className={`text-xs text-gray-500 ${showItem ? '' : 'pl-4'}`}>{x.description}</div>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{fmtPeriod(x.period)}</td>
        <td className="px-3 py-2">
          <div>{x.payee}</div>
          {x.iban && <div className="text-xs text-gray-400">{x.iban}</div>}
        </td>
        <td className="px-3 py-2 text-gray-600">{x.variableSymbol ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{fmtDate(x.dueDate)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{eur(x.amountCents)}</td>
        <td className="px-3 py-2">
          {x.bankTransaction ? (
            <span
              className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
              title={`Platba ${fmtDate(x.bankTransaction.date)} · ${eur(Math.abs(x.bankTransaction.amountCents))}${
                x.bankTransaction.counterpartyName ? ` · ${x.bankTransaction.counterpartyName}` : ''
              }`}
            >
              Spárované · {x.matchedBy === 'AUTO' ? 'auto' : 'ručne'} · {fmtDate(x.bankTransaction.date)}
            </span>
          ) : (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Nespárované</span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <div className="flex justify-end gap-3">
            {isMatched(x) ? (
              <button
                onClick={() => {
                  if (!confirm('Zrušiť spárovanie s platbou?')) return;
                  void act(() => api(`/finance/expenses/${x.id}/unmatch`, { method: 'POST' }));
                }}
                className="text-gray-500 hover:underline"
              >
                Zrušiť spárovanie
              </button>
            ) : (
              <button onClick={() => setMatching(x)} className="font-medium text-green-700 hover:underline">
                Spárovať ručne
              </button>
            )}
            <button onClick={() => setModal(x)} className="text-club-600 hover:underline">
              Upraviť
            </button>
            <button
              onClick={() => {
                if (!confirm(`Zmazať náklad pre „${x.payee}"?`)) return;
                void act(() => api(`/finance/expenses/${x.id}`, { method: 'DELETE' }));
              }}
              className="text-red-600 hover:underline"
            >
              Zmazať
            </button>
          </div>
        </td>
      </tr>
    );
  }

  function renderSection(sec: { key: string; name: string; rows: Expense[] }) {
    const sum = sec.rows.reduce((s, x) => s + x.amountCents, 0);
    const nMatched = sec.rows.filter(isMatched).length;
    const body: React.ReactNode[] = [];
    // položky s druhmi dostanú podhlavičku objektu
    const byItem = new Map<string, Expense[]>();
    const order: string[] = [];
    for (const x of sec.rows) {
      const k = x.costItem && x.costItem.hasKinds ? x.costItem.id : `row:${x.id}`;
      if (!byItem.has(k)) {
        byItem.set(k, []);
        order.push(k);
      }
      byItem.get(k)!.push(x);
    }
    for (const k of order) {
      const rows = byItem.get(k)!;
      if (k.startsWith('row:')) {
        body.push(renderRow(rows[0], true));
      } else {
        const itemSum = rows.reduce((s, x) => s + x.amountCents, 0);
        body.push(
          <tr key={`obj-${sec.key}-${k}`} className="bg-club-50/50">
            <td className="px-3 py-1.5 font-medium text-club-800" colSpan={5}>
              {rows[0].costItem?.name}
            </td>
            <td className="whitespace-nowrap px-3 py-1.5 text-right text-gray-600">{eur(itemSum)}</td>
            <td colSpan={2}></td>
          </tr>,
        );
        rows.forEach((x) => body.push(renderRow(x, false)));
      }
    }
    return (
      <tbody key={sec.key} className="divide-y divide-club-100 border-t border-club-100">
        <tr className="bg-club-50 font-semibold text-club-800">
          <td className="px-3 py-2" colSpan={5}>
            {sec.name}{' '}
            <span className="text-xs font-normal text-gray-500">
              {nMatched} z {sec.rows.length} spárovaných
            </span>
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-right">{eur(sum)}</td>
          <td colSpan={2}></td>
        </tr>
        {body}
      </tbody>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-club-800">Načítať výpis z účtu</h2>
            <p className="text-sm text-gray-600">Nahrajte výpis (.xls/.xlsx). Odchádzajúce platby sa načítajú ako náklady.</p>
            <p className="text-xs text-gray-500">
              Odchádzajúce platby sa spárujú s plánovanými nákladmi podľa variabilného symbolu, sumy a čísla účtu; nespárované
              odchádzajúce platby sa vytvoria ako nové uhradené náklady.
            </p>
          </div>
          <input ref={fileRef} type="file" accept=".xls,.xlsx" onChange={onFile} className="hidden" />
          <Button onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? 'Importujem…' : '⬆ Nahrať výpis'}
          </Button>
        </div>
        {importInfo && <p className="text-sm font-medium text-club-700">{importInfo}</p>}
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={labelCls}>Rok</label>
            <select value={year} onChange={(e) => setYear(e.target.value)} className={inputCls}>
              <option value="">Všetky</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Mesiac</label>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls}>
              <option value="">Všetky</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Skupina</label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputCls}>
              <option value="">Všetky</option>
              {structure.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Spárovanie</label>
            <select value={matched} onChange={(e) => setMatched(e.target.value)} className={inputCls}>
              <option value="">Všetky</option>
              <option value="1">Spárované</option>
              <option value="0">Nespárované</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setManage(true)}>
            Spravovať položky
          </Button>
          <Button onClick={() => setModal('new')}>+ Pridať náklad</Button>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="overflow-x-auto rounded-lg border border-club-100 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-club-50 text-left text-club-800">
            <tr>
              <th className="px-3 py-3">Položka / Druh</th>
              <th className="px-3 py-3">Obdobie</th>
              <th className="px-3 py-3">Dodávateľ</th>
              <th className="px-3 py-3">VS</th>
              <th className="px-3 py-3">Splatnosť</th>
              <th className="px-3 py-3 text-right">Suma</th>
              <th className="px-3 py-3">Spárovanie</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          {sections.map(renderSection)}
          {items.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  Žiadne náklady.
                </td>
              </tr>
            </tbody>
          )}
          {items.length > 0 && (
            <tfoot className="bg-club-50 font-semibold text-club-800">
              <tr>
                <td className="px-3 py-3" colSpan={5}>
                  Spolu ({items.length})
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">{eur(total)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {modal && (
        <ExpenseModal
          expense={modal === 'new' ? null : modal}
          structure={structure}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            void load();
          }}
        />
      )}
      {manage && (
        <ManageModal
          structure={structure}
          reload={async () => {
            await loadStructure();
            await load();
          }}
          onClose={() => setManage(false)}
        />
      )}
      {matching && (
        <MatchModal
          expense={matching}
          onClose={() => setMatching(null)}
          onDone={() => {
            setMatching(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ExpenseModal({
  expense,
  structure,
  onClose,
  onDone,
}: {
  expense: Expense | null;
  structure: CostGroup[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [groupId, setGroupId] = useState(expense ? (expense.costItem?.group.id ?? '') : (structure[0]?.id ?? ''));
  const [itemId, setItemId] = useState(expense?.costItem?.id ?? '');
  const [kind, setKind] = useState<Kind | ''>(expense?.kind ?? '');
  const [period, setPeriod] = useState(expense?.period ?? (expense ? '' : new Date().toISOString().slice(0, 7)));
  const [payee, setPayee] = useState(expense?.payee ?? '');
  const [amount, setAmount] = useState(expense ? (expense.amountCents / 100).toFixed(2) : '');
  const [vs, setVs] = useState(expense?.variableSymbol ?? '');
  const [dueDate, setDueDate] = useState(expense?.dueDate ? expense.dueDate.slice(0, 10) : '');
  const [iban, setIban] = useState(expense?.iban ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const group = structure.find((g) => g.id === groupId);
  const item = group?.items.find((i) => i.id === itemId);

  async function submit() {
    const amountCents = Math.round(parseFloat(amount.replace(',', '.')) * 100);
    if (!payee.trim()) return setError('Vyplňte dodávateľa.');
    if (!Number.isFinite(amountCents) || amountCents <= 0) return setError('Zadajte platnú sumu.');
    if (itemId && !/^\d{4}-\d{2}$/.test(period)) return setError('Zadajte obdobie.');
    if (item?.hasKinds && !kind) return setError('Vyberte druh (Nájomné / Ostatné náklady).');
    if (item?.hasKinds && kind === 'OTHER' && !description.trim()) return setError('Pri ostatných nákladoch vyplňte popis.');
    setBusy(true);
    setError(null);
    try {
      const body = {
        payee: payee.trim(),
        amountCents,
        variableSymbol: vs.trim() || undefined,
        dueDate: dueDate || undefined,
        iban: iban.replace(/\s+/g, '') || undefined,
        description: description.trim() || undefined,
        costItemId: itemId || undefined,
        kind: item?.hasKinds ? kind || null : null,
        period: itemId ? period : undefined,
      };
      if (expense) {
        await api(`/finance/expenses/${expense.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/finance/expenses', { method: 'POST', body: JSON.stringify(body) });
      }
      onDone();
    } catch (e) {
      setError(errMsg(e, 'Uloženie zlyhalo'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={expense ? 'Upraviť náklad' : 'Pridať náklad'}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Skupina</label>
            <select
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setItemId('');
                setKind('');
              }}
              className={inputCls}
            >
              <option value="">— Nezaradené —</option>
              {structure.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Objekt / Položka</label>
            <select
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                setKind('');
              }}
              className={inputCls}
              disabled={!group}
            >
              <option value="">—</option>
              {group?.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {item?.hasKinds && (
          <div>
            <label className={labelCls}>Druh</label>
            <div className="flex gap-2">
              {(['RENT', 'OTHER'] as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex-1 border px-3 py-2 text-sm font-medium ${
                    kind === k ? 'border-club-600 bg-club-600 text-white' : 'border-club-100 text-gray-500 hover:text-club-700'
                  }`}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className={labelCls}>
            {item?.hasKinds && kind === 'OTHER' ? 'Popis (povinný)' : 'Popis'}
          </label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Obdobie{itemId ? '' : ' (voliteľné)'}</label>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Suma (€)</label>
            <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Dodávateľ</label>
          <input value={payee} onChange={(e) => setPayee(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Variabilný symbol</label>
            <input value={vs} onChange={(e) => setVs(e.target.value)} className={inputCls} inputMode="numeric" />
          </div>
          <div>
            <label className={labelCls}>Splatnosť</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Číslo účtu (IBAN)</label>
          <input value={iban} onChange={(e) => setIban(e.target.value)} className={inputCls} placeholder="SK…" />
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

function ManageModal({
  structure,
  reload,
  onClose,
}: {
  structure: CostGroup[];
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState('');
  const [newItem, setNewItem] = useState<Record<string, string>>({});

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      setError(null);
      await reload();
    } catch (e) {
      setError(errMsg(e));
    }
  }
  const json = (o: unknown) => JSON.stringify(o);

  return (
    <Modal open onClose={onClose} title="Spravovať položky" wide>
      <div className="space-y-4">
        <ErrorText>{error}</ErrorText>
        {structure.map((g) => (
          <div key={g.id} className="space-y-2 border border-club-100 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-club-800">{g.name}</span>
              <div className="flex gap-3 text-sm">
                <button
                  className="text-club-600 hover:underline"
                  onClick={() => {
                    const name = prompt('Nový názov skupiny', g.name)?.trim();
                    if (name && name !== g.name)
                      void run(() => api(`/finance/cost-groups/${g.id}`, { method: 'PATCH', body: json({ name }) }));
                  }}
                >
                  Premenovať
                </button>
                <button
                  className="text-red-600 hover:underline"
                  onClick={() => {
                    if (!confirm(`Zmazať skupinu „${g.name}"?`)) return;
                    void run(() => api(`/finance/cost-groups/${g.id}`, { method: 'DELETE' }));
                  }}
                >
                  Zmazať
                </button>
              </div>
            </div>
            <ul className="space-y-1">
              {g.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="pl-3">{i.name}</span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={i.hasKinds}
                        onChange={(e) =>
                          void run(() =>
                            api(`/finance/cost-items/${i.id}`, { method: 'PATCH', body: json({ hasKinds: e.target.checked }) }),
                          )
                        }
                      />
                      Druhy (Nájomné/Ostatné)
                    </label>
                    <button
                      className="text-club-600 hover:underline"
                      onClick={() => {
                        const name = prompt('Nový názov položky', i.name)?.trim();
                        if (name && name !== i.name)
                          void run(() => api(`/finance/cost-items/${i.id}`, { method: 'PATCH', body: json({ name }) }));
                      }}
                    >
                      Premenovať
                    </button>
                    <button
                      className="text-red-600 hover:underline"
                      onClick={() => {
                        if (!confirm(`Zmazať položku „${i.name}"?`)) return;
                        void run(() => api(`/finance/cost-items/${i.id}`, { method: 'DELETE' }));
                      }}
                    >
                      Zmazať
                    </button>
                  </div>
                </li>
              ))}
              {g.items.length === 0 && <li className="pl-3 text-sm text-gray-500">Žiadne položky.</li>}
            </ul>
            <div className="flex gap-2">
              <input
                value={newItem[g.id] ?? ''}
                onChange={(e) => setNewItem({ ...newItem, [g.id]: e.target.value })}
                className={inputCls}
                placeholder="Nová položka / objekt"
              />
              <Button
                variant="ghost"
                onClick={() => {
                  const name = (newItem[g.id] ?? '').trim();
                  if (!name) return;
                  void run(async () => {
                    await api('/finance/cost-items', { method: 'POST', body: json({ groupId: g.id, name }) });
                    setNewItem((s) => ({ ...s, [g.id]: '' }));
                  });
                }}
              >
                Pridať
              </Button>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} className={inputCls} placeholder="Nová skupina" />
          <Button
            onClick={() => {
              const name = newGroup.trim();
              if (!name) return;
              void run(async () => {
                await api('/finance/cost-groups', { method: 'POST', body: json({ name }) });
                setNewGroup('');
              });
            }}
          >
            Pridať skupinu
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Zavrieť
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MatchModal({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [unmatched, setUnmatched] = useState(true);
  const [rows, setRows] = useState<Debit[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams();
    if (dq) qs.set('q', dq);
    qs.set('amount', String(expense.amountCents));
    if (unmatched) qs.set('unmatched', '1');
    api<Debit[]>(`/finance/bank/debits?${qs.toString()}`)
      .then((r) => {
        if (!cancelled) {
          setRows(Array.isArray(r) ? r : []);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e, 'Načítanie zlyhalo'));
      });
    return () => {
      cancelled = true;
    };
  }, [dq, unmatched, expense.amountCents]);

  async function submit() {
    if (!sel) return;
    setBusy(true);
    setError(null);
    const post = (force: boolean) =>
      api(`/finance/expenses/${expense.id}/match`, {
        method: 'POST',
        body: JSON.stringify(force ? { bankTransactionId: sel, force: true } : { bankTransactionId: sel }),
      });
    try {
      try {
        await post(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.body.code === 'AMOUNT_MISMATCH') {
          if (!confirm(`${e.message}\n\nNapriek tomu spárovať?`)) {
            setBusy(false);
            return;
          }
          await post(true);
        } else {
          throw e;
        }
      }
      onDone();
    } catch (e) {
      setError(errMsg(e, 'Spárovanie zlyhalo'));
      setBusy(false);
    }
  }

  const title = [expense.costItem?.name, expense.kind ? KIND_LABEL[expense.kind] : null, fmtPeriod(expense.period)]
    .filter((x) => x && x !== '—')
    .join(' · ');

  return (
    <Modal open onClose={onClose} title="Spárovať ručne" wide>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          {title || expense.payee} · <span className="font-semibold">{eur(expense.amountCents)}</span> · {expense.payee}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={`${inputCls} max-w-xs`}
            placeholder="Hľadať (príjemca, VS, správa)…"
          />
          <label className="flex items-center gap-1 text-sm text-gray-600">
            <input type="checkbox" checked={unmatched} onChange={(e) => setUnmatched(e.target.checked)} />
            Len nespárované
          </label>
        </div>
        <div className="max-h-80 overflow-auto border border-club-100">
          <table className="w-full text-sm">
            <thead className="bg-club-50 text-left text-club-800">
              <tr>
                <th className="px-2 py-2"></th>
                <th className="px-2 py-2">Dátum</th>
                <th className="px-2 py-2">Príjemca</th>
                <th className="px-2 py-2">VS</th>
                <th className="px-2 py-2">Správa</th>
                <th className="px-2 py-2 text-right">Suma</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-club-100">
              {rows.map((d) => {
                const equal = Math.abs(d.amountCents) === expense.amountCents;
                return (
                  <tr
                    key={d.id}
                    onClick={() => setSel(d.id)}
                    className={`cursor-pointer ${equal ? 'bg-green-100/60' : ''} ${sel === d.id ? 'outline outline-1 outline-club-600' : ''}`}
                  >
                    <td className="px-2 py-2">
                      <input type="radio" name="debit" checked={sel === d.id} onChange={() => setSel(d.id)} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{fmtDate(d.date)}</td>
                    <td className="px-2 py-2">{d.counterpartyName ?? '—'}</td>
                    <td className="px-2 py-2">{d.variableSymbol ?? '—'}</td>
                    <td className="px-2 py-2 text-gray-600">{d.message ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{eur(Math.abs(d.amountCents))}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                    Žiadne odchádzajúce platby.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Zrušiť
          </Button>
          <Button onClick={submit} disabled={busy || !sel}>
            {busy ? 'Spárovávam…' : 'Spárovať'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
