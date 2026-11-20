import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import {
  LINEUP_FORMATS,
  PLAYER_POSITION_LABELS_SK,
  PLAYER_POSITION_SHORT,
  defaultLineupFormat,
  type MatchLineup,
  type PlayerPosition,
} from '@fkknv/shared';
import { api } from '@/api';
import { ui } from '@/theme';

export interface LineupPlayer {
  id: string;
  firstName: string;
  lastName: string;
  position?: string | null;
}

const ORDER: PlayerPosition[] = ['GK', 'CB', 'FB', 'WB', 'CDM', 'CM', 'CAM', 'WM', 'W', 'SS', 'ST', 'UNI'];
const short = (p: string) => (PLAYER_POSITION_SHORT as Record<string, string>)[p] ?? p;
const label = (p: string) => (PLAYER_POSITION_LABELS_SK as Record<string, string>)[p]?.replace(/ \(.*\)$/, '') ?? p;

/** Rozostavenie hráčov na ihrisku (mobil): tréner skladá zostavu, ostatní ju vidia. */
export function LineupBoard({
  matchId,
  players,
  lineup,
  categoryCode,
  manage,
  title,
  onSaved,
}: {
  matchId: string;
  players: LineupPlayer[];
  lineup?: MatchLineup | null;
  categoryCode?: string | null;
  manage: boolean;
  title: string;
  onSaved: () => void;
}) {
  const [format, setFormat] = useState(lineup?.format ?? defaultLineupFormat(categoryCode));
  const [formation, setFormation] = useState(lineup?.formation ?? Object.keys(LINEUP_FORMATS[format].formations)[0]);
  const [slots, setSlots] = useState<Record<string, string>>(lineup?.slots ?? {});
  const [selPlayer, setSelPlayer] = useState<string | null>(null);
  const [selSlot, setSelSlot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [width, setWidth] = useState(0);

  const lineupKey = JSON.stringify(lineup ?? null);
  useEffect(() => {
    if (lineup && LINEUP_FORMATS[lineup.format]?.formations[lineup.formation]) {
      setFormat(lineup.format);
      setFormation(lineup.formation);
      setSlots(lineup.slots);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineupKey]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const fs = LINEUP_FORMATS[format]?.formations[formation] ?? [];
  const used = new Set(Object.values(slots));
  if (!manage && !lineup) return null;

  const reset = () => {
    setSlots({});
    setSelPlayer(null);
    setSelSlot(null);
    setSaved(false);
  };
  const changeFormat = (f: string) => {
    setFormat(f);
    setFormation(Object.keys(LINEUP_FORMATS[f].formations)[0]);
    reset();
  };
  const place = (slot: number, pid: string) => {
    setSlots((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([, id]) => id !== pid));
      next[String(slot)] = pid;
      return next;
    });
    setSelPlayer(null);
    setSelSlot(null);
    setSaved(false);
  };
  const tapSlot = (i: number) => {
    if (!manage) return;
    if (selPlayer) return place(i, selPlayer);
    if (slots[String(i)]) {
      setSlots((prev) => {
        const next = { ...prev };
        delete next[String(i)];
        return next;
      });
      setSaved(false);
      return;
    }
    setSelSlot(selSlot === i ? null : i);
  };
  const tapPlayer = (id: string) => {
    if (selSlot !== null) return place(selSlot, id);
    setSelPlayer(selPlayer === id ? null : id);
  };
  const suggest = () => {
    const taken = new Set<string>();
    const next: Record<string, string> = {};
    fs.forEach((s, i) => {
      const c = players.find((p) => p.position === s.pos && !taken.has(p.id));
      if (c) {
        next[String(i)] = c.id;
        taken.add(c.id);
      }
    });
    setSlots(next);
    setSaved(false);
  };
  async function save() {
    setBusy(true);
    try {
      await api(`/matches/${matchId}/lineup`, {
        method: 'PUT',
        body: JSON.stringify(Object.keys(slots).length === 0 ? null : { format, formation, slots }),
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  }
  /** Tlač/zdieľanie: zostava ako text cez systémové okno (odtiaľ ju možno vytlačiť). A4 tlač je vo webovom portáli. */
  async function share() {
    const lines = fs.map((s, i) => {
      const p = byId.get(slots[String(i)] ?? '');
      return `${short(s.pos)}  ${p ? `${p.lastName} ${p.firstName}` : '—'}`;
    });
    const bench = players.filter((p) => !used.has(p.id)).map((p) => `${p.lastName} ${p.firstName}`);
    await Share.share({
      message: `${title}\nFormát ${format} · ${formation}\n\nZáklad:\n${lines.join('\n')}\n\nNáhradníci:\n${bench.join('\n') || '—'}`,
    });
  }

  const groups = ORDER.map((pos) => ({ pos, list: players.filter((p) => p.position === pos) })).filter((g) => g.list.length);
  const rest = players.filter((p) => !p.position || !ORDER.includes(p.position as PlayerPosition));
  const h = width * (100 / 68);

  return (
    <View>
      <Text style={styles.title}>
        Rozostavenie ({Object.keys(slots).length} / {fs.length})
      </Text>

      {manage && (
        <>
          <View style={styles.chips}>
            {Object.keys(LINEUP_FORMATS).map((f) => (
              <Pressable key={f} style={[styles.chip, f === format && styles.chipOn]} onPress={() => changeFormat(f)}>
                <Text style={[styles.chipText, f === format && styles.chipTextOn]}>{f}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.chips}>
            {Object.keys(LINEUP_FORMATS[format].formations).map((f) => (
              <Pressable key={f} style={[styles.chip, f === formation && styles.chipOn]} onPress={() => { setFormation(f); reset(); }}>
                <Text style={[styles.chipText, f === formation && styles.chipTextOn]}>{f}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <View style={[styles.pitch, { height: h || undefined, aspectRatio: h ? undefined : 68 / 100 }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={styles.pitchBorder} pointerEvents="none" />
        <View style={styles.halfway} pointerEvents="none" />
        <View style={styles.circle} pointerEvents="none" />
        <View style={[styles.box, { top: 2 }]} pointerEvents="none" />
        <View style={[styles.box, { bottom: 2 }]} pointerEvents="none" />
        {width > 0 &&
          fs.map((s, i) => {
            const p = byId.get(slots[String(i)] ?? '');
            const off = p && p.position !== s.pos;
            return (
              <Pressable
                key={i}
                disabled={!manage}
                onPress={() => tapSlot(i)}
                style={{ position: 'absolute', left: (s.x / 100) * width - 34, top: (s.y / 100) * h - 20, width: 68, alignItems: 'center' }}
              >
                <View
                  style={[
                    styles.dot,
                    p && styles.dotOn,
                    off && { borderColor: '#ffc861' },
                    selSlot === i && { borderWidth: 4 },
                  ]}
                >
                  <Text style={[styles.dotText, p && { color: '#14201a' }]}>{short(s.pos)}</Text>
                </View>
                <Text numberOfLines={1} style={styles.nm}>
                  {p ? p.lastName : ''}
                </Text>
              </Pressable>
            );
          })}
      </View>
      <Text style={styles.hint}>Biely kruh = na svojom postavení, oranžový okraj = na inom postavení, čiarkovaný = voľný post.</Text>

      {manage ? (
        <>
          <Text style={styles.hint}>Ťuknite na hráča a potom na post (alebo naopak). Ťuknutím na obsadený post hráča zložíte.</Text>
          {[...groups, ...(rest.length ? [{ pos: '' as PlayerPosition, list: rest }] : [])].map((g) => (
            <View key={g.pos || 'none'} style={{ marginBottom: 8 }}>
              <Text style={styles.grp}>
                {g.pos ? label(g.pos) : 'Bez postavenia'} ({g.list.length})
              </Text>
              {g.list.map((p) => (
                <Pressable
                  key={p.id}
                  style={[styles.row, selPlayer === p.id && styles.rowSel, used.has(p.id) && { opacity: 0.5 }]}
                  onPress={() => tapPlayer(p.id)}
                >
                  <Text style={styles.rowText}>
                    {p.lastName} {p.firstName}
                  </Text>
                  <Text style={styles.rowPos}>{used.has(p.id) ? 'v zostave' : p.position ? short(p.position) : ''}</Text>
                </Pressable>
              ))}
            </View>
          ))}
          {players.length === 0 && <Text style={styles.hint}>Najprv nominujte hráčov.</Text>}
          <View style={styles.actions}>
            <Pressable style={styles.btnGhost} onPress={suggest}>
              <Text style={styles.btnGhostText}>Navrhnúť podľa postavenia</Text>
            </Pressable>
            <Pressable style={styles.btnGhost} onPress={reset}>
              <Text style={styles.btnGhostText}>Vyčistiť</Text>
            </Pressable>
          </View>
          <View style={styles.actions}>
            <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save}>
              <Text style={styles.btnText}>{busy ? 'Ukladám…' : saved ? 'Uložené ✓' : 'Uložiť rozostavenie'}</Text>
            </Pressable>
            <Pressable style={styles.btnGhost} onPress={share} disabled={Object.keys(slots).length === 0}>
              <Text style={styles.btnGhostText}>🖨 Tlač / zdieľať</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          <Pressable style={styles.btnGhost} onPress={share}>
            <Text style={styles.btnGhostText}>🖨 Tlač / zdieľať</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '700', color: ui.ink, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: ui.panel },
  chipOn: { borderColor: ui.lime, backgroundColor: ui.panel2 },
  chipText: { color: ui.ink, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: ui.lime },
  pitch: { width: '100%', backgroundColor: '#2f8a52', borderRadius: 8, overflow: 'hidden', marginBottom: 6 },
  pitchBorder: { position: 'absolute', left: 4, right: 4, top: 4, bottom: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,.7)' },
  halfway: { position: 'absolute', left: 4, right: 4, top: '50%', height: 1, backgroundColor: 'rgba(255,255,255,.7)' },
  circle: { position: 'absolute', left: '35%', top: '41%', width: '30%', aspectRatio: 1, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,.7)' },
  box: { position: 'absolute', left: '24%', right: '24%', height: '14%', borderWidth: 1, borderColor: 'rgba(255,255,255,.7)' },
  dot: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderStyle: 'dashed', borderColor: '#fff', backgroundColor: 'rgba(0,0,0,.2)', alignItems: 'center', justifyContent: 'center' },
  dotOn: { borderStyle: 'solid', backgroundColor: '#fff' },
  dotText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  nm: { fontSize: 11, fontWeight: '700', color: '#fff', textAlign: 'center', marginTop: 2, textShadowColor: 'rgba(0,0,0,.7)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } },
  hint: { color: ui.muted, fontSize: 12, marginBottom: 8 },
  grp: { color: ui.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: ui.line, borderRadius: 8, padding: 10, marginBottom: 4, backgroundColor: ui.panel },
  rowSel: { borderColor: ui.lime, backgroundColor: ui.panel2 },
  rowText: { color: ui.ink, fontSize: 14 },
  rowPos: { color: ui.muted, fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  btn: { flex: 1, backgroundColor: ui.blue, borderRadius: 8, padding: 12, alignItems: 'center' },
  btnText: { color: ui.onAccent, fontWeight: '700' },
  btnGhost: { flex: 1, borderWidth: 1, borderColor: ui.blue, borderRadius: 8, padding: 12, alignItems: 'center' },
  btnGhostText: { color: ui.blueHi, fontWeight: '700', fontSize: 13 },
});
