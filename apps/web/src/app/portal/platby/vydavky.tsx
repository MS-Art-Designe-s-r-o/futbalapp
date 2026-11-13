'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiUpload } from '@/lib/api';
import { Button, Card, ErrorText, Modal, inputCls, labelCls } from '@/components/ui';

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
  createdAt: string;
}

const eur = (c: number) => `${(c / 100).toFixed(2)} €`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('sk-SK') : '—');

export default function VydavkyTab() {
  const now = new Date();
  const [status, setStatus] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [items, setItems] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Expense | 'new' | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (year) qs.set('year', year);
      if (month) qs.set('month', month.padStart(2, '0'));
      const list = await api<Expense[]>(`/finance/expenses?${qs.toString()}`);
      setItems(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
    }
  }, [status, year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
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
      setError(err instanceof Error ? err.message : 'Import zlyhal');
    } finally {
      setImporting(false);
    }
  }

  const total = items.reduce((s, x) => s + x.amountCents, 0);
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-club-800">Načítať výpis z účtu</h2>
            <p className="text-sm text-gray-600">Nahrajte výpis (.xls/.xlsx). Odchádzajúce platby sa načítajú ako výdavky.</p>
            <p className="text-xs text-gray-500">
              Výdavky zo výpisu sa spárujú s plánovanými výdavkami podľa variabilného symbolu, sumy a čísla účtu; nespárované
              odchádzajúce platby sa vytvoria ako nové uhradené výdavky.
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
            <label className={labelCls}>Stav</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              <option value="">Všetky</option>
              <option value="PLANNED">Čaká</option>
              <option value="PAID">Uhradené</option>
            </select>
          </div>
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
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button onClick={() => setModal('new')}>+ Pridať výdavok</Button>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="overflow-x-auto rounded-lg border border-club-100 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-club-50 text-left text-club-800">
            <tr>
              <th className="px-3 py-3">Komu</th>
              <th className="px-3 py-3">Poznámka</th>
              <th className="px-3 py-3">VS</th>
              <th className="px-3 py-3">Splatnosť</th>
              <th className="px-3 py-3 text-right">Suma</th>
              <th className="px-3 py-3">Stav</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-club-100">
            {items.map((x) => (
              <tr key={x.id} className="align-top">
                <td className="px-3 py-3">
                  <div className="font-medium">{x.payee}</div>
                  {x.iban && <div className="text-xs text-gray-400">{x.iban}</div>}
                </td>
                <td className="px-3 py-3 text-gray-600">{x.description ?? '—'}</td>
                <td className="px-3 py-3 text-gray-600">{x.variableSymbol ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-3 text-gray-600">{fmtDate(x.dueDate)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">{eur(x.amountCents)}</td>
                <td className="px-3 py-3">
                  {x.status === 'PAID' ? (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      Uhradené{x.paidAt ? ` ${fmtDate(x.paidAt)}` : ''}
                    </span>
                  ) : (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Čaká</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  <div className="flex justify-end gap-3">
                    {x.status !== 'PAID' && (
                      <button
                        onClick={() => act(() => api(`/finance/expenses/${x.id}/pay`, { method: 'POST' }))}
                        className="font-medium text-green-700 hover:underline"
                      >
                        Označiť ako uhradený
                      </button>
                    )}
                    <button onClick={() => setModal(x)} className="text-club-600 hover:underline">
                      Upraviť
                    </button>
                    <button
                      onClick={() => {
                        if (!confirm(`Zmazať výdavok pre „${x.payee}"?`)) return;
                        void act(() => api(`/finance/expenses/${x.id}`, { method: 'DELETE' }));
                      }}
                      className="text-red-600 hover:underline"
                    >
                      Zmazať
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  Žiadne výdavky.
                </td>
              </tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot className="bg-club-50 font-semibold text-club-800">
              <tr>
                <td className="px-3 py-3" colSpan={4}>
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
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ExpenseModal({
  expense,
  onClose,
  onDone,
}: {
  expense: Expense | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [payee, setPayee] = useState(expense?.payee ?? '');
  const [amount, setAmount] = useState(expense ? (expense.amountCents / 100).toFixed(2) : '');
  const [vs, setVs] = useState(expense?.variableSymbol ?? '');
  const [dueDate, setDueDate] = useState(expense?.dueDate ? expense.dueDate.slice(0, 10) : '');
  const [iban, setIban] = useState(expense?.iban ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const amountCents = Math.round(parseFloat(amount.replace(',', '.')) * 100);
    if (!payee.trim()) return setError('Vyplňte, komu sa platí.');
    if (!Number.isFinite(amountCents) || amountCents <= 0) return setError('Zadajte platnú sumu.');
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
      };
      if (expense) {
        await api(`/finance/expenses/${expense.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/finance/expenses', { method: 'POST', body: JSON.stringify(body) });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={expense ? 'Upraviť výdavok' : 'Pridať výdavok'}>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Komu</label>
          <input value={payee} onChange={(e) => setPayee(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Suma (€)</label>
            <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Variabilný symbol</label>
            <input value={vs} onChange={(e) => setVs(e.target.value)} className={inputCls} inputMode="numeric" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Splatnosť</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Číslo účtu (IBAN)</label>
            <input value={iban} onChange={(e) => setIban(e.target.value)} className={inputCls} placeholder="SK…" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Poznámka</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
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
