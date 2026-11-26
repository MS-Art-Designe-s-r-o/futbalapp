import { useCallback, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { API_URL, api } from '@/api';
import { ui } from '@/theme';

interface NewsItem {
  id: string;
  title: string;
  body: string | null;
  videoUrl: string | null;
  hasVideo: boolean;
  publishedAt: string | null;
  seen: boolean;
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
};

/** Novinky pre členov: video a text o tom, čo je nové v portáli a aplikáciách (zverejňuje len admin v portáli). */
export default function NewsScreen() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: NewsItem[] }>('/app-news');
      setItems(res.items);
      setNewIds((prev) => new Set([...prev, ...res.items.filter((n) => !n.seen).map((n) => n.id)]));
      // otvorenie Noviniek = všetko videné → zmizne značka na úvodnej obrazovke
      if (res.items.some((n) => !n.seen)) await api('/app-news/seen', { method: 'POST' }).catch(() => undefined);
    } catch {
      // offline — ostane posledný stav
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      data={items}
      keyExtractor={(n) => n.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListEmptyComponent={<Text style={styles.empty}>Zatiaľ nie sú žiadne novinky.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.metaRow}>
            {newIds.has(item.id) && <Text style={styles.newTag}>NOVÉ</Text>}
            {item.publishedAt && <Text style={styles.date}>{fmtDate(item.publishedAt)}</Text>}
          </View>
          <Text style={styles.title}>{item.title}</Text>
          {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
          {(item.hasVideo || item.videoUrl) && (
            <Pressable
              style={styles.playBtn}
              onPress={() => Linking.openURL(item.hasVideo ? `${API_URL}/app-news/videos/${item.id}` : item.videoUrl!)}
            >
              <Text style={styles.playText}>▶ Prehrať video</Text>
            </Pressable>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  empty: { color: ui.muted, textAlign: 'center', marginTop: 32 },
  card: { backgroundColor: ui.panel, borderRadius: 10, borderWidth: 1, borderColor: ui.line, padding: 14, marginBottom: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  newTag: { backgroundColor: ui.lime, color: ui.onLime, fontSize: 11, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  date: { color: ui.muted, fontSize: 12 },
  title: { color: ui.ink, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  body: { color: ui.muted, fontSize: 14, lineHeight: 20 },
  playBtn: { marginTop: 12, backgroundColor: ui.lime, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  playText: { color: ui.onLime, fontWeight: '800', fontSize: 15 },
});
