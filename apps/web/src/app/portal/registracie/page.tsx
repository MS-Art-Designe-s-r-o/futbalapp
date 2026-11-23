'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { Button, Card, ErrorText, Modal, inputCls, labelCls } from '@/components/ui';

interface RegRequest {
  id: string;
  applicantType: string;
  childFirstName: string | null;
  childLastName: string | null;
  childBirthDate: string | null;
  birthNumber: string | null;
  sex: string | null;
  playerRegistrationNumber: string | null;
  originCountry: string | null;
  addressStreet: string | null;
  addressHouseNumber: string | null;
  addressZip: string | null;
  addressCity: string | null;
  playerEmail: string | null;
  healthNotes: string | null;
  parentFirstName: string | null;
  parentLastName: string | null;
  parentEmail: string | null;
  parentPhone: string | null;
  parentRelation: string | null;
  parentChildrenNote: string | null;
  consentGdpr: boolean;
  consentPhotos: boolean;
  note: string | null;
  createdAt: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedAt?: string | null;
  createdMemberId?: string | null;
  infoRequestedAt?: string | null;
  infoReceivedAt?: string | null;
  infoMotherClub?: string | null;
  infoGuestClub?: string | null;
  infoClubAffiliation?: string | null;
  requestedTeamId?: string | null;
  hasPhoto?: boolean | null;
}

interface InfoPreview {
  to: string | null;
  subject: string;
  html: string;
  link: string;
}

interface TeamLite {
  id: string;
  name: string;
}

interface ApprovedResult {
  player: {
    firstName: string;
    lastName: string;
    reused?: boolean;
    account: { email: string; tempPassword: string | null } | null;
  } | null;
  parent: { email: string; tempPassword: string | null; accountCreated: boolean } | null;
  linkedChildren?: Array<{ id: string; firstName: string; lastName: string }>;
}

interface PlayerOption {
  id: string;
  firstName: string;
  lastName: string;
  memberships: Array<{ team: { name: string } }>;
}

const RELATION_LABELS: Record<string, string> = {
  MOTHER: 'matka',
  FATHER: 'otec',
  GUARDIAN: 'zástupca',
  RELATIVE: 'príbuzný',
};

/** Odstráni diakritiku a zjednotí veľkosť písmen — pre vyhľadávanie. */
function stripDia(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Čaká', cls: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'Schválená', cls: 'bg-green-100 text-green-800' },
  REJECTED: { label: 'Zamietnutá', cls: 'bg-red-100 text-red-800' },
};

/** História registrácií — schválené / zamietnuté / všetky, s vyhľadávaním. */
function RegistrationHistory() {
  const [filter, setFilter] = useState<'ALL' | 'APPROVED' | 'REJECTED'>('ALL');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<RegRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<Array<{ id: string; name: string }>>('/seasons/teams').then(setTeams).catch(() => {});
  }, []);

  async function createChild(r: RegRequest) {
    setBusyId(r.id);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ member: { firstName: string; lastName: string; memberships: Array<{ team: { name: string } }> } | null; linkedParent: boolean }>(
        `/registration/${r.id}/create-child`,
        { method: 'POST' },
      );
      const team = res.member?.memberships[0]?.team.name;
      setNotice(
        `Člen ${res.member?.firstName ?? ''} ${res.member?.lastName ?? ''} vytvorený${team ? ` (${team})` : ''}${res.linkedParent ? ', priradený rodičovi' : ', rodič zatiaľ nemá konto'}.`,
      );
      setRows((prev) => prev?.map((x) => (x.id === r.id ? { ...x, createdMemberId: res.member ? 'x' : x.createdMemberId } : x)) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vytvorenie zlyhalo');
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (filter !== 'ALL') params.set('status', filter);
      if (q.trim()) params.set('q', q.trim());
      api<RegRequest[]>(`/registration/history?${params}`)
        .then((r) => {
          setRows(r.filter((x) => x.status !== 'PENDING'));
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Načítanie zlyhalo'));
    }, 250);
    return () => clearTimeout(t);
  }, [filter, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['ALL', 'Všetky'],
            ['APPROVED', 'Schválené'],
            ['REJECTED', 'Zamietnuté'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-md px-3 py-1.5 text-sm ${filter === k ? 'bg-club-600 text-white' : 'bg-club-50 text-club-700'}`}
          >
            {label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Hľadať meno alebo e-mail…"
          className={`${inputCls} ml-auto max-w-xs`}
        />
      </div>
      <ErrorText>{error}</ErrorText>
      {notice && <p className="text-sm text-green-700">{notice}</p>}
      {rows && rows.length === 0 && !error && <Card className="text-sm text-gray-500">Žiadne registrácie.</Card>}
      <div className="space-y-2">
        {(rows ?? []).map((r) => {
          const st = STATUS_LABEL[r.status ?? 'PENDING']!;
          const who =
            r.applicantType === 'PARENT'
              ? `${r.parentFirstName ?? ''} ${r.parentLastName ?? ''}`.trim()
              : `${r.childFirstName ?? ''} ${r.childLastName ?? ''}`.trim();
          return (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-base font-semibold text-club-900">
                    {who || '—'}{' '}
                    <span className="rounded bg-club-100 px-1.5 py-0.5 text-xs font-normal text-club-700">
                      {r.applicantType === 'PARENT' ? 'konto rodiča' : r.applicantType === 'ADULT' ? 'dospelý hráč' : 'dieťa'}
                    </span>
                  </p>
                  {r.applicantType !== 'PARENT' && r.parentFirstName && (
                    <p className="text-gray-600">
                      Rodič: {r.parentFirstName} {r.parentLastName}
                    </p>
                  )}
                  {(r.parentEmail || r.playerEmail) && (
                    <p className="text-gray-600">{[r.parentEmail, r.parentPhone, r.playerEmail].filter(Boolean).join(' · ')}</p>
                  )}
                  <p className="text-xs text-gray-400">
                    Prijaté {new Date(r.createdAt).toLocaleDateString('sk-SK')}
                    {r.reviewedAt ? ` · vybavené ${new Date(r.reviewedAt).toLocaleDateString('sk-SK')}` : ''}
                    {r.createdMemberId ? ' · člen vytvorený' : ''}
                  </p>
                  {r.applicantType !== 'ADULT' && (r.infoReceivedAt || (r.applicantType === 'CHILD' && r.childFirstName)) && (
                    <div className="mt-1 rounded bg-club-50 p-2 text-xs text-gray-700">
                      <p className="font-semibold text-club-800">
                        Údaje o dieťati{r.infoReceivedAt ? ` (doplnené ${new Date(r.infoReceivedAt).toLocaleDateString('sk-SK')})` : ''}
                      </p>
                      <p>
                        {r.childFirstName} {r.childLastName}
                        {r.childBirthDate ? ` · nar. ${new Date(r.childBirthDate).toLocaleDateString('sk-SK')}` : ''}
                        {r.playerRegistrationNumber ? ` · reg. č. ${r.playerRegistrationNumber}` : ''}
                      </p>
                      <p>
                        Skupina: {r.requestedTeamId ? teams.find((t) => t.id === r.requestedTeamId)?.name ?? r.requestedTeamId : '—'}
                        {r.infoMotherClub ? ` · materský klub: ${r.infoMotherClub}` : ''}
                        {r.infoGuestClub ? ` · hosťujúci: ${r.infoGuestClub}` : ''}
                        {r.infoClubAffiliation ? ` · príslušnosť: ${r.infoClubAffiliation}` : ''}
                      </p>
                    </div>
                  )}
                  {r.applicantType === 'PARENT' && r.infoReceivedAt && !r.createdMemberId && (
                    <div className="mt-2">
                      <Button onClick={() => void createChild(r)} disabled={busyId === r.id}>
                        {busyId === r.id ? 'Vytváram…' : 'Vytvoriť člena z týchto údajov'}
                      </Button>
                    </div>
                  )}
                </div>
                <span className={`rounded px-2 py-1 text-xs font-medium ${st.cls}`}>{st.label}</span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function RegistrationsPage() {
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [requests, setRequests] = useState<RegRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approved, setApproved] = useState<ApprovedResult | null>(null);
  const [detail, setDetail] = useState<RegRequest | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests(await api<RegRequest[]>('/registration/pending'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, action: 'approve' | 'reject', childMemberIds?: string[]) {
    setBusyId(id);
    setError(null);
    try {
      if (action === 'approve') {
        const res = await api<ApprovedResult>(`/registration/${id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ childMemberIds: childMemberIds ?? [] }),
        });
        setDetail(null);
        if (res.player?.account?.tempPassword || res.parent?.tempPassword || res.player?.reused || res.linkedChildren?.length) {
          setApproved(res);
        }
      } else {
        await api(`/registration/${id}/reject`, { method: 'POST' });
        setDetail(null);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Akcia zlyhala');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-club-900">Registrácie</h1>
      <div className="flex gap-2 border-b border-club-100">
        {(
          [
            ['pending', `Na schválenie${requests.length ? ` (${requests.length})` : ''}`],
            ['history', 'Doterajšie registrácie'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === k ? 'border-b-2 border-club-600 text-club-800' : 'text-gray-500 hover:text-club-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'history' && <RegistrationHistory />}
      {tab === 'pending' && (<>
      <ErrorText>{error}</ErrorText>
      {approved && <ApprovedBanner result={approved} onClose={() => setApproved(null)} />}
      {requests.length === 0 && !error && (
        <Card className="text-sm text-gray-500">Žiadne čakajúce prihlášky. 🎉</Card>
      )}
      <div className="space-y-3">
        {requests.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1 text-sm">
                <p className="text-base font-semibold text-club-900">
                  {r.applicantType === 'PARENT' ? (
                    <>
                      {r.parentFirstName} {r.parentLastName}{' '}
                      <span className="rounded bg-club-100 px-1.5 py-0.5 text-xs font-normal text-club-700">konto rodiča</span>
                    </>
                  ) : (
                    <>
                      {r.childFirstName} {r.childLastName}{' '}
                      {r.childBirthDate && (
                        <span className="font-normal text-gray-500">
                          ({new Date(r.childBirthDate).toLocaleDateString('sk-SK')})
                        </span>
                      )}
                      {r.applicantType === 'ADULT' && (
                        <span className="ml-1 rounded bg-club-100 px-1.5 py-0.5 text-xs font-normal text-club-700">dospelý hráč</span>
                      )}
                    </>
                  )}
                </p>
                {r.parentFirstName && (
                  <p className="text-gray-600">
                    Rodič: {r.parentFirstName} {r.parentLastName}
                    {r.parentRelation ? ` · ${RELATION_LABELS[r.parentRelation] ?? r.parentRelation}` : ''}
                  </p>
                )}
                {(r.parentEmail || r.parentPhone) && (
                  <p className="text-gray-600">{[r.parentEmail, r.parentPhone].filter(Boolean).join(' · ')}</p>
                )}
                {r.parentChildrenNote && <p className="text-gray-600">Deti (členovia): {r.parentChildrenNote}</p>}
                {(r.infoRequestedAt || r.infoReceivedAt) && (
                  <p className="text-xs">
                    {r.infoReceivedAt ? (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">Údaje doplnené</span>
                    ) : (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Údaje vyžiadané</span>
                    )}
                  </p>
                )}
                <p className="text-xs text-gray-400">
                  Fotosúhlas: {r.consentPhotos ? 'áno' : 'nie'} · prijaté{' '}
                  {new Date(r.createdAt).toLocaleDateString('sk-SK')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" disabled={busyId === r.id} onClick={() => setDetail(r)}>
                  Detail / priradiť
                </Button>
                <Button variant="danger" disabled={busyId === r.id} onClick={() => decide(r.id, 'reject')}>
                  Zamietnuť
                </Button>
                <Button disabled={busyId === r.id} onClick={() => decide(r.id, 'approve')}>
                  {busyId === r.id ? '…' : 'Schváliť'}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-sm text-gray-500">
        Po schválení sa vytvorí člen, rodičovský účet a hráč sa zaradí do družstva podľa ročníka. Ak je hráč už členom
        (import z futbalnetu alebo skoršia registrácia), priradí sa k rodičovi bez vytvorenia duplikátu.
      </p>
      </>)}

      {detail && (
        <RegDetailModal
          request={detail}
          busy={busyId === detail.id}
          onChanged={load}
          onClose={() => setDetail(null)}
          onApprove={(childMemberIds) => decide(detail.id, 'approve', childMemberIds)}
          onReject={() => decide(detail.id, 'reject')}
        />
      )}
    </div>
  );
}

function ApprovedBanner({ result, onClose }: { result: ApprovedResult; onClose: () => void }) {
  return (
    <Card className="border-club-300 bg-club-50">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 text-sm text-gray-700">
          <p>
            Schválené
            {result.player ? (
              <>
                : <strong>{result.player.firstName} {result.player.lastName}</strong>
                {result.player.reused ? ' (už bol členom — priradený k rodičovi)' : ''}
              </>
            ) : (
              ' konto rodiča'
            )}
            .
          </p>
          {result.linkedChildren && result.linkedChildren.length > 0 && (
            <p>
              Priradené deti:{' '}
              <strong>{result.linkedChildren.map((c) => `${c.firstName} ${c.lastName}`).join(', ')}</strong>
            </p>
          )}
          {(result.player?.account?.tempPassword || result.parent?.tempPassword) && (
            <p>Odovzdajte dočasné heslá — po prihlásení sa dajú zmeniť:</p>
          )}
          {result.player?.account?.tempPassword && (
            <p>
              Hráč <strong>{result.player.account.email}</strong>:{' '}
              <code className="font-bold tracking-wider text-club-800">{result.player.account.tempPassword}</code>
            </p>
          )}
          {result.parent?.tempPassword && (
            <p>
              Rodič <strong>{result.parent.email}</strong>:{' '}
              <code className="font-bold tracking-wider text-club-800">{result.parent.tempPassword}</code>
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-sm text-club-600 hover:underline">
          Zavrieť
        </button>
      </div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-800">{value}</dd>
    </div>
  );
}

function RegDetailModal({
  request,
  busy,
  onChanged,
  onClose,
  onApprove,
  onReject,
}: {
  request: RegRequest;
  busy: boolean;
  onChanged: () => void | Promise<void>;
  onClose: () => void;
  onApprove: (childMemberIds: string[]) => void;
  onReject: () => void;
}) {
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [requestedAt, setRequestedAt] = useState<string | null>(request.infoRequestedAt ?? null);

  const isParentType = request.applicantType === 'PARENT';
  const address = [
    [request.addressStreet, request.addressHouseNumber].filter(Boolean).join(' '),
    [request.addressZip, request.addressCity].filter(Boolean).join(' '),
  ]
    .filter((s) => s.trim().length > 0)
    .join(', ');

  useEffect(() => {
    if (request.requestedTeamId) {
      api<TeamLite[]>('/seasons/teams')
        .then(setTeams)
        .catch(() => {});
    }
  }, [request.requestedTeamId]);

  useEffect(() => {
    api<PlayerOption[]>('/members?role=PLAYER')
      .then(setPlayers)
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = stripDia(search).trim();
    const list = q ? players.filter((p) => stripDia(p.lastName).includes(q)) : players;
    return list
      .slice()
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'sk') || a.firstName.localeCompare(b.firstName, 'sk'));
  }, [players, search]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Modal open onClose={onClose} title="Detail prihlášky">
      <div className="space-y-4">
        <span className="inline-block rounded bg-club-100 px-2 py-0.5 text-xs font-medium text-club-700">
          {isParentType ? 'Konto rodiča (deti sú už členmi)' : request.applicantType === 'ADULT' ? 'Dospelý hráč' : 'Dieťa s rodičom'}
        </span>

        {!isParentType && (
          <section>
            <h3 className="mb-1 font-semibold text-club-800">Hráč</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Field label="Meno a priezvisko" value={`${request.childFirstName ?? ''} ${request.childLastName ?? ''}`.trim()} />
              <Field
                label="Dátum narodenia"
                value={request.childBirthDate ? new Date(request.childBirthDate).toLocaleDateString('sk-SK') : null}
              />
              <Field label="Rodné číslo" value={request.birthNumber} />
              <Field label="Pohlavie" value={request.sex === 'M' ? 'muž' : request.sex === 'F' ? 'žena' : null} />
              <Field label="Registračné číslo" value={request.playerRegistrationNumber} />
              <Field label="Krajina pôvodu" value={request.originCountry} />
              <Field label="Vlastný e-mail (hráč)" value={request.playerEmail} />
              {address && <Field label="Adresa" value={address} />}
              {request.healthNotes && <Field label="Zdravotné poznámky" value={request.healthNotes} />}
            </dl>
          </section>
        )}

        {(request.parentFirstName || request.parentEmail) && (
          <section>
            <h3 className="mb-1 font-semibold text-club-800">Rodič</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Field label="Meno a priezvisko" value={`${request.parentFirstName ?? ''} ${request.parentLastName ?? ''}`.trim()} />
              <Field
                label="Vzťah"
                value={request.parentRelation ? RELATION_LABELS[request.parentRelation] ?? request.parentRelation : null}
              />
              <Field label="E-mail" value={request.parentEmail} />
              <Field label="Telefón" value={request.parentPhone} />
              {request.parentChildrenNote && <Field label="Deti (už členovia)" value={request.parentChildrenNote} />}
            </dl>
          </section>
        )}

        <section>
          <h3 className="mb-1 font-semibold text-club-800">Súhlasy a poznámky</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="GDPR súhlas" value={request.consentGdpr ? 'áno' : 'nie'} />
            <Field label="Fotosúhlas" value={request.consentPhotos ? 'áno' : 'nie'} />
            {request.note && <Field label="Poznámka" value={request.note} />}
            <Field label="Prijaté" value={new Date(request.createdAt).toLocaleString('sk-SK')} />
          </dl>
        </section>

        {(request.parentEmail || request.applicantType === 'PARENT' || request.applicantType === 'CHILD') && (
          <section className="rounded-md border border-club-100 p-3">
            <h3 className="mb-1 font-semibold text-club-800">Údaje o hráčovi od rodiča</h3>
            <div className="mb-2 flex flex-wrap gap-2 text-xs">
              {requestedAt && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                  Údaje vyžiadané {new Date(requestedAt).toLocaleDateString('sk-SK')}
                </span>
              )}
              {request.infoReceivedAt && (
                <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">
                  Údaje doplnené {new Date(request.infoReceivedAt).toLocaleDateString('sk-SK')}
                </span>
              )}
            </div>
            {request.infoReceivedAt && (
              <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2">
                <Field label="Meno" value={request.childFirstName} />
                <Field label="Priezvisko" value={request.childLastName} />
                <Field
                  label="Dátum narodenia"
                  value={request.childBirthDate ? new Date(request.childBirthDate).toLocaleDateString('sk-SK') : null}
                />
                <Field label="Registračné číslo" value={request.playerRegistrationNumber} />
                <Field label="Materský klub" value={request.infoMotherClub} />
                <Field label="Hosťujúci klub" value={request.infoGuestClub} />
                <Field label="Klubová príslušnosť" value={request.infoClubAffiliation} />
                <Field
                  label="Skupina"
                  value={request.requestedTeamId ? teams.find((t) => t.id === request.requestedTeamId)?.name ?? request.requestedTeamId : null}
                />
                <Field label="Fotka" value={request.hasPhoto ? 'áno, prítomná' : 'nie'} />
              </dl>
            )}
            {request.parentEmail ? (
              <Button variant="ghost" onClick={() => setPreviewOpen(true)} disabled={busy}>
                {requestedAt ? 'Vyžiadať znova' : 'Vyžiadať údaje od rodiča'}
              </Button>
            ) : (
              <p className="text-xs text-gray-500">Rodič nemá uvedený e-mail.</p>
            )}
          </section>
        )}

        {previewOpen && (
          <InfoRequestModal
            requestId={request.id}
            onClose={() => setPreviewOpen(false)}
            onSent={() => {
              setRequestedAt(new Date().toISOString());
              void onChanged();
            }}
          />
        )}

        {/* Priradenie existujúceho člena */}
        <section className="rounded-md border border-club-100 p-3">
          <label className={labelCls}>
            {isParentType ? 'Priradiť deti (existujúci členovia)' : 'Hráč už je členom? Priradiť existujúceho'}
          </label>
          <p className="mb-2 text-xs text-gray-500">
            {isParentType
              ? 'Vyberte deti, ktoré sú už členmi klubu — priradia sa k rodičovi.'
              : 'Ak je hráč už členom (import z futbalnetu / skoršia registrácia), vyberte ho — nevytvorí sa duplikát. Inak nechajte prázdne a vytvorí sa nový člen.'}
          </p>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Hľadať podľa priezviska…"
            className={`${inputCls} mb-2`}
          />
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400">{players.length ? 'Nič nenájdené.' : 'Žiadni hráči.'}</p>
            ) : (
              filtered.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                  {p.lastName} {p.firstName}
                  {p.memberships[0]?.team.name ? (
                    <span className="text-xs text-gray-400"> · {p.memberships[0].team.name}</span>
                  ) : null}
                </label>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <p className="mt-2 text-xs text-club-700">Vybraných: {selected.length}</p>
          )}
        </section>

        <div className="flex justify-between gap-2">
          <Button variant="danger" onClick={onReject} disabled={busy}>
            Zamietnuť
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Zrušiť
            </Button>
            <Button onClick={() => onApprove(selected)} disabled={busy || (isParentType && selected.length === 0)}>
              {busy ? 'Spracúvam…' : 'Schváliť'}
            </Button>
          </div>
        </div>
        {isParentType && selected.length === 0 && (
          <p className="text-right text-xs text-amber-700">Vyberte aspoň jedno dieťa na priradenie.</p>
        )}
      </div>
    </Modal>
  );
}

function InfoRequestModal({
  requestId,
  onClose,
  onSent,
}: {
  requestId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<InfoPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: boolean; reason?: string; to: string; link: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const qs = message.trim() ? `?message=${encodeURIComponent(message.trim())}` : '';
      api<InfoPreview>(`/registration/${requestId}/request-info/preview${qs}`)
        .then((p) => {
          if (cancelled) return;
          setPreview(p);
          setError(null);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Náhľad sa nepodarilo načítať');
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [requestId, message]);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await api<{ sent: boolean; reason?: string; to: string; link: string }>(
        `/registration/${requestId}/request-info`,
        { method: 'POST', body: JSON.stringify({ message: message.trim() || undefined }) },
      );
      setResult(res);
      if (res.sent) onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Odoslanie zlyhalo');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Vyžiadať údaje od rodiča" wide>
      {result ? (
        <div className="space-y-3 text-sm">
          {result.sent ? (
            <p className="text-green-700">E-mail bol odoslaný na {result.to}.</p>
          ) : (
            <p className="text-red-600">E-mail sa nepodarilo odoslať{result.reason ? `: ${result.reason}` : ''}.</p>
          )}
          <p className="break-all text-gray-600">
            Odkaz na formulár: <a href={result.link} target="_blank" rel="noreferrer" className="text-club-600 underline">{result.link}</a>
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Zavrieť</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <ErrorText>{error}</ErrorText>
          <p className="text-sm text-gray-700">
            <strong>Komu:</strong> {preview ? preview.to ?? '— (rodič nemá e-mail)' : '…'}
          </p>
          <p className="text-sm text-gray-700">
            <strong>Predmet:</strong> {preview?.subject ?? '…'}
          </p>
          <div>
            <label className={labelCls}>Osobná správa (nepovinné)</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000} className={inputCls} />
          </div>
          <iframe
            title="Náhľad e-mailu"
            srcDoc={preview?.html ?? ''}
            sandbox=""
            className="w-full border border-gray-200 bg-white"
            style={{ height: 520 }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={sending}>
              Späť
            </Button>
            <Button onClick={send} disabled={sending || !preview?.to}>
              {sending ? 'Odosielam…' : 'Odoslať e-mail'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
