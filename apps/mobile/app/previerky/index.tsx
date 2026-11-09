import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  FITNESS_DISCIPLINES,
  fitnessDisciplineLabel,
  fitnessDelta,
  formatFitnessDate,
  previousFitnessValue,
} from '@fkknv/shared';
import { api } from '@/api';
import { ui } from '@/theme';
import { inputProps } from '@/inputStyle';
import { KeyboardScreen } from '@/KeyboardScreen';
import { trendColor, type FitnessTest } from '@/fitness';

type Mode = 'players' | 'dates';
type Sort = 'name' | 'team' | 'date';
type Sel = { kind: 'player'; memberId: string } | { kind: 'date'; date: string; teamId: string | null } | null;

const collator = new Intl.Collator('sk');
const fullName = (m: { firstName: string; lastName: string }) => `${m.lastName} ${m.firstName}`;

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** Jedna previerka hráča: disciplíny s rozdielom oproti predchádzajúcej (zelená/červená/čierna). */
function TestValues({ test, all }: { test: FitnessTest; all: FitnessTest[] }) {
  return (
    <View style={{ marginTop: 4 }}>
      {FITNESS_DISCIPLINES.filter((d) => test[d.key] != null).map((d) => {
        const { text, trend } = fitnessDelta(test[d.key], previousFitnessValue(all, test, d.key), d);
        return (
          <View key={d.key} style={styles.valueRow}>
            <Text style={styles.valueLabel}>{fitnessDisciplineLabel(d, test.enduranceMinutes)}</Text>
            <Text style={[styles.value, { color: trendColor[trend], fontWeight: trend === 'none' ? '400' : '700' }]}>
              {test[d.key] == null ? '–' : `${text} ${d.unit}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function FitnessTestsScreen() {
  const router = useRouter();
  const [tests, setTests] = useState<FitnessTest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('players');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [teamFilter, setTeamFilter] = useState('');
  const [sel, setSel] = useState<Sel>(null);

  const load = useCallback(() => {
    api<FitnessTest[]>('/fitness-tests')
      .then((t) => {
        setTests(t);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Načítanie zlyhalo'));
  }, []);
  // načítaj pri každom návrate na obrazovku (po uložení previerky)
  useFocusEffect(load);

  const q = search.trim().toLowerCase();
  const teamOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tests) if (t.team) m.set(t.team.id, t.team.name);
    return [...m.entries()].sort((a, b) => collator.compare(a[1], b[1]));
  }, [tests]);

  const players = useMemo(() => {
    const map = new Map<string, { member: FitnessTest['member']; team: string; count: number; last: string }>();
    for (const t of tests) {
      if (teamFilter && t.teamId !== teamFilter) continue;
      const cur = map.get(t.memberId);
      if (!cur) map.set(t.memberId, { member: t.member, team: t.team?.name ?? '', count: 1, last: t.testedAt });
      else {
        cur.count++;
        if (t.testedAt >= cur.last) {
          cur.last = t.testedAt;
          cur.team = t.team?.name ?? cur.team;
        }
      }
    }
    return [...map.values()]
      .filter((p) => !q || fullName(p.member).toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .sort((a, b) =>
        sort === 'team'
          ? collator.compare(a.team, b.team) || collator.compare(fullName(a.member), fullName(b.member))
          : sort === 'date'
            ? b.last.localeCompare(a.last)
            : collator.compare(fullName(a.member), fullName(b.member)),
      );
  }, [tests, q, sort, teamFilter]);

  const dates = useMemo(() => {
    const map = new Map<string, { date: string; teamId: string | null; team: string; count: number }>();
    for (const t of tests) {
      if (teamFilter && t.teamId !== teamFilter) continue;
      const key = `${t.testedAt}|${t.teamId ?? ''}`;
      const cur = map.get(key);
      if (cur) cur.count++;
      else map.set(key, { date: t.testedAt, teamId: t.teamId, team: t.team?.name ?? '—', count: 1 });
    }
    return [...map.values()]
      .filter((d) => !q || d.team.toLowerCase().includes(q) || formatFitnessDate(d.date).includes(q))
      .sort((a, b) =>
        sort === 'team'
          ? collator.compare(a.team, b.team) || b.date.localeCompare(a.date)
          : b.date.localeCompare(a.date) || collator.compare(a.team, b.team),
      );
  }, [tests, q, sort, teamFilter]);

  function confirmRemove(date: string, teamId: string | null, label: string) {
    Alert.alert('Vymazať testovanie', `Vymazať testovanie ${label}? Zmažú sa výsledky všetkých hráčov z tohto dňa.`, [
      { text: 'Zrušiť', style: 'cancel' },
      {
        text: 'Vymazať',
        style: 'destructive',
        onPress: async () => {
          try {
            for (const t of tests.filter((x) => x.testedAt === date && x.teamId === teamId)) {
              await api(`/fitness-tests/${t.id}`, { method: 'DELETE' });
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Vymazanie zlyhalo');
          }
          setSel(null);
          load();
        },
      },
    ]);
  }

  // ---------- detail ----------
  if (sel?.kind === 'player') {
    const rows = tests.filter((t) => t.memberId === sel.memberId);
    const member = rows[0]?.member;
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
        <Pressable onPress={() => setSel(null)}>
          <Text style={styles.back}>← Testovanie</Text>
        </Pressable>
        <Text style={styles.title}>{member ? fullName(member) : 'Hráč'}</Text>
        {[...rows].reverse().map((t) => (
          <View key={t.id} style={styles.card}>
            <Text style={styles.cardTitle}>{formatFitnessDate(t.testedAt)}</Text>
            <TestValues test={t} all={tests} />
          </View>
        ))}
        <Text style={styles.legend}>Zelená = zlepšenie, červená = zhoršenie, biela = bez zmeny (v zátvorke rozdiel).</Text>
      </ScrollView>
    );
  }

  if (sel?.kind === 'date') {
    const rows = tests
      .filter((t) => t.testedAt === sel.date && t.teamId === sel.teamId)
      .sort((a, b) => collator.compare(fullName(a.member), fullName(b.member)));
    const label = `${formatFitnessDate(sel.date)}${rows[0]?.team ? ` — ${rows[0].team.name}` : ''}`;
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
        <Pressable onPress={() => setSel(null)}>
          <Text style={styles.back}>← Testovanie</Text>
        </Pressable>
        <Text style={styles.title}>Testovanie {label}</Text>
        <View style={styles.actions}>
          {sel.teamId && (
            <Pressable
              style={styles.btn}
              onPress={() => router.push({ pathname: '/previerky/nova', params: { team: sel.teamId!, date: sel.date } })}
            >
              <Text style={styles.btnText}>Upraviť</Text>
            </Pressable>
          )}
          <Pressable style={[styles.btn, styles.btnDanger]} onPress={() => confirmRemove(sel.date, sel.teamId, label)}>
            <Text style={styles.btnText}>Vymazať</Text>
          </Pressable>
        </View>
        {rows.map((t) => (
          <View key={t.id} style={styles.card}>
            <Text style={styles.cardTitle}>{fullName(t.member)}</Text>
            <TestValues test={t} all={tests} />
          </View>
        ))}
        <Text style={styles.legend}>Zelená = zlepšenie, červená = zhoršenie, biela = bez zmeny (v zátvorke rozdiel).</Text>
      </ScrollView>
    );
  }

  // ---------- zoznamy ----------
  return (
    <KeyboardScreen style={styles.container}>
      <Pressable style={styles.newBtn} onPress={() => router.push('/previerky/nova')}>
        <Text style={styles.newBtnText}>+ Nové testovanie</Text>
      </Pressable>

      <View style={styles.chipRow}>
        <Chip label="Podľa hráčov" active={mode === 'players'} onPress={() => { setMode('players'); setSort('name'); }} />
        <Chip label="Podľa dátumu" active={mode === 'dates'} onPress={() => { setMode('dates'); setSort('date'); }} />
      </View>
      <TextInput
        {...inputProps}
        value={search}
        onChangeText={setSearch}
        placeholder={mode === 'players' ? 'Hľadať priezvisko / družstvo…' : 'Hľadať družstvo / dátum…'}
        style={styles.input}
      />
      <Text style={styles.sectionLabel}>Družstvo</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        <View style={styles.chipRow}>
          <Chip label="Všetky" active={teamFilter === ''} onPress={() => setTeamFilter('')} />
          {teamOptions.map(([id, name]) => (
            <Chip key={id} label={name} active={teamFilter === id} onPress={() => setTeamFilter(id)} />
          ))}
        </View>
      </ScrollView>
      <Text style={styles.sectionLabel}>Triediť</Text>
      <View style={styles.chipRow}>
        {mode === 'players' && <Chip label="Priezvisko" active={sort === 'name'} onPress={() => setSort('name')} />}
        <Chip label="Družstvo" active={sort === 'team'} onPress={() => setSort('team')} />
        <Chip label="Dátum" active={sort === 'date'} onPress={() => setSort('date')} />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {mode === 'players'
        ? players.map((p) => (
            <Pressable key={p.member.id} style={styles.card} onPress={() => setSel({ kind: 'player', memberId: p.member.id })}>
              <Text style={styles.cardTitle}>{fullName(p.member)}</Text>
              <Text style={styles.meta}>
                {p.team || '—'} · posledná {formatFitnessDate(p.last)} · počet {p.count}
              </Text>
            </Pressable>
          ))
        : dates.map((d) => {
            const label = `${formatFitnessDate(d.date)} — ${d.team}`;
            return (
              <View key={`${d.date}|${d.teamId}`} style={styles.card}>
                <Pressable onPress={() => setSel({ kind: 'date', date: d.date, teamId: d.teamId })}>
                  <Text style={styles.cardTitle}>{formatFitnessDate(d.date)}</Text>
                  <Text style={styles.meta}>
                    {d.team} · {d.count} hráčov
                  </Text>
                </Pressable>
                <View style={styles.actions}>
                  {d.teamId && (
                    <Pressable
                      style={styles.btn}
                      onPress={() => router.push({ pathname: '/previerky/nova', params: { team: d.teamId!, date: d.date } })}
                    >
                      <Text style={styles.btnText}>Upraviť</Text>
                    </Pressable>
                  )}
                  <Pressable style={[styles.btn, styles.btnDanger]} onPress={() => confirmRemove(d.date, d.teamId, label)}>
                    <Text style={styles.btnText}>Vymazať</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
      {(mode === 'players' ? players.length : dates.length) === 0 && !error && (
        <Text style={styles.empty}>Žiadne testovania.</Text>
      )}
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  back: { color: ui.blueHi, fontSize: 14, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '800', color: ui.ink, marginBottom: 12 },
  newBtn: { backgroundColor: ui.blue, borderRadius: 8, padding: 12, alignItems: 'center', marginBottom: 12 },
  newBtnText: { color: ui.onAccent, fontWeight: '700', fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: ui.line, backgroundColor: ui.panel, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: ui.blue, borderColor: ui.blue },
  chipText: { color: ui.ink, fontSize: 13 },
  chipTextActive: { color: ui.onAccent, fontWeight: '600' },
  sectionLabel: { fontSize: 12, color: ui.muted, marginBottom: 4 },
  input: { color: ui.ink, backgroundColor: ui.panel, borderWidth: 1, borderColor: ui.line, borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14 },
  card: { backgroundColor: ui.panel, borderRadius: 8, borderWidth: 1, borderColor: ui.line, padding: 12, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: ui.ink },
  meta: { fontSize: 13, color: ui.muted, marginTop: 2 },
  valueRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  valueLabel: { fontSize: 13, color: ui.muted },
  value: { fontSize: 14 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4 },
  btn: { backgroundColor: ui.blue, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 8 },
  btnDanger: { backgroundColor: ui.red },
  btnText: { color: ui.onAccent, fontWeight: '600', fontSize: 13 },
  legend: { fontSize: 12, color: ui.muted, marginTop: 8 },
  error: { color: ui.red, marginBottom: 8 },
  empty: { color: ui.muted, textAlign: 'center', marginTop: 24 },
});
