import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { ui } from '@/theme';
import { applyUpdatesOnLaunch } from '@/updates';

export default function RootLayout() {
  const router = useRouter();

  // pri štarte skontroluj a aplikuj OTA aktualizáciu (ak je dostupná)
  useEffect(() => {
    void applyUpdatesOnLaunch();
  }, []);

  // otvorenie príslušnej obrazovky po klepnutí na notifikáciu
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { type?: string; channelId?: string };
      if (data?.type === 'task') router.push('/tasks');
      else if (data?.type === 'chat' && data.channelId) router.push(`/chat/${data.channelId}`);
    });
    return () => sub.remove();
  }, [router]);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: ui.bar },
          headerTintColor: ui.ink,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: ui.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'FK KNV' }} />
        <Stack.Screen name="dashboard" options={{ title: 'Prehľad' }} />
        <Stack.Screen name="event/new" options={{ title: 'Nová udalosť' }} />
        <Stack.Screen name="event/[id]/attendance" options={{ title: 'Dochádzka' }} />
        <Stack.Screen name="statistics" options={{ title: 'Štatistiky' }} />
        <Stack.Screen name="previerky/index" options={{ title: 'Testovanie' }} />
        <Stack.Screen name="previerky/nova" options={{ title: 'Nové testovanie' }} />
        <Stack.Screen name="tasks/index" options={{ title: 'Úlohy' }} />
        <Stack.Screen name="match/[id]/index" options={{ title: 'Zápas' }} />
        <Stack.Screen name="match/[id]/nomination" options={{ title: 'Nominácia' }} />
        <Stack.Screen name="tournament/[id]" options={{ title: 'Turnaj' }} />
        <Stack.Screen name="matches/played" options={{ title: 'Odohrané zápasy' }} />
        <Stack.Screen name="chat/index" options={{ title: 'Kanály' }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
      </Stack>
    </>
  );
}
