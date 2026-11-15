import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { ui } from '@/theme';

interface Person {
  id: string;
  firstName: string;
  lastName: string;
}
interface Discussion {
  participant: boolean;
  owner: boolean;
  shares: Person[];
  comments: Array<{ id: string; body: string; createdAt: string; author: Person }>;
  candidates: Array<Person & { teams: string[] }>;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bratislava' });

/** Konzultácia rozostavenia medzi trénermi: zdieľanie s vybranými trénermi + komentáre. */
export function LineupDiscussion({ matchId, meId, isStaff }: { matchId: string; meId?: string; isStaff: boolean }) {
  const [data, setData] = useState<Discussion | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Discussion>(`/matches/${matchId}/lineup-discussion`));
    } catch {
      // offline / bez prístupu
    }
  }, [matchId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  if (!data || !data.participant) return null;

  async function run(fn: () => Promise<Discussion>) {
    setBusy(true);
    try {
      setData(await fn());
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Akcia zlyhala');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Konzultácia s trénermi</Text>
      <Text style={styles.hint}>Rozostavenie vidia a komentujú len tréneri, s ktorými ho zdieľate.</Text>
      <Text style={styles.line}>
        <Text style={styles.bold}>Zdieľané s: </Text>
        {data.shares.length === 0 ? 'nikým' : data.shares.map((s) => `${s.firstName} ${s.lastName}`).join(', ')}
      </Text>

      {data.owner && !editing && (
        <Pressable
          style={styles.ghost}
          onPress={() => {
            setPicked(data.shares.map((s) => s.id));
            setEditing(true);
          }}
        >
          <Text style={styles.ghostText}>Upraviť zdieľanie</Text>
        </Pressable>
      )}
      {data.owner && editing && (
        <View style={{ marginTop: 8 }}>
          {data.candidates.map((c) => {
            const on = picked.includes(c.id);
            return (
              <Pressable
                key={c.id}
                style={[styles.row, on && styles.rowOn]}
                onPress={() => setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
              >
                <Text style={styles.rowText}>
                  {on ? '✓ ' : ''}
                  {c.lastName} {c.firstName}
                  {c.teams.length ? `  · ${c.teams.join(', ')}` : ''}
                </Text>
              </Pressable>
            );
          })}
          {data.candidates.length === 0 && <Text style={styles.hint}>Žiadni ďalší tréneri.</Text>}
          <View style={styles.actions}>
            <Pressable style={styles.ghost} onPress={() => setEditing(false)}>
              <Text style={styles.ghostText}>Zrušiť</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={() =>
                run(async () => {
                  const r = await api<Discussion>(`/matches/${matchId}/lineup-shares`, {
                    method: 'PUT',
                    body: JSON.stringify({ userIds: picked }),
                  });
                  setEditing(false);
                  return r;
                })
              }
            >
              <Text style={styles.btnText}>Uložiť zdieľanie</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View style={{ marginTop: 12 }}>
        {data.comments.map((c) => (
          <View key={c.id} style={[styles.comment, c.author.id === meId && { backgroundColor: ui.panel2 }]}>
            <View style={styles.commentHead}>
              <Text style={styles.author}>
                {c.author.firstName} {c.author.lastName}
              </Text>
              <Text style={styles.time}>{when(c.createdAt)}</Text>
            </View>
            <Text style={styles.body}>{c.body}</Text>
            {(c.author.id === meId || isStaff) && (
              <Pressable onPress={() => run(() => api<Discussion>(`/matches/${matchId}/lineup-comments/${c.id}`, { method: 'DELETE' }))}>
                <Text style={styles.del}>Zmazať</Text>
              </Pressable>
            )}
          </View>
        ))}
        {data.comments.length === 0 && <Text style={styles.hint}>Zatiaľ nikto nekomentoval. Napíšte prvý názor.</Text>}
      </View>

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Napíšte názor k rozostaveniu…"
        placeholderTextColor={ui.placeholder}
        keyboardAppearance="dark"
        multiline
        maxLength={2000}
        style={styles.input}
      />
      <Pressable
        style={[styles.btn, (busy || !text.trim()) && { opacity: 0.5 }]}
        disabled={busy || !text.trim()}
        onPress={() =>
          run(async () => {
            const r = await api<Discussion>(`/matches/${matchId}/lineup-comments`, {
              method: 'POST',
              body: JSON.stringify({ body: text }),
            });
            setText('');
            return r;
          })
        }
      >
        <Text style={styles.btnText}>Odoslať</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 16, borderWidth: 1, borderColor: ui.line, borderRadius: 8, padding: 12, backgroundColor: ui.panel },
  title: { fontSize: 16, fontWeight: '700', color: ui.ink },
  hint: { color: ui.muted, fontSize: 12, marginVertical: 4 },
  line: { color: ui.ink, fontSize: 14, marginTop: 4 },
  bold: { fontWeight: '700' },
  ghost: { borderWidth: 1, borderColor: ui.blue, borderRadius: 8, padding: 10, alignItems: 'center', marginTop: 8 },
  ghostText: { color: ui.blueHi, fontWeight: '700', fontSize: 13 },
  row: { borderWidth: 1, borderColor: ui.line, borderRadius: 8, padding: 10, marginBottom: 4 },
  rowOn: { borderColor: ui.lime, backgroundColor: ui.panel2 },
  rowText: { color: ui.ink, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  btn: { flex: 1, backgroundColor: ui.blue, borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 8 },
  btnText: { color: ui.onAccent, fontWeight: '700' },
  comment: { borderRadius: 8, padding: 8, marginBottom: 6 },
  commentHead: { flexDirection: 'row', justifyContent: 'space-between' },
  author: { color: ui.lime, fontWeight: '700', fontSize: 13 },
  time: { color: ui.muted, fontSize: 11 },
  body: { color: ui.ink, fontSize: 14, marginTop: 2 },
  del: { color: ui.muted, fontSize: 11, marginTop: 4 },
  input: { borderWidth: 1, borderColor: ui.line, borderRadius: 8, padding: 10, color: ui.ink, backgroundColor: ui.panel2, minHeight: 48, marginTop: 8 },
});
