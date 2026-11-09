import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { canManage, fetchMe, type Me } from '@/auth';
import { ui } from '@/theme';

/** Štatistiky — rozcestník (Previerky pre vedenie a trénerov). */
export default function StatisticsScreen() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetchMe().then(setMe).catch(() => {});
  }, []);

  return (
    <View style={styles.container}>
      {canManage(me) && (
        <Pressable style={styles.tile} onPress={() => router.push('/previerky')}>
          <Text style={styles.emoji}>⏱️</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Testovanie</Text>
            <Text style={styles.subtitle}>Behy, člnkový beh, skok z miesta — výsledky hráčov, zadanie a úprava.</Text>
          </View>
        </Pressable>
      )}
      <View style={[styles.tile, { opacity: 0.6 }]}>
        <Text style={styles.emoji}>📊</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Ďalšie štatistiky</Text>
          <Text style={styles.subtitle}>Pripravujeme.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg, padding: 16 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: ui.panel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ui.line,
    padding: 16,
    marginBottom: 10,
  },
  emoji: { fontSize: 32 },
  title: { fontSize: 17, fontWeight: '700', color: ui.ink },
  subtitle: { fontSize: 13, color: ui.muted, marginTop: 2 },
});
