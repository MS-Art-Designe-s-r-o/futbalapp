import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatEventDateTimeSk } from '@fkknv/shared';
import { api } from '@/api';
import { canManageTeam, fetchMe, type Me } from '@/auth';
import { ui } from '@/theme';
import { JerseyPair, JerseyPicker, type Jersey } from '@/JerseySwatch';
import { fetchPitches, type Pitch } from '@/pitches';

interface Tournament {
  event: {
    id: string;
    title: string;
    startAt: string;
    endAt: string | null;
    location: string | null;
    address?: string | null;
    pitchId?: string | null;
    teamId: string | null;
    team: { id: string; name: string } | null;
    legacyMatchId?: string | null;
  };
  participants: Array<{ id: string; clubName: string; logoUrl: string | null; sortOrder: number }>;
  matches: Array<{
    eventId: string;
    matchId: string | null;
    order: number | null;
    opponent: string | null;
    startAt: string;
    location: string | null;
    state: string | null;
    scoreUs: number | null;
    scoreThem: number | null;
    jerseyColor?: Jersey;
    opponentJerseyColor?: Jersey;
  }>;
  nominations: Array<{ memberId: string; firstName: string; lastName: string }>;
}

interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  nominated: boolean;
}

interface Club {
  id: string;
  name: string;
  logoUrl: string | null;
}

const STATE_SK: Record<string, string> = {
  LIVE: '● NAŽIVO',
  FINISHED: 'Ukončený',
  CANCELLED: 'Zrušený',
  PLANNED: 'Plánovaný',
};

export default function TournamentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<Tournament | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editClubs, setEditClubs] = useState<string[] | null>(null);
  const [register, setRegister] = useState<Club[]>([]);
  const [clubQuery, setClubQuery] = useState('');
  const [newClub, setNewClub] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [mOpp, setMOpp] = useState('');
  const [mOrder, setMOrder] = useState('');
  const [mDate, setMDate] = useState('');
  const [mTime, setMTime] = useState('');
  const [mPlace, setMPlace] = useState('');
  const [mJersey, setMJersey] = useState<Jersey>(null);
  const [mOppJersey, setMOppJersey] = useState<Jersey>(null);
  const [mPitchId, setMPitchId] = useState('');
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api<Tournament>(`/tournaments/${id}`);
    setT(data);
    // starý turnaj s vlastným zápasom sa otvára ako zápas
    if (data.event.legacyMatchId) router.replace(`/match/${data.event.legacyMatchId}`);
  }, [id, router]);

  useEffect(() => {
    load().catch((e) => Alert.alert('Chyba', e instanceof Error ? e.message : 'Načítanie zlyhalo'));
    fetchMe().then(setMe).catch(() => {});
  }, [load]);

  const canNominate = !!t && canManageTeam(me, t.event.teamId);

  async function openNomination() {
    try {
      setCands(await api<Candidate[]>(`/tournaments/${id}/candidates`));
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Načítanie zlyhalo');
    }
  }

  async function toggle(c: Candidate) {
    setCands((prev) => prev && prev.map((x) => (x.id === c.id ? { ...x, nominated: !x.nominated } : x)));
    try {
      if (c.nominated) await api(`/tournaments/${id}/nominations/${c.id}`, { method: 'DELETE' });
      else await api(`/tournaments/${id}/nominations`, { method: 'POST', body: JSON.stringify({ memberId: c.id }) });
      await load();
    } catch (e) {
      await openNomination();
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Zmena nominácie zlyhala');
    }
  }

  const shownClubs = useMemo(() => {
    const q = clubQuery.trim().toLowerCase();
    return register.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 30);
  }, [register, clubQuery]);

  const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  function toggleClub(name: string) {
    setEditClubs((prev) => prev && (prev.some((x) => sameName(x, name)) ? prev.filter((x) => !sameName(x, name)) : [...prev, name]));
  }

  function addNewClub() {
    const name = newClub.trim();
    if (!name) return;
    setEditClubs((prev) => prev && (prev.some((x) => sameName(x, name)) ? prev : [...prev, name]));
    setNewClub('');
  }

  async function openClubEdit() {
    if (!t) return;
    setEditClubs(t.participants.map((p) => p.clubName));
    if (register.length === 0) api<Club[]>('/clubs').then(setRegister).catch(() => {});
  }

  async function saveClubs() {
    if (!editClubs) return;
    setBusy(true);
    try {
      await api(`/tournaments/${id}/participants`, { method: 'PUT', body: JSON.stringify({ clubs: editClubs }) });
      setEditClubs(null);
      await load();
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  function openAddMatch() {
    if (!t) return;
    const max = t.matches.reduce((m, x) => Math.max(m, x.order ?? 0), 0);
    setMOrder(String(max + 1));
    setMOpp('');
    setMDate(t.event.startAt.slice(0, 10));
    setMTime(t.event.startAt.slice(11, 16)); // čas udalosti = wall-clock v UTC komponentoch
    setMPlace(t.event.location ?? '');
    setMPitchId(t.event.pitchId ?? '');
    setMJersey(null);
    setMOppJersey(null);
    if (pitches.length === 0) fetchPitches().then(setPitches).catch(() => {});
    setAddOpen(true);
  }

  async function saveMatch() {
    if (!mOpp) {
      Alert.alert('Skontrolujte údaje', 'Vyberte súpera');
      return;
    }
    const order = Number(mOrder);
    if (mOrder && (!Number.isInteger(order) || order < 1)) {
      Alert.alert('Skontrolujte údaje', 'Poradie musí byť celé číslo od 1');
      return;
    }
    let startAt: string | undefined;
    if (mTime) {
      const tm = /^(\d{1,2}):(\d{2})$/.exec(mTime.trim());
      if (!tm || !/^\d{4}-\d{2}-\d{2}$/.test(mDate)) {
        Alert.alert('Skontrolujte údaje', 'Dátum zadajte ako RRRR-MM-DD a čas ako HH:MM');
        return;
      }
      startAt = `${mDate}T${tm[1].padStart(2, '0')}:${tm[2]}:00.000Z`;
    }
    setBusy(true);
    try {
      await api(`/tournaments/${id}/matches`, {
        method: 'POST',
        body: JSON.stringify({ opponent: mOpp, order: mOrder ? order : undefined,
          startAt,
          ...(mPitchId ? { pitchId: mPitchId } : { location: mPlace || undefined }),
          jerseyColor: mJersey || undefined,
          opponentJerseyColor: mOppJersey || undefined,
        }),
      });
      // dátum a miesto ostávajú predvyplnené, zvýši sa poradie
      setMOrder(String((order || 0) + 1));
      setMOpp('');
      await load();
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }

  function removeMatch(eventId: string) {
    Alert.alert('Zmazať zápas', 'Naozaj zmazať tento zápas turnaja?', [
      { text: 'Zrušiť', style: 'cancel' },
      {
        text: 'Zmazať',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/tournaments/${id}/matches/${eventId}`, { method: 'DELETE' });
            await load();
          } catch (e) {
            Alert.alert('Chyba', e instanceof Error ? e.message : 'Zmazanie zlyhalo');
          }
        },
      },
    ]);
  }

  if (!t) {
    return (
      <View style={styles.center}>
        <Text style={{ color: ui.muted }}>Načítavam turnaj…</Text>
      </View>
    );
  }

  const { event } = t;
  const inputProps = { placeholderTextColor: ui.placeholder, keyboardAppearance: 'dark' as const };
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load().catch(() => {});
            setRefreshing(false);
          }}
          tintColor={ui.lime}
          colors={[ui.blue]}
          progressBackgroundColor={ui.panel}
        />
      }
    >
      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.meta}>
        {event.team ? `${event.team.name} · ` : ''}
        {formatEventDateTimeSk(event.startAt)}
      </Text>
      {event.location ? (
        event.address ? (
          <Pressable
            onPress={() =>
              Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address!)}`)
            }
          >
            <Text style={[styles.meta, { color: ui.lime, textDecorationLine: 'underline' }]}>📍 {event.location}</Text>
          </Pressable>
        ) : (
          <Text style={styles.meta}>{event.location}</Text>
        )
      ) : null}

      <Text style={styles.h}>Zápasy</Text>
      {t.matches.length === 0 && <Text style={styles.empty}>Zatiaľ žiadne zápasy.</Text>}
      {t.matches.map((m) => {
        const finished = m.state === 'FINISHED' || m.state === 'LIVE';
        return (
          <Pressable
            key={m.eventId}
            style={styles.card}
            disabled={!m.matchId}
            onPress={() => m.matchId && router.push(`/match/${m.matchId}`)}
          >
            <Text style={styles.cardTitle}>
              {m.order ? `${m.order}. zápas — ` : ''}vs {m.opponent ?? '?'}
            </Text>
            <Text style={styles.meta}>
              {formatEventDateTimeSk(m.startAt)}
              {m.location ? ` · ${m.location}` : ''}
            </Text>
            <Text style={styles.meta}>
              {finished ? `${m.scoreUs ?? 0} : ${m.scoreThem ?? 0} · ` : ''}
              {STATE_SK[m.state ?? ''] ?? ''}
            </Text>
            <JerseyPair own={m.jerseyColor} opponent={m.opponentJerseyColor} />
            {canNominate && (m.state === null || m.state === 'PLANNED') && (
              <Pressable onPress={() => removeMatch(m.eventId)}>
                <Text style={styles.danger}>Zmazať</Text>
              </Pressable>
            )}
          </Pressable>
        );
      })}

      {canNominate && (
        <>
          <Pressable style={styles.btn} onPress={addOpen ? () => setAddOpen(false) : openAddMatch}>
            <Text style={styles.btnText}>{addOpen ? 'Zavrieť' : 'Pridať zápas turnaja'}</Text>
          </Pressable>
          {addOpen && (
            <View style={styles.form}>
              <Text style={styles.label}>Súper</Text>
              {t.participants.length === 0 && <Text style={styles.empty}>Najprv pridajte zúčastnené mužstvá.</Text>}
              <View style={styles.wrapRow}>
                {t.participants.map((p) => (
                  <Pressable key={p.id} style={[styles.chip, mOpp === p.clubName && styles.chipActive]} onPress={() => setMOpp(p.clubName)}>
                    <Text style={[styles.chipText, mOpp === p.clubName && styles.chipTextActive]}>{p.clubName}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>Poradie</Text>
              <TextInput {...inputProps} style={styles.input} value={mOrder} onChangeText={setMOrder} keyboardType="number-pad" />
              <Text style={styles.label}>Dátum (RRRR-MM-DD)</Text>
              <TextInput {...inputProps} style={styles.input} value={mDate} onChangeText={setMDate} />
              <Text style={styles.label}>Čas (HH:MM, voliteľné)</Text>
              <TextInput {...inputProps} style={styles.input} value={mTime} onChangeText={setMTime} placeholder="10:00" />
              {pitches.length > 0 && (
                <>
                  <Text style={styles.label}>Ihrisko</Text>
                  <View style={styles.wrapRow}>
                    {pitches.map((p) => (
                      <Pressable key={p.id} style={[styles.chip, mPitchId === p.id && styles.chipActive]} onPress={() => setMPitchId(mPitchId === p.id ? '' : p.id)}>
                        <Text style={[styles.chipText, mPitchId === p.id && styles.chipTextActive]}>{p.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
              <Text style={styles.label}>Miesto (voliteľné)</Text>
              <TextInput {...inputProps} style={styles.input} value={mPlace} onChangeText={setMPlace} />
              <JerseyPicker label="Náš dres" value={mJersey} onChange={setMJersey} />
              <JerseyPicker label="Dres súpera" value={mOppJersey} onChange={setMOppJersey} />
              <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} onPress={saveMatch} disabled={busy}>
                <Text style={styles.btnText}>{busy ? 'Ukladám…' : 'Uložiť zápas'}</Text>
              </Pressable>
            </View>
          )}
        </>
      )}

      <Text style={styles.h}>Zúčastnené mužstvá</Text>
      {t.participants.length === 0 && <Text style={styles.empty}>—</Text>}
      {t.participants.map((p) => (
        <Text key={p.id} style={styles.line}>
          {p.clubName}
        </Text>
      ))}
      {canNominate && !editClubs && (
        <Pressable style={styles.btn} onPress={openClubEdit}>
          <Text style={styles.btnText}>Upraviť mužstvá</Text>
        </Pressable>
      )}
      {canNominate && editClubs && (
        <View style={styles.form}>
          {editClubs.length > 0 && (
            <View style={styles.wrapRow}>
              {editClubs.map((n) => (
                <Pressable key={n} style={[styles.chip, styles.chipActive]} onPress={() => toggleClub(n)}>
                  <Text style={[styles.chipText, styles.chipTextActive]}>{n} ✕</Text>
                </Pressable>
              ))}
            </View>
          )}
          <TextInput {...inputProps} style={[styles.input, { marginTop: 8 }]} value={clubQuery} onChangeText={setClubQuery} placeholder="Hľadať mužstvo…" />
          <View style={styles.wrapRow}>
            {shownClubs.map((c) => {
              const on = editClubs.some((x) => sameName(x, c.name));
              return (
                <Pressable key={c.id} style={[styles.chip, on && styles.chipActive]} onPress={() => toggleClub(c.name)}>
                  <Text style={[styles.chipText, on && styles.chipTextActive]}>{on ? '✓ ' : ''}{c.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.label}>Pridať nové mužstvo</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput {...inputProps} style={[styles.input, { flex: 1 }]} value={newClub} onChangeText={setNewClub} onSubmitEditing={addNewClub} placeholder="Názov mužstva" />
            <Pressable style={[styles.chip, { justifyContent: 'center' }]} onPress={addNewClub}>
              <Text style={styles.chipText}>Pridať</Text>
            </Pressable>
          </View>
          <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} onPress={saveClubs} disabled={busy}>
            <Text style={styles.btnText}>{busy ? 'Ukladám…' : 'Uložiť mužstvá'}</Text>
          </Pressable>
          <Pressable onPress={() => setEditClubs(null)}>
            <Text style={[styles.danger, { color: ui.muted, textAlign: 'center' }]}>Zrušiť</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.h}>Nominovaní hráči ({t.nominations.length})</Text>
      {t.nominations.length === 0 && <Text style={styles.empty}>Nikto nie je nominovaný.</Text>}
      {t.nominations.map((n) => (
        <Text key={n.memberId} style={styles.line}>
          {n.lastName} {n.firstName}
        </Text>
      ))}

      {canNominate && (
        <>
          <Pressable style={styles.btn} onPress={cands ? () => setCands(null) : openNomination}>
            <Text style={styles.btnText}>{cands ? 'Zavrieť nomináciu' : 'Upraviť nomináciu'}</Text>
          </Pressable>
          {cands?.map((c) => (
            <Pressable key={c.id} style={[styles.row, c.nominated && { borderColor: ui.blue }]} onPress={() => toggle(c)}>
              <Text style={styles.line}>
                {c.lastName} {c.firstName}
              </Text>
              <Text style={{ color: c.nominated ? ui.lime : ui.muted, fontWeight: '700' }}>{c.nominated ? '✓ v nominácii' : '+'}</Text>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  center: { flex: 1, backgroundColor: ui.bg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: ui.ink },
  meta: { color: ui.muted, fontSize: 13, marginTop: 2 },
  h: { color: ui.ink, fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  empty: { color: ui.muted },
  line: { color: ui.ink, fontSize: 15, paddingVertical: 3 },
  card: { backgroundColor: ui.panel, borderRadius: 8, borderWidth: 1, borderColor: ui.line, padding: 14, marginBottom: 8 },
  cardTitle: { color: ui.ink, fontSize: 16, fontWeight: '700' },
  btn: { backgroundColor: ui.blue, borderRadius: 8, padding: 14, marginTop: 20, marginBottom: 8 },
  btnText: { color: ui.onAccent, fontWeight: '700', textAlign: 'center' },
  danger: { color: ui.red, fontWeight: '700', fontSize: 13, marginTop: 8 },
  form: { backgroundColor: ui.panel, borderRadius: 8, borderWidth: 1, borderColor: ui.line, padding: 12, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', color: ui.muted, marginTop: 12, marginBottom: 4 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  input: { backgroundColor: ui.bg, color: ui.ink, borderWidth: 1, borderColor: ui.line, borderRadius: 8, padding: 12, fontSize: 15 },
  chip: { borderWidth: 1, borderColor: ui.line, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: ui.bg },
  chipActive: { backgroundColor: ui.blue, borderColor: ui.blue },
  chipText: { color: ui.ink, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: ui.onAccent },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: ui.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ui.line,
    padding: 12,
    marginBottom: 6,
  },
});
