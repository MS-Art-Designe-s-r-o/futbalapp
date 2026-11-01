import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import {
  DEFAULT_HALF_LENGTH_MIN,
  MATCH_EVENT_LABELS_SK,
  computeMatchClock,
  formatEventTimeSk,
  type MatchEventType,
  type MatchTimerAction,
} from '@fkknv/shared';
import { API_URL, api, getToken } from '@/api';
import { canManageTeam, fetchMe, type Me } from '@/auth';
import { enqueue, flush } from '@/offline';
import { ui } from '@/theme';
import { JerseyPair, JerseyPicker, jerseyList } from '@/JerseySwatch';
import { KeyboardScreen } from '@/KeyboardScreen';
import { MatchTimerCard, timerOf, type MatchTimerFields } from '@/MatchTimerCard';

interface Nomination {
  id: string;
  member: { id: string; firstName: string; lastName: string };
}

interface MatchEventRow {
  id: string;
  minute: number;
  stoppage?: number | null;
  type: string;
  member: { lastName: string } | null;
}

interface MatchDetail extends MatchTimerFields {
  id: string;
  opponent: string;
  isHome: boolean;
  isFriendly?: boolean;
  scoreUs: number | null;
  scoreThem: number | null;
  state: string;
  meetAt: string | null;
  notes: string | null;
  jerseyColor?: 'DARK' | 'LIGHT' | null;
  jerseyColors?: ('DARK' | 'LIGHT')[];
  videoUrl: string | null;
  highlightsUrl: string | null;
  event: {
    title: string;
    startAt: string;
    location?: string | null;
    address?: string | null;
    tournamentOrder?: number | null;
    parent?: { id: string; title: string } | null;
    team: { id: string; name: string } | null;
  };
  nominations: Nomination[];
  events: MatchEventRow[];
  photos: Array<{ id: string; mimeType: string; size: number; createdAt: string }>;
}

const eventLabels: Record<string, string> = MATCH_EVENT_LABELS_SK;

// akcie viazané na hráča vs tímové
const PLAYER_ACTIONS: MatchEventType[] = ['GOAL', 'ASSIST', 'PENALTY_SCORED', 'PENALTY_MISSED', 'YELLOW', 'RED', 'FOUL', 'SHOT'];
const TEAM_ACTIONS: MatchEventType[] = ['GOAL_CONCEDED', 'CORNER'];

function fmtMinute(minute: number, stoppage?: number | null) {
  return stoppage ? `${minute}+${stoppage}` : `${minute}`;
}

export default function MatchLiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [selected, setSelected] = useState<Nomination | null>(null);
  const [minute, setMinute] = useState('0');
  const [stoppage, setStoppage] = useState('');
  const [scoreUs, setScoreUs] = useState('0');
  const [scoreThem, setScoreThem] = useState('0');
  const [pending, setPending] = useState(0);
  const [me, setMe] = useState<Me | null>(null);
  const [meetDraft, setMeetDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [videoDraft, setVideoDraft] = useState('');
  const [highlightsDraft, setHighlightsDraft] = useState('');
  const [videoBusy, setVideoBusy] = useState(false);
  const [veoBusy, setVeoBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [halfDraft, setHalfDraft] = useState(String(DEFAULT_HALF_LENGTH_MIN));
  const [timerBusy, setTimerBusy] = useState(false);
  // minúta/nadstavenie udalosti sa predvypĺňa z časomiery, kým ju používateľ ručne neprepíše
  const [minuteAuto, setMinuteAuto] = useState(true);
  // posun hodín servera voči telefónu (ms) a tikajúci „teraz" pre časomieru
  const clockOffset = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const { pending: p } = await flush();
    setPending(p);
    try {
      const detail = await api<MatchDetail>(`/matches/${id}`);
      if (detail.serverNow) clockOffset.current = new Date(detail.serverNow).getTime() - Date.now();
      setMatch(detail);
    } catch {
      // offline — pracujeme s poslednym stavom
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    fetchMe().then(setMe).catch(() => {});
  }, []);

  const timerPhase = match?.timerPhase ?? 'NOT_STARTED';
  const timerRunning = timerPhase === 'FIRST_HALF' || timerPhase === 'SECOND_HALF';

  // tikanie časomiery (zobrazenie sa počíta z časových značiek servera)
  useEffect(() => {
    const tick = () => setNow(Date.now() + clockOffset.current);
    tick();
    if (!timerRunning) return;
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [timerRunning, match?.firstHalfStartedAt, match?.secondHalfStartedAt, match?.serverNow]);

  // počas živého zápasu obnovuj stav (časomiera, skóre, udalosti) a odosielaj offline frontu
  useEffect(() => {
    if (match?.state !== 'LIVE') return;
    const h = setInterval(() => {
      void load().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(h);
  }, [match?.state, load]);

  useEffect(() => {
    if (match) setHalfDraft(String(match.halfLengthMin ?? DEFAULT_HALF_LENGTH_MIN));
  }, [match?.halfLengthMin]);

  // predvyplnenie minúty udalosti z časomiery
  const clock = match ? computeMatchClock(timerOf(match), now) : null;
  const timerMinute = clock && clock.phase !== 'NOT_STARTED' ? clock : null;
  useEffect(() => {
    if (!minuteAuto || !timerMinute) return;
    setMinute(String(timerMinute.minute));
    setStoppage(timerMinute.stoppage ? String(timerMinute.stoppage) : '');
  }, [minuteAuto, timerMinute?.minute, timerMinute?.stoppage]);

  async function timerAction(action: MatchTimerAction) {
    setTimerBusy(true);
    try {
      await api(`/matches/${id}/timer`, { method: 'POST', body: JSON.stringify({ action }) });
      await load();
      setMinuteAuto(true);
    } catch (e) {
      Alert.alert('Časomiera', e instanceof Error ? e.message : 'Akcia zlyhala');
    } finally {
      setTimerBusy(false);
    }
  }

  // skóre v poliach drž zosynchronizované s načítaným zápasom
  useEffect(() => {
    if (match) {
      setScoreUs(String(match.scoreUs ?? 0));
      setScoreThem(String(match.scoreThem ?? 0));
    }
  }, [match?.scoreUs, match?.scoreThem]);

  // čas zrazu (meetAt alebo hodina pred začiatkom) a poznámky z načítaného zápasu
  useEffect(() => {
    if (match) {
      setMeetDraft(formatEventTimeSk(match.meetAt ?? new Date(new Date(match.event.startAt).getTime() - 3_600_000)));
      setNotesDraft(match.notes ?? '');
      setVideoDraft(match.videoUrl ?? '');
      setHighlightsDraft(match.highlightsUrl ?? '');
    }
  }, [match?.meetAt, match?.notes, match?.videoUrl, match?.highlightsUrl, match?.event.startAt]);

  async function saveDetails() {
    if (!match) return;
    const halfLengthMin = Math.trunc(Number(halfDraft));
    if (!(halfLengthMin >= 1 && halfLengthMin <= 60)) {
      Alert.alert('Chyba', 'Dĺžka polčasu musí byť 1–60 minút.');
      return;
    }
    setDetailsBusy(true);
    try {
      const start = new Date(match.event.startAt);
      const m = /^(\d{1,2}):(\d{2})$/.exec(meetDraft.trim());
      const meetAt = m
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), Number(m[1]), Number(m[2]))).toISOString()
        : null;
      await api(`/matches/${id}/details`, {
        method: 'POST',
        body: JSON.stringify({ meetAt, notes: notesDraft, halfLengthMin }),
      });
      await load();
      Alert.alert('Uložené', 'Nastavenia zápasu boli uložené.');
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Uloženie zlyhalo');
    } finally {
      setDetailsBusy(false);
    }
  }

  async function setJersey(colors: ('DARK' | 'LIGHT')[]) {
    try {
      await api(`/matches/${id}/details`, { method: 'POST', body: JSON.stringify({ jerseyColors: colors }) });
      await load();
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Uloženie zlyhalo');
    }
  }

  async function saveVideo(url: string | null) {
    setVideoBusy(true);
    try {
      await api(`/matches/${id}/video`, { method: 'POST', body: JSON.stringify({ url }) });
      await load();
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Uloženie videa zlyhalo');
    } finally {
      setVideoBusy(false);
    }
  }

  async function saveHighlights(url: string | null) {
    setVideoBusy(true);
    try {
      await api(`/matches/${id}/highlights`, { method: 'POST', body: JSON.stringify({ url }) });
      await load();
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Uloženie highlightov zlyhalo');
    } finally {
      setVideoBusy(false);
    }
  }

  async function findVeoVideo() {
    setVeoBusy(true);
    try {
      const res = await api<{ candidates: Array<{ url: string; title: string; recordedAt: string | null }> }>(
        `/matches/${id}/video/candidates`,
      );
      if (!res.candidates.length) {
        Alert.alert('Veo', 'Nenašlo sa zodpovedajúce video. Skontrolujte dátum/tímy alebo vložte odkaz ručne.');
        return;
      }
      if (res.candidates.length === 1) {
        await saveVideo(res.candidates[0].url);
        Alert.alert('Veo', 'Video bolo pridané.');
        return;
      }
      Alert.alert(
        'Vyberte video',
        'Nájdených viac videí:',
        [
          ...res.candidates.slice(0, 3).map((c) => ({
            text: c.title.slice(0, 40),
            onPress: () => saveVideo(c.url),
          })),
          { text: 'Zrušiť', style: 'cancel' as const },
        ],
      );
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Hľadanie Veo videa zlyhalo');
    } finally {
      setVeoBusy(false);
    }
  }

  async function addPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Prístup k fotkám', 'Povoľte prístup k fotkám v nastaveniach.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets?.length) return;
    setPhotoBusy(true);
    try {
      const token = await getToken();
      for (const a of res.assets) {
        const form = new FormData();
        form.append('file', {
          uri: a.uri,
          name: a.fileName ?? `foto-${Date.now()}.jpg`,
          type: a.mimeType ?? 'image/jpeg',
        } as unknown as Blob);
        const resp = await fetch(`${API_URL}/matches/${id}/photos`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        if (!resp.ok) {
          const body = (await resp.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? 'Nahratie zlyhalo');
        }
      }
      await load();
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Nahratie fotky zlyhalo');
    } finally {
      setPhotoBusy(false);
    }
  }

  function confirmDeletePhoto(photoId: string) {
    Alert.alert('Zmazať fotku?', 'Fotku natrvalo odstrániť?', [
      { text: 'Zrušiť', style: 'cancel' },
      {
        text: 'Zmazať',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/matches/${id}/photos/${photoId}`, { method: 'DELETE' });
            await load();
          } catch (e) {
            Alert.alert('Chyba', e instanceof Error ? e.message : 'Zmazanie zlyhalo');
          }
        },
      },
    ]);
  }

  async function setState(state: string) {
    try {
      await api(`/matches/${id}/state`, { method: 'POST', body: JSON.stringify({ state }) });
      await load();
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Zmena stavu zlyhala');
    }
  }

  async function saveScore() {
    try {
      await api(`/matches/${id}/score`, {
        method: 'POST',
        body: JSON.stringify({ scoreUs: Number(scoreUs) || 0, scoreThem: Number(scoreThem) || 0 }),
      });
      await load();
      Alert.alert('Uložené', 'Výsledok bol uložený.');
    } catch (e) {
      Alert.alert('Chyba', e instanceof Error ? e.message : 'Uloženie výsledku zlyhalo');
    }
  }

  async function record(type: string, needsPlayer: boolean) {
    if (needsPlayer && !selected) {
      Alert.alert('Vyberte hráča', 'Najprv ťuknite na hráča v zozname nižšie.');
      return;
    }
    let min = Number(minute) || 0;
    let stop = Number(stoppage) > 0 ? Number(stoppage) : undefined;
    if (minuteAuto && match && timerMinute) {
      // automaticky: presná minúta z časomiery v okamihu ťuknutia
      const c = computeMatchClock(timerOf(match), Date.now() + clockOffset.current);
      min = c.minute;
      stop = c.stoppage;
    }
    const payload = {
      clientId: Crypto.randomUUID(),
      minute: min,
      stoppage: stop,
      type,
      memberId: needsPlayer ? selected!.member.id : undefined,
    };
    // optimisticky do logu, zápis cez offline frontu
    setMatch((prev) =>
      prev
        ? {
            ...prev,
            scoreUs: type === 'GOAL' || type === 'PENALTY_SCORED' ? (prev.scoreUs ?? 0) + 1 : prev.scoreUs,
            scoreThem: type === 'GOAL_CONCEDED' ? (prev.scoreThem ?? 0) + 1 : prev.scoreThem,
            events: [
              ...prev.events,
              {
                id: payload.clientId,
                minute: min,
                stoppage: stop,
                type,
                member: needsPlayer ? { lastName: selected!.member.lastName } : null,
              },
            ],
          }
        : prev,
    );
    const { pending: p } = await enqueue({ kind: 'matchEvent', matchId: id, payload });
    setPending(p);
    setSelected(null);
    setMinuteAuto(true);
  }

  if (!match) {
    return (
      <View style={styles.center}>
        <Text style={{ color: ui.muted }}>Načítavam zápas…</Text>
      </View>
    );
  }

  const recording = match.state === 'LIVE' || match.state === 'FINISHED';
  // len vedenie a tréner daného družstva môžu zápas riadiť; rodič/hráč má náhľad
  const canControl = canManageTeam(me, match.event.team?.id);
  const myChildren = me?.children ?? [];

  return (
    <KeyboardScreen style={styles.container}>
      <Text style={styles.title}>{match.event.title}</Text>
      {match.isFriendly && <Text style={{ color: ui.lime, fontWeight: '700', marginBottom: 4 }}>Priateľský zápas</Text>}
      {match.event.parent && (
        <Link href={`/tournament/${match.event.parent.id}`} style={{ color: ui.lime, fontWeight: '600', marginBottom: 4 }}>
          Turnaj: {match.event.parent.title}
          {match.event.tournamentOrder ? ` · ${match.event.tournamentOrder}. zápas` : ''} →
        </Link>
      )}
      {match.event.location && match.event.address ? (
        <Pressable
          onPress={() =>
            Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(match.event.address!)}`)
          }
        >
          <Text style={{ color: ui.lime, textDecorationLine: 'underline', marginBottom: 4 }}>📍 {match.event.location}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.score}>
        {(match.isHome ? match.scoreUs : match.scoreThem) ?? 0} : {(match.isHome ? match.scoreThem : match.scoreUs) ?? 0}
      </Text>
      <Text style={styles.stateText}>
        {match.state === 'LIVE' ? '● NAŽIVO' : match.state === 'FINISHED' ? 'Ukončený' : match.state === 'CANCELLED' ? 'Zrušený' : 'Plánovaný'}
      </Text>
      {pending > 0 && <Text style={styles.offline}>Offline — {pending} udalostí čaká na odoslanie.</Text>}

      <MatchTimerCard timer={match} matchState={match.state} now={now} manage={canControl} busy={timerBusy} onAction={timerAction} />

      {/* Zraz a poznámky */}
      {canControl ? (
        <View style={styles.meetBox}>
          <Text style={styles.meetLabel}>Čas zrazu (HH:MM)</Text>
          <TextInput
            style={styles.meetInput}
            value={meetDraft}
            onChangeText={setMeetDraft}
            placeholder="napr. 15:30"
            placeholderTextColor={ui.placeholder}
            keyboardType="numbers-and-punctuation"
          />
          <Text style={[styles.meetLabel, { marginTop: 8 }]}>Dĺžka polčasu (min)</Text>
          <TextInput
            style={[styles.meetInput, { width: 96 }]}
            value={halfDraft}
            onChangeText={setHalfDraft}
            placeholder="45"
            placeholderTextColor={ui.placeholder}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={[styles.meetLabel, { marginTop: 8 }]}>Poznámky k zápasu</Text>
          <TextInput
            style={[styles.meetInput, styles.meetNotesInput]}
            value={notesDraft}
            onChangeText={setNotesDraft}
            placeholder="výstroj, doprava, zraz pri klubovni…"
            placeholderTextColor={ui.placeholder}
            multiline
          />
          <JerseyPicker label="Dres nášho mužstva" value={jerseyList(match)} onChange={setJersey} />
          <Pressable
            style={[styles.saveScoreBtn, detailsBusy && { opacity: 0.5 }, { alignSelf: 'flex-end', marginTop: 8 }]}
            onPress={saveDetails}
            disabled={detailsBusy}
          >
            <Text style={styles.saveScoreText}>{detailsBusy ? 'Ukladám…' : 'Uložiť nastavenia'}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.meetBox}>
          <Text style={styles.meetLine}>
            <Text style={styles.meetLabel}>Zraz: </Text>
            {formatEventTimeSk(match.meetAt ?? new Date(new Date(match.event.startAt).getTime() - 3_600_000))}
          </Text>
          <JerseyPair colors={jerseyList(match)} size={14} />
          <Text style={styles.meetLine}>
            <Text style={styles.meetLabel}>Polčas: </Text>
            {match.halfLengthMin ?? DEFAULT_HALF_LENGTH_MIN} min
          </Text>
          {match.notes ? (
            <Text style={styles.meetNotes}>
              <Text style={styles.meetLabel}>Poznámky: </Text>
              {match.notes}
            </Text>
          ) : null}
        </View>
      )}

      {/* Video a fotky zo zápasu — po spustení/ukončení */}
      {(match.state === 'LIVE' || match.state === 'FINISHED') && (
        <View style={styles.meetBox}>
          <Text style={styles.sectionTitle}>Video a fotky zo zápasu</Text>
          {canControl ? (
            <>
              <Text style={styles.meetLabel}>Video zápasu (odkaz, napr. Veo)</Text>
              <TextInput
                style={styles.meetInput}
                value={videoDraft}
                onChangeText={setVideoDraft}
                placeholder="https://app.veo.co/matches/…"
                placeholderTextColor={ui.placeholder}
                autoCapitalize="none"
                keyboardType="url"
              />
              <View style={styles.videoBtnRow}>
                <Pressable
                  style={[styles.saveScoreBtn, videoBusy && { opacity: 0.5 }]}
                  onPress={() => saveVideo(videoDraft.trim() || null)}
                  disabled={videoBusy}
                >
                  <Text style={styles.saveScoreText}>{videoBusy ? 'Ukladám…' : 'Uložiť odkaz'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtnSmall, veoBusy && { opacity: 0.5 }]}
                  onPress={findVeoVideo}
                  disabled={veoBusy}
                >
                  <Text style={styles.primaryBtnText}>{veoBusy ? 'Hľadám…' : 'Nájsť video (Veo)'}</Text>
                </Pressable>
              </View>
              <Text style={styles.meetLabel}>Highlighty (odkaz)</Text>
              <TextInput
                style={styles.meetInput}
                value={highlightsDraft}
                onChangeText={setHighlightsDraft}
                placeholder="https://…"
                placeholderTextColor={ui.placeholder}
                autoCapitalize="none"
                keyboardType="url"
              />
              <View style={styles.videoBtnRow}>
                <Pressable
                  style={[styles.saveScoreBtn, videoBusy && { opacity: 0.5 }]}
                  onPress={() => saveHighlights(highlightsDraft.trim() || null)}
                  disabled={videoBusy}
                >
                  <Text style={styles.saveScoreText}>{videoBusy ? 'Ukladám…' : 'Uložiť odkaz'}</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {match.videoUrl ? (
            <Pressable onPress={() => Linking.openURL(match.videoUrl!)}>
              <Text style={styles.videoLink}>▶ Video zápasu</Text>
            </Pressable>
          ) : null}
          {match.highlightsUrl ? (
            <Pressable onPress={() => Linking.openURL(match.highlightsUrl!)}>
              <Text style={styles.videoLink}>▶ Highlighty</Text>
            </Pressable>
          ) : null}
          {!match.videoUrl && !match.highlightsUrl && !canControl ? (
            <Text style={styles.empty}>Video zatiaľ nie je pridané.</Text>
          ) : null}

          <View style={styles.photosHeader}>
            <Text style={styles.meetLabel}>Fotky ({match.photos.length})</Text>
            {canControl && (
              <Pressable onPress={addPhoto} disabled={photoBusy}>
                <Text style={styles.videoLink}>{photoBusy ? 'Nahrávam…' : '+ Pridať fotku'}</Text>
              </Pressable>
            )}
          </View>
          {match.photos.length ? (
            <View style={styles.photoGrid}>
              {match.photos.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => Linking.openURL(`${API_URL}/matches/photos/${p.id}`)}
                  onLongPress={canControl ? () => confirmDeletePhoto(p.id) : undefined}
                >
                  <Image source={{ uri: `${API_URL}/matches/photos/${p.id}` }} style={styles.photoThumb} />
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>Zatiaľ žiadne fotky.</Text>
          )}
          {canControl && match.photos.length > 0 && (
            <Text style={styles.photoHint}>Podržaním fotky ju zmažete.</Text>
          )}
        </View>
      )}

      {/* editovateľný výsledok */}
      {recording && canControl && (
        <View style={styles.scoreEditRow}>
          <View style={styles.scoreEditCol}>
            <Text style={styles.scoreEditLabel}>Domáci</Text>
            <TextInput
              style={styles.numInput}
              keyboardType="number-pad"
              value={match.isHome ? scoreUs : scoreThem}
              onChangeText={match.isHome ? setScoreUs : setScoreThem}
            />
          </View>
          <Text style={styles.scoreColon}>:</Text>
          <View style={styles.scoreEditCol}>
            <Text style={styles.scoreEditLabel}>Hostia</Text>
            <TextInput
              style={styles.numInput}
              keyboardType="number-pad"
              value={match.isHome ? scoreThem : scoreUs}
              onChangeText={match.isHome ? setScoreThem : setScoreUs}
            />
          </View>
          <Pressable style={styles.saveScoreBtn} onPress={saveScore}>
            <Text style={styles.saveScoreText}>Uložiť</Text>
          </Pressable>
        </View>
      )}

      {canControl && (
        <View style={styles.buttonRow}>
          {match.state === 'PLANNED' && (
            <Pressable style={styles.primaryBtn} onPress={() => setState('LIVE')}>
              <Text style={styles.primaryBtnText}>Začať zápas</Text>
            </Pressable>
          )}
          {match.state === 'LIVE' && (
            <Pressable style={[styles.primaryBtn, { backgroundColor: ui.red }]} onPress={() => setState('FINISHED')}>
              <Text style={styles.primaryBtnText}>Ukončiť zápas</Text>
            </Pressable>
          )}
          {match.state === 'FINISHED' && (
            <Pressable style={styles.secondaryBtn} onPress={() => setState('LIVE')}>
              <Text style={styles.secondaryBtnText}>Znovu otvoriť</Text>
            </Pressable>
          )}
          <Link href={`/match/${id}/nomination`} asChild>
            <Pressable style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Nominácia</Text>
            </Pressable>
          </Link>
        </View>
      )}

      {/* Náhľad nominácie pre rodiča/hráča (bez riadenia zápasu) */}
      {!canControl && (
        <View style={styles.nomBox}>
          <Text style={styles.sectionTitle}>Nominácia</Text>
          {myChildren.length > 0 &&
            myChildren.map((c) => {
              const nominated = match.nominations.some((n) => n.member.id === c.id);
              return (
                <View key={c.id} style={styles.nomChildRow}>
                  <Text style={styles.playerName}>
                    {c.lastName} {c.firstName}
                  </Text>
                  <Text style={[styles.nomBadge, nominated ? styles.nomYes : styles.nomNo]}>
                    {nominated ? 'V nominácii ✓' : 'Nie je v nominácii'}
                  </Text>
                </View>
              );
            })}
          {match.nominations.length === 0 ? (
            <Text style={styles.empty}>Nominácia zatiaľ nebola zverejnená.</Text>
          ) : (
            match.nominations.map((n) => {
              const mine = myChildren.some((c) => c.id === n.member.id);
              return (
                <View key={n.id} style={[styles.playerRow, mine && styles.playerRowSelected]}>
                  <Text style={styles.playerName}>
                    {n.member.lastName} {n.member.firstName}
                  </Text>
                  {mine && <Text style={styles.check}>✓</Text>}
                </View>
              );
            })
          )}
        </View>
      )}

      {recording && canControl && (
        <>
          {/* minúta + nadstavenie */}
          <View style={styles.minuteRow}>
            <View style={styles.minuteCol}>
              <Text style={styles.minuteLabel}>Minúta</Text>
              <TextInput
                style={styles.numInput}
                keyboardType="number-pad"
                value={minute}
                onChangeText={(v) => {
                  setMinuteAuto(false);
                  setMinute(v);
                }}
              />
            </View>
            <Text style={styles.plus}>+</Text>
            <View style={styles.minuteCol}>
              <Text style={styles.minuteLabel}>Nadstavenie</Text>
              <TextInput
                style={styles.numInput}
                keyboardType="number-pad"
                value={stoppage}
                onChangeText={(v) => {
                  setMinuteAuto(false);
                  setStoppage(v);
                }}
                placeholder="0"
                placeholderTextColor={ui.placeholder}
              />
            </View>
          </View>

          {timerMinute && (
            <View style={styles.autoRow}>
              {minuteAuto ? (
                <Text style={styles.autoText}>Minúta sa dopĺňa z časomiery ({timerMinute.label}) — môžete ju ručne upraviť.</Text>
              ) : (
                <Pressable onPress={() => setMinuteAuto(true)} hitSlop={8}>
                  <Text style={styles.autoText}>
                    Ručne upravená minúta · <Text style={styles.autoLink}>↻ podľa časomiery ({timerMinute.label})</Text>
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {selected && (
            <Text style={styles.selectedHint}>
              Vybraný: {selected.member.lastName} — ťuknite na akciu hráča
            </Text>
          )}
          <View style={styles.actionsGrid}>
            {PLAYER_ACTIONS.map((t) => (
              <Pressable key={t} style={styles.actionBtn} onPress={() => record(t, true)}>
                <Text style={styles.actionText}>{eventLabels[t]}</Text>
              </Pressable>
            ))}
            {TEAM_ACTIONS.map((t) => (
              <Pressable key={t} style={[styles.actionBtn, styles.teamActionBtn]} onPress={() => record(t, false)}>
                <Text style={styles.actionText}>{eventLabels[t]}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Hráč — ťuknutím vyberte</Text>
          {match.nominations.length === 0 && <Text style={styles.empty}>Najprv pridajte hráčov cez „Nominácia".</Text>}
          {match.nominations.map((item) => (
            <Pressable
              key={item.id}
              style={[styles.playerRow, selected?.id === item.id && styles.playerRowSelected]}
              onPress={() => setSelected(selected?.id === item.id ? null : item)}
            >
              <Text style={styles.playerName}>
                {item.member.lastName} {item.member.firstName}
              </Text>
              {selected?.id === item.id && <Text style={styles.check}>✓</Text>}
            </Pressable>
          ))}
        </>
      )}

      <Text style={styles.sectionTitle}>Priebeh zápasu</Text>
      {match.events.length === 0 && <Text style={styles.empty}>Zatiaľ žiadne udalosti.</Text>}
      {match.events.map((e) => (
        <View key={e.id} style={styles.logRow}>
          <Text style={styles.logMinute}>{fmtMinute(e.minute, e.stoppage)}'</Text>
          <Text style={styles.logText}>
            {eventLabels[e.type] ?? e.type}
            {e.member ? ` — ${e.member.lastName}` : ''}
          </Text>
        </View>
      ))}
    </KeyboardScreen>
  );
}

const input = {
  backgroundColor: ui.bg,
  color: ui.ink,
  borderWidth: 1,
  borderColor: ui.line,
  borderRadius: 8,
} as const;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.bg },
  title: { fontSize: 16, fontWeight: '600', color: ui.ink, textAlign: 'center' },
  score: { fontSize: 48, fontWeight: '800', color: ui.ink, textAlign: 'center', marginVertical: 4, fontVariant: ['tabular-nums'] },
  stateText: { textAlign: 'center', color: ui.lime, fontWeight: '700', marginBottom: 12 },
  offline: {
    backgroundColor: ui.panel,
    borderWidth: 1,
    borderColor: ui.warn,
    color: ui.warn,
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
    fontSize: 13,
  },
  meetBox: {
    backgroundColor: ui.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ui.line,
    padding: 12,
    marginBottom: 12,
    gap: 4,
  },
  meetLine: { fontSize: 15, color: ui.ink },
  meetNotes: { fontSize: 14, color: ui.ink },
  meetLabel: { color: ui.muted },
  meetInput: {
    ...input,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    marginTop: 4,
  },
  meetNotesInput: { minHeight: 64, textAlignVertical: 'top' },
  jerseyRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  jerseyLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  jerseyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: ui.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  jerseyChipActive: { borderColor: ui.lime, backgroundColor: ui.panel2 },
  jerseyChipText: { color: ui.ink, fontWeight: '600', fontSize: 13 },
  videoBtnRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  primaryBtnSmall: { backgroundColor: ui.blue, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  videoLink: { color: ui.blueHi, fontWeight: '700', marginTop: 8 },
  photosHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  photoThumb: { width: 72, height: 72, borderRadius: 6, backgroundColor: ui.panel2 },
  photoHint: { color: ui.muted, fontSize: 11, marginTop: 6 },
  scoreEditRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 8, marginBottom: 14 },
  scoreEditCol: { alignItems: 'center' },
  scoreEditLabel: { fontSize: 11, color: ui.muted, marginBottom: 2 },
  scoreColon: { fontSize: 20, fontWeight: '800', color: ui.muted, paddingBottom: 8 },
  saveScoreBtn: {
    backgroundColor: ui.panel2,
    borderWidth: 1,
    borderColor: ui.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: 'flex-end',
  },
  saveScoreText: { color: ui.ink, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  primaryBtn: { flex: 1, backgroundColor: ui.blue, borderRadius: 8, padding: 14, alignItems: 'center' },
  primaryBtnText: { color: ui.onAccent, fontWeight: '700' },
  secondaryBtn: {
    flex: 1,
    borderColor: ui.blue,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  secondaryBtnText: { color: ui.blueHi, fontWeight: '700' },
  minuteRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 12, marginBottom: 8 },
  minuteCol: { alignItems: 'center' },
  minuteLabel: { fontSize: 11, color: ui.muted, marginBottom: 2 },
  plus: { fontSize: 22, fontWeight: '800', color: ui.muted, paddingBottom: 8 },
  numInput: {
    ...input,
    width: 72,
    paddingVertical: 8,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
  },
  autoRow: { alignItems: 'center', marginBottom: 12 },
  autoText: { color: ui.muted, fontSize: 12, textAlign: 'center' },
  autoLink: { color: ui.blueHi, fontWeight: '700' },
  selectedHint: { textAlign: 'center', color: ui.lime, marginBottom: 8, fontSize: 13 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  actionBtn: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: ui.panel,
    borderWidth: 1,
    borderColor: ui.line,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  teamActionBtn: { backgroundColor: ui.panel2 },
  actionText: { fontWeight: '700', color: ui.ink, fontSize: 13 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: ui.ink, marginTop: 8, marginBottom: 8 },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: ui.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ui.line,
    padding: 12,
    marginBottom: 6,
  },
  playerRowSelected: { borderColor: ui.lime, backgroundColor: ui.panel2 },
  playerName: { fontWeight: '600', color: ui.ink },
  check: { color: ui.lime, fontWeight: '800' },
  nomBox: { marginBottom: 8 },
  nomChildRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: ui.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ui.blue,
    padding: 12,
    marginBottom: 8,
  },
  nomBadge: { fontSize: 12, fontWeight: '700', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8, overflow: 'hidden' },
  nomYes: { backgroundColor: '#163322', color: ui.ok },
  nomNo: { backgroundColor: ui.panel2, color: ui.muted },
  logRow: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: ui.line },
  logMinute: { width: 44, fontWeight: '700', color: ui.lime },
  logText: { color: ui.ink },
  empty: { color: ui.muted, fontSize: 13 },
});
