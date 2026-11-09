import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatEventDateSk } from '@fkknv/shared';
import { api } from '@/api';
import { enqueue, flush } from '@/offline';
import { ui } from '@/theme';

interface AttendanceRow {
  id: string;
  status: string;
  member: { id: string; firstName: string; lastName: string };
}

interface EventDetail {
  id: string;
  title: string;
  startAt: string;
  team?: { id: string; name: string } | null;
  attendances: AttendanceRow[];
}

/** Poradie cyklovania stavov jedným ťuknutím (posledný = zrušenie voľby). */
const CYCLE = ['PRESENT', 'ABSENT', 'EXCUSED', 'INJURED', 'SICK', 'UNKNOWN'] as const;

const statusLabels: Record<string, string> = {
  PRESENT: 'Prítomný',
  ABSENT: 'Neprítomný',
  EXCUSED: 'Ospravedlnený',
  INJURED: 'Zranený',
  SICK: 'Chorý',
  UNKNOWN: '—',
};

const statusColors: Record<string, string> = {
  PRESENT: ui.ok,
  ABSENT: ui.red,
  EXCUSED: ui.warn,
  INJURED: '#c4b5fd',
  SICK: '#5eead4',
  UNKNOWN: ui.muted,
};

export default function AttendanceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    const { pending: p } = await flush();
    setPending(p);
    try {
      setEvent(await api<EventDetail>(`/events/${id}/attendance`));
    } catch {
      // offline — ostaneme pri poslednom lokálnom stave
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cycleStatus(row: AttendanceRow) {
    const current = CYCLE.indexOf(row.status as (typeof CYCLE)[number]);
    const next = CYCLE[(current + 1) % CYCLE.length]!;
    // optimistická zmena v UI, zápis ide cez offline frontu
    setEvent((prev) =>
      prev
        ? {
            ...prev,
            attendances: prev.attendances.map((a) => (a.id === row.id ? { ...a, status: next } : a)),
          }
        : prev,
    );
    const { pending: p } = await enqueue({
      kind: 'attendance',
      eventId: id,
      memberId: row.member.id,
      status: next,
    });
    setPending(p);
  }

  return (
    <View style={styles.container}>
      {event && (
        <Text style={styles.heading}>
          {event.title} · {formatEventDateSk(event.startAt)}
        </Text>
      )}
      {pending > 0 && (
        <Text style={styles.offline}>Offline — {pending} zmien čaká na odoslanie. Odošlú sa automaticky.</Text>
      )}
      {event?.team && (
        <Pressable
          style={styles.testBtn}
          onPress={() => router.push({ pathname: '/previerky/nova', params: { team: event.team!.id } })}
        >
          <Text style={styles.testBtnText}>⏱️ Vytvoriť testovanie</Text>
        </Pressable>
      )}
      <FlatList
        data={event?.attendances ?? []}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>Žiadni priradení hráči.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => cycleStatus(item)}>
            <Text style={styles.name}>
              {item.member.lastName} {item.member.firstName}
            </Text>
            <Text style={[styles.status, { color: statusColors[item.status] ?? ui.muted }]}>
              {statusLabels[item.status] ?? item.status}
            </Text>
          </Pressable>
        )}
      />
      <Text style={styles.hint}>Ťuknutím na hráča prepínate stav dochádzky.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg, padding: 16 },
  heading: { fontSize: 16, fontWeight: '700', color: ui.ink, marginBottom: 12 },
  offline: { backgroundColor: '#3a2e0f', color: ui.warn, padding: 8, borderRadius: 6, marginBottom: 8, fontSize: 13 },
  empty: { color: ui.muted, textAlign: 'center', marginTop: 32 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: ui.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ui.line,
    padding: 14,
    marginBottom: 8,
  },
  name: { fontSize: 16, fontWeight: '600', color: ui.ink },
  status: { fontSize: 14, fontWeight: '700' },
  testBtn: { borderWidth: 1, borderColor: ui.lime, borderRadius: 8, padding: 10, alignItems: 'center', marginBottom: 10 },
  testBtnText: { color: ui.lime, fontWeight: '700', fontSize: 14 },
  hint: { color: ui.muted, fontSize: 12, textAlign: 'center', paddingVertical: 8 },
});
