import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatEventDateSk, positionsShort as posText } from '@fkknv/shared';
import { API_URL, api, getToken } from '@/api';
import { enqueue, flush } from '@/offline';
import { ui } from '@/theme';

interface AttendanceRow {
  id: string;
  status: string;
  member: { id: string; firstName: string; lastName: string; position?: string | null; position2?: string | null };
}

interface EventDetail {
  id: string;
  title: string;
  startAt: string;
  team?: { id: string; name: string } | null;
  attendances: AttendanceRow[];
}

interface TrainingMedia {
  photos: Array<{ id: string }>;
  videos: Array<{ id: string; title: string | null; filename: string | null }>;
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
  const [media, setMedia] = useState<TrainingMedia | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const load = useCallback(async () => {
    const { pending: p } = await flush();
    setPending(p);
    try {
      setEvent(await api<EventDetail>(`/events/${id}/attendance`));
    } catch {
      // offline — ostaneme pri poslednom lokálnom stave
    }
  }, [id]);

  // fotky a videá z tréningu — smie ich vidieť/spravovať len tréner a vedenie (inak 403 → sekcia sa nezobrazí)
  const loadMedia = useCallback(async () => {
    try {
      setMedia(await api<TrainingMedia>(`/events/${id}/media`));
    } catch {
      setMedia(null);
    }
  }, [id]);

  useEffect(() => {
    void load();
    void loadMedia();
  }, [load, loadMedia]);

  async function uploadPhotos(assets: ImagePicker.ImagePickerAsset[]) {
    setPhotoBusy(true);
    try {
      const token = await getToken();
      for (const a of assets) {
        const form = new FormData();
        form.append('file', {
          uri: a.uri,
          name: a.fileName ?? `foto-${Date.now()}.jpg`,
          type: a.mimeType ?? 'image/jpeg',
        } as unknown as Blob);
        const resp = await fetch(`${API_URL}/events/${id}/photos`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        if (!resp.ok) {
          const body = (await resp.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? 'Nahratie zlyhalo');
        }
      }
      await loadMedia();
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Nahratie fotky zlyhalo');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Prístup k fotkám', 'Povoľte prístup k fotkám v nastaveniach.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: true });
    if (!res.canceled && res.assets?.length) await uploadPhotos(res.assets);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Prístup k fotoaparátu', 'Povoľte prístup k fotoaparátu v nastaveniach.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!res.canceled && res.assets?.length) await uploadPhotos(res.assets);
  }

  function addPhoto() {
    Alert.alert('Pridať fotku', undefined, [
      { text: 'Odfotiť', onPress: () => void takePhoto() },
      { text: 'Z galérie', onPress: () => void pickFromLibrary() },
      { text: 'Zrušiť', style: 'cancel' },
    ]);
  }

  function confirmDeletePhoto(photoId: string) {
    Alert.alert('Zmazať fotku?', 'Fotku natrvalo odstrániť?', [
      { text: 'Zrušiť', style: 'cancel' },
      {
        text: 'Zmazať',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/events/${id}/photos/${photoId}`, { method: 'DELETE' });
            await loadMedia();
          } catch (e) {
            Alert.alert('Chyba', e instanceof Error ? e.message : 'Zmazanie zlyhalo');
          }
        },
      },
    ]);
  }

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
              {posText(item.member.position, item.member.position2) ? `  (${posText(item.member.position, item.member.position2)})` : ''}
            </Text>
            <Text style={[styles.status, { color: statusColors[item.status] ?? ui.muted }]}>
              {statusLabels[item.status] ?? item.status}
            </Text>
          </Pressable>
        )}
      />
      {media && (
        <View style={styles.mediaBox}>
          <View style={styles.mediaHeader}>
            <Text style={styles.mediaTitle}>Fotky z tréningu ({media.photos.length})</Text>
            <Pressable onPress={addPhoto} disabled={photoBusy}>
              <Text style={styles.mediaLink}>{photoBusy ? 'Nahrávam…' : '+ Pridať fotku'}</Text>
            </Pressable>
          </View>
          {media.photos.length > 0 ? (
            <View style={styles.photoGrid}>
              {media.photos.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => Linking.openURL(`${API_URL}/events/photos/${p.id}`)}
                  onLongPress={() => confirmDeletePhoto(p.id)}
                >
                  <Image source={{ uri: `${API_URL}/events/photos/${p.id}` }} style={styles.photoThumb} />
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.mediaEmpty}>Zatiaľ žiadne fotky.</Text>
          )}
          {media.photos.length > 0 && <Text style={styles.hint}>Podržaním fotky ju zmažete.</Text>}
          {media.videos.map((v, i) => (
            <Pressable key={v.id} onPress={() => Linking.openURL(`${API_URL}/events/videos/${v.id}`)}>
              <Text style={styles.mediaLink}>▶ {v.title || v.filename || `Video ${i + 1}`}</Text>
            </Pressable>
          ))}
        </View>
      )}
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
  mediaBox: { borderTopWidth: 1, borderTopColor: ui.line, paddingTop: 10, gap: 6 },
  mediaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mediaTitle: { color: ui.ink, fontWeight: '700', fontSize: 14 },
  mediaLink: { color: ui.lime, fontWeight: '700', fontSize: 14 },
  mediaEmpty: { color: ui.muted, fontSize: 13 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoThumb: { width: 72, height: 72, borderRadius: 6, backgroundColor: ui.panel },
  hint: { color: ui.muted, fontSize: 12, textAlign: 'center', paddingVertical: 8 },
});
