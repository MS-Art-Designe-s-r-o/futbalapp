import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatEventDateTimeSk } from '@fkknv/shared';
import { api } from '@/api';
import { canManageTeam, fetchMe, type Me } from '@/auth';
import { ui } from '@/theme';

interface Tournament {
  event: {
    id: string;
    title: string;
    startAt: string;
    endAt: string | null;
    location: string | null;
    address?: string | null;
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
  }>;
  nominations: Array<{ memberId: string; firstName: string; lastName: string }>;
}

interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  nominated: boolean;
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

  if (!t) {
    return (
      <View style={styles.center}>
        <Text style={{ color: ui.muted }}>Načítavam turnaj…</Text>
      </View>
    );
  }

  const { event } = t;
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
          </Pressable>
        );
      })}

      <Text style={styles.h}>Zúčastnené mužstvá</Text>
      {t.participants.length === 0 && <Text style={styles.empty}>—</Text>}
      {t.participants.map((p) => (
        <Text key={p.id} style={styles.line}>
          {p.clubName}
        </Text>
      ))}

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
