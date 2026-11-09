import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  FITNESS_CATEGORIES,
  FITNESS_DISCIPLINES,
  type FitnessCategory,
  enduranceMinutesFor,
  fitnessDisciplineLabel,
  type FitnessDisciplineKey,
} from '@fkknv/shared';
import { api } from '@/api';
import { canManage, coachTeams, fetchMe, isStaff, type Me } from '@/auth';
import { ui } from '@/theme';
import { inputProps } from '@/inputStyle';
import { KeyboardScreen } from '@/KeyboardScreen';
import { todayIso, type FitnessTest } from '@/fitness';

interface Team {
  id: string;
  name: string;
  teamCategory?: { code: string; name?: string };
}
interface Player {
  id: string;
  firstName: string;
  lastName: string;
}
type Values = Record<FitnessDisciplineKey, string>;
interface Row {
  testId: string | null;
  values: Values;
  saved: Values;
  busy: boolean;
  error: string | null;
}

const emptyValues = (): Values => Object.fromEntries(FITNESS_DISCIPLINES.map((d) => [d.key, ''])) as Values;
const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const collator = new Intl.Collator('sk');

/** Hromadné zadanie previerky: dátum + družstvo → riadok na hráča, Uložiť / Upraviť pri každom hráčovi. */
export default function NewFitnessTestScreen() {
  const params = useLocalSearchParams<{ team?: string; date?: string }>();
  const fixedTeam = !!params.team;
  const [me, setMe] = useState<Me | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState(params.team ?? '');
  const [date, setDate] = useState(params.date ?? todayIso());
  const [players, setPlayers] = useState<Player[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [category, setCategory] = useState<FitnessCategory>('SILOVE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMe().then(setMe).catch(() => {});
    api<Team[]>('/seasons/teams').then(setTeams).catch(() => {});
  }, []);

  const available = me && canManage(me) ? (isStaff(me) ? teams : teams.filter((t) => coachTeams(me).some((c) => c.id === t.id))) : [];
  const teamName = teams.find((t) => t.id === teamId)?.name;
  // dĺžka vytrvalostného behu podľa vekovej kategórie družstva (U13 = 6 min, U15 = 12 min)
  const selectedTeam = teams.find((t) => t.id === teamId);
  const minutes = enduranceMinutesFor(selectedTeam?.teamCategory?.code, selectedTeam?.teamCategory?.name);

  const load = useCallback(async () => {
    if (!teamId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setPlayers([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [members, tests] = await Promise.all([
        api<Player[]>(`/members?team=${teamId}&hideInactive=true&role=PLAYER`),
        api<FitnessTest[]>('/fitness-tests'),
      ]);
      const sorted = [...members].sort((a, b) =>
        collator.compare(`${a.lastName} ${a.firstName}`, `${b.lastName} ${b.firstName}`),
      );
      const existing = new Map(tests.filter((t) => t.testedAt === date).map((t) => [t.memberId, t]));
      const next: Record<string, Row> = {};
      for (const p of sorted) {
        const t = existing.get(p.id);
        const values: Values = emptyValues();
        if (t) for (const d of FITNESS_DISCIPLINES) values[d.key] = t[d.key]?.toString() ?? '';
        next[p.id] = { testId: t?.id ?? null, values, saved: { ...values }, busy: false, error: null };
      }
      setPlayers(sorted);
      setRows(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo');
    } finally {
      setLoading(false);
    }
  }, [teamId, date]);
  useEffect(() => {
    void load();
  }, [load]);

  function patchRow(id: string, patch: Partial<Row>) {
    setRows((r) => ({ ...r, [id]: { ...r[id]!, ...patch } }));
  }
  function setValue(id: string, key: FitnessDisciplineKey, v: string) {
    setRows((r) => ({ ...r, [id]: { ...r[id]!, values: { ...r[id]!.values, [key]: v }, error: null } }));
  }

  async function save(playerId: string) {
    const row = rows[playerId]!;
    const body: Record<string, unknown> = { testedAt: date };
    for (const d of FITNESS_DISCIPLINES) body[d.key] = toNum(row.values[d.key]);
    if (FITNESS_DISCIPLINES.every((d) => body[d.key] == null)) {
      patchRow(playerId, { error: 'Zadajte aspoň jednu hodnotu' });
      return;
    }
    patchRow(playerId, { busy: true, error: null });
    try {
      if (row.testId) {
        await api(`/fitness-tests/${row.testId}`, { method: 'PATCH', body: JSON.stringify(body) });
        patchRow(playerId, { busy: false, saved: { ...row.values } });
      } else {
        const created = await api<{ id: string }>('/fitness-tests', {
          method: 'POST',
          body: JSON.stringify({ ...body, memberId: playerId, teamId }),
        });
        patchRow(playerId, { busy: false, testId: created.id, saved: { ...row.values } });
      }
    } catch (e) {
      patchRow(playerId, { busy: false, error: e instanceof Error ? e.message : 'Uloženie zlyhalo' });
    }
  }

  return (
    <KeyboardScreen style={styles.container}>
      <Text style={styles.label}>Dátum (RRRR-MM-DD)</Text>
      <TextInput {...inputProps} value={date} onChangeText={setDate} style={styles.input} autoCapitalize="none" />

      <Text style={styles.label}>Družstvo</Text>
      {fixedTeam ? (
        <Text style={styles.fixedTeam}>{teamName ?? '…'}</Text>
      ) : (
        <View style={styles.chipRow}>
          {available.map((t) => (
            <Pressable key={t.id} onPress={() => setTeamId(t.id)} style={[styles.chip, teamId === t.id && styles.chipActive]}>
              <Text style={[styles.chipText, teamId === t.id && styles.chipTextActive]}>{t.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={[styles.chipRow, { marginTop: 10 }]}>
        {FITNESS_CATEGORIES.map((c) => (
          <Pressable key={c.key} onPress={() => setCategory(c.key)} style={[styles.chip, category === c.key && styles.chipActive]}>
            <Text style={[styles.chipText, category === c.key && styles.chipTextActive]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {!teamId ? (
        <Text style={styles.empty}>Vyberte družstvo.</Text>
      ) : loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={ui.lime} />
      ) : players.length === 0 ? (
        <Text style={styles.empty}>Družstvo nemá žiadnych hráčov.</Text>
      ) : (
        players.map((p) => {
          const row = rows[p.id];
          if (!row) return null;
          const dirty = FITNESS_DISCIPLINES.some((d) => row.values[d.key] !== row.saved[d.key]);
          return (
            <View key={p.id} style={styles.card}>
              <Text style={styles.name}>
                {p.lastName} {p.firstName}
              </Text>
              <View style={styles.grid}>
                {FITNESS_DISCIPLINES.filter((d) => d.category === category).map((d) => (
                  <View key={d.key} style={styles.cell}>
                    <Text style={styles.cellLabel}>
                      {fitnessDisciplineLabel(d, minutes)} ({d.unit})
                    </Text>
                    <TextInput
                      {...inputProps}
                      value={row.values[d.key]}
                      onChangeText={(v) => setValue(p.id, d.key, v)}
                      keyboardType="decimal-pad"
                      style={styles.cellInput}
                    />
                  </View>
                ))}
              </View>
              <View style={styles.footer}>
                {row.testId && !dirty ? <Text style={styles.ok}>✓ uložené</Text> : <View />}
                <Pressable
                  onPress={() => save(p.id)}
                  disabled={row.busy || (!!row.testId && !dirty)}
                  style={[styles.btn, (row.busy || (!!row.testId && !dirty)) && { opacity: 0.4 }]}
                >
                  <Text style={styles.btnText}>{row.busy ? '…' : row.testId ? 'Upraviť' : 'Uložiť'}</Text>
                </Pressable>
              </View>
              {row.error && <Text style={styles.error}>{row.error}</Text>}
            </View>
          );
        })
      )}
      <Text style={styles.hint}>Časy v sekundách (napr. 2,35), skok v cm. Tlačidlo pri hráčovi uloží jeho testovanie.</Text>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  label: { fontSize: 12, color: ui.muted, marginBottom: 4, marginTop: 8 },
  input: { color: ui.ink, backgroundColor: ui.panel, borderWidth: 1, borderColor: ui.line, borderRadius: 8, padding: 10, fontSize: 15 },
  fixedTeam: { fontSize: 16, fontWeight: '700', color: ui.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: ui.line, backgroundColor: ui.panel, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: ui.blue, borderColor: ui.blue },
  chipText: { color: ui.ink, fontSize: 13 },
  chipTextActive: { color: ui.onAccent, fontWeight: '600' },
  card: { backgroundColor: ui.panel, borderRadius: 8, borderWidth: 1, borderColor: ui.line, padding: 12, marginTop: 10 },
  name: { fontSize: 16, fontWeight: '700', color: ui.ink, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '47%' },
  cellLabel: { fontSize: 11, color: ui.muted, marginBottom: 2 },
  cellInput: { color: ui.ink, backgroundColor: ui.bg, borderWidth: 1, borderColor: ui.line, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  ok: { color: ui.ok, fontSize: 12 },
  btn: { backgroundColor: ui.blue, borderRadius: 6, paddingHorizontal: 18, paddingVertical: 8 },
  btnText: { color: ui.onAccent, fontWeight: '700', fontSize: 14 },
  error: { color: ui.red, fontSize: 12, marginTop: 6 },
  empty: { color: ui.muted, textAlign: 'center', marginTop: 24 },
  hint: { color: ui.muted, fontSize: 12, textAlign: 'center', marginTop: 16 },
});
