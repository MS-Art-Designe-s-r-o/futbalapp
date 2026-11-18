'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button, ErrorText, Modal, inputCls, labelCls } from '@/components/ui';

interface SendRow {
  obligationId: string;
  memberId: string;
  name: string;
  emails: string[];
  amountCents: number;
  paidCents: number;
  variableSymbol: string | null;
  dueDate: string | null;
  periodLabel: string | null;
  emailedAt: string | null;
}
interface SendPreview {
  plan: { id: string; name: string; period: string };
  periodLabel: string | null;
  accountConfigured: boolean;
  rows: SendRow[];
  sampleHtml: string | null;
  availablePeriods: string[];
}
interface SendResult {
  membersNotified: number;
  emailsSent: number;
  skippedNoEmail: string[];
  emailError: string | null;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString('sk-SK');

export function SendFeeModal({ plan, onClose }: { plan: { id: string; name: string }; onClose: () => void }) {
  const [data, setData] = useState<SendPreview | null>(null);
  const [rows, setRows] = useState<SendRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(
    async (p: string) => {
      setError(null);
      try {
        const qs = p ? `?period=${encodeURIComponent(p)}` : '';
        const r = await api<SendPreview>(`/finance/fee-plans/${plan.id}/send-preview${qs}`);
        setData(r);
        setRows(r.rows);
        setSelected(new Set(r.rows.filter((x) => x.emails.length > 0 && !x.emailedAt).map((x) => x.obligationId)));
        if (r.periodLabel) setPeriod(r.periodLabel);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
      }
    },
    [plan.id],
  );

  useEffect(() => {
    void load('');
  }, [load]);

  const selectable = rows.filter((r) => r.emails.length > 0);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.obligationId));

  function toggle(id: string) {
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function remove(id: string) {
    setRows((cur) => cur.filter((r) => r.obligationId !== id));
    setSelected((cur) => {
      const n = new Set(cur);
      n.delete(id);
      return n;
    });
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<SendResult>(`/finance/fee-plans/${plan.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ obligationIds: Array.from(selected) }),
      });
      setResult(r);
      await load(period);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Odoslanie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open wide onClose={onClose} title={`Odoslať predpis e-mailom: ${plan.name}`}>
      <div className="space-y-3">
        <ErrorText>{error}</ErrorText>
        {result && (
          <div className="space-y-1 text-sm">
            <p className="font-medium text-club-700">
              Odoslané {result.membersNotified} rodinám/hráčom ({result.emailsSent} e-mailov)
            </p>
            {result.skippedNoEmail.length > 0 && (
              <p className="text-gray-600">Bez e-mailu: {result.skippedNoEmail.join(', ')}</p>
            )}
            {result.emailError && <p className="text-red-600">{result.emailError}</p>}
          </div>
        )}
        {!data && !error && <p className="text-sm text-gray-500">Načítavam…</p>}
        {data && (
          <>
            {!data.accountConfigured && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Nie je nastavené číslo účtu klubu (CLUB_IBAN v infra/.env na serveri). E-maily odídu bez čísla účtu.
              </p>
            )}
            {data.plan.period === 'MONTHLY' && data.availablePeriods.length > 0 && (
              <label className="block">
                <span className={labelCls}>Obdobie</span>
                <select
                  className={inputCls}
                  value={period}
                  onChange={(e) => {
                    setPeriod(e.target.value);
                    setResult(null);
                    void load(e.target.value);
                  }}
                >
                  {data.availablePeriods.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {rows.length === 0 && <p className="text-sm text-gray-500">Žiadne povinnosti na odoslanie.</p>}
            {rows.length > 0 && (
              <>
                <div className="flex gap-3 text-sm">
                  <button
                    onClick={() =>
                      setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.obligationId)))
                    }
                    className="text-club-600 hover:underline"
                  >
                    {allSelected ? 'Odznačiť všetkých' : 'Označiť všetkých'}
                  </button>
                </div>
                <div className="max-h-96 overflow-auto rounded-md border border-club-100">
                  <table className="w-full text-sm">
                    <thead className="bg-club-50 text-left text-club-800">
                      <tr>
                        <th className="px-2 py-2"></th>
                        <th className="px-2 py-2">Hráč</th>
                        <th className="px-2 py-2">E-mail adresy</th>
                        <th className="px-2 py-2 text-right">Suma</th>
                        <th className="px-2 py-2">VS</th>
                        <th className="px-2 py-2">Splatnosť</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-club-100">
                      {rows.map((r) => (
                        <tr key={r.obligationId} className="align-top">
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              disabled={r.emails.length === 0}
                              checked={selected.has(r.obligationId)}
                              onChange={() => toggle(r.obligationId)}
                            />
                          </td>
                          <td className="px-2 py-2 font-medium">
                            {r.name}
                            {r.emailedAt && (
                              <span className="ml-2 rounded-full bg-club-50 px-2 py-0.5 text-xs font-normal text-club-700">
                                Odoslané {fmtDate(r.emailedAt)}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-xs text-gray-600">
                            {r.emails.length > 0 ? r.emails.join(', ') : <span className="text-red-600">bez e-mailu</span>}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right">{(r.amountCents / 100).toFixed(2)} €</td>
                          <td className="px-2 py-2">{r.variableSymbol ?? '—'}</td>
                          <td className="whitespace-nowrap px-2 py-2">{r.dueDate ? fmtDate(r.dueDate) : '—'}</td>
                          <td className="px-2 py-2 text-right">
                            <button onClick={() => remove(r.obligationId)} className="text-gray-500 hover:underline">
                              Vyradiť
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {data.sampleHtml && (
              <div>
                <button onClick={() => setShowPreview((v) => !v)} className="text-sm text-club-600 hover:underline">
                  {showPreview ? '▾' : '▸'} Náhľad e-mailu
                </button>
                {showPreview && (
                  <iframe
                    title="Náhľad e-mailu"
                    srcDoc={data.sampleHtml}
                    sandbox=""
                    className="mt-2 h-80 w-full rounded-md border border-club-100 bg-white"
                  />
                )}
              </div>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Zavrieť
          </Button>
          {rows.length > 0 && (
            <Button onClick={send} disabled={busy || selected.size === 0}>
              {busy ? 'Odosielam…' : `Odoslať (${selected.size})`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
