import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { addMinutesToHhmm, defaultEventMinutes, SURFACE_CODES, WEEKDAY_SHORT_SK } from '@fkknv/shared';
import { api } from '@/api';
import { coachTeams, fetchMe, isStaff, type Me } from '@/auth';
import { ui } from '@/theme';
import { KeyboardScreen } from '@/KeyboardScreen';
import { fetchPitches, isHhmm, normHhmm, SURFACE_LABELS, toMin, type Pitch } from '@/pitches';
import { JerseySwatch } from '@/JerseySwatch';

interface Team {
  id: string;
  name: string;
  teamCategory: { code: string };
}

type Mode = 'training' | 'match' | 'tournament';

interface Club {
  id: string;
  name: string;
  logoUrl: string | null;
}

export default function NewEventScreen() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [mode, setMode] = useState<Mode>('training');
  const [recurring, setRecurring] = useState(true);
  const [teamId, setTeamId] = useState('');
  const [title, setTitle] = useState('Tréning');
  const [location, setLocation] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([2, 5]);
  const [startTime, setStartTime] = useState('16:00');
  const [endTime, setEndTime] = useState('17:00');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [date, setDate] = useState('');
  const [opponent, setOpponent] = useState('');
  const [isHome, setIsHome] = useState(true);
  const [friendly, setFriendly] = useState(false);
  const [jerseyColor, setJerseyColor] = useState<'' | 'DARK' | 'LIGHT'>('');
  const [busy, setBusy] = useState(false);
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [pitchId, setPitchId] = useState('');
  const [surface, setSurface] = useState('');
  const [endTouched, setEndTouched] = useState(false);
  const [clash, setClash] = useState('');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [clubQuery, setClubQuery] = useState('');
  const [newClub, setNewClub] = useState('');
  const [address, setAddress] = useState('');

  useEffect(() => {
    fetchMe().then(setMe).catch(() => {});
    api<Team[]>('/seasons/teams').then(setTeams).catch(() => {});
    api<Club[]>('/clubs').then(setClubs).catch(() => {});
    fetchPitches()
      .then((p) => {
        setPitches(p);
        if (p[0]) setPitchId((cur) => cur || p[0].id);
      })
      .catch(() => {});
  }, []);

  const myTeams = useMemo(() => {
    if (isStaff(me)) return teams;
    const ids = new Set(coachTeams(me).map((t) => t.id));
    return teams.filter((t) => ids.has(t.id));
  }, [teams, me]);

  useEffect(() => {
    if (myTeams[0] && !teamId) setTeamId(myTeams[0].id);
  }, [myTeams, teamId]);

  // koniec sa predvyplní podľa predvolenej dĺžky (tréning/zápas podľa kategórie), kým ho používateľ nezmení
  const categoryCode = teams.find((t) => t.id === teamId)?.teamCategory.code;
  useEffect(() => {
    if (endTouched || !isHhmm(startTime)) return;
    setEndTime(addMinutesToHhmm(startTime, defaultEventMinutes(mode === 'training' ? 'TRAINING' : mode === 'tournament' ? 'TOURNAMENT' : 'MATCH', categoryCode)));
  }, [startTime, mode, categoryCode, endTouched]);

  // zápas vonku nemá domáce ihrisko
  const usePitch = mode !== 'tournament' && !!pitchId && (mode === 'training' || isHome);

  function toggleDay(d: number) {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function togglePicked(name: string) {
    setPicked((prev) => (prev.some((x) => x.toLowerCase() === name.toLowerCase()) ? prev.filter((x) => x.toLowerCase() !== name.toLowerCase()) : [...prev, name]));
  }

  function addNewClub() {
    const name = newClub.trim();
    if (!name) return;
    setPicked((prev) => (prev.some((x) => x.toLowerCase() === name.toLowerCase()) ? prev : [...prev, name]));
    setNewClub('');
  }

  const shownClubs = useMemo(() => {
    const q = clubQuery.trim().toLowerCase();
    return clubs.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 30);
  }, [clubs, clubQuery]);

  function validate(): string | null {
    if (mode === 'tournament' && !title.trim()) return 'Zadajte názov turnaja';
    if (mode === 'tournament' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Dátum zadajte ako RRRR-MM-DD';
    if (!isHhmm(startTime)) return 'Začiatok zadajte ako HH:MM';
    if (endTime && !isHhmm(endTime)) return 'Koniec zadajte ako HH:MM';
    if (usePitch && !endTime) return 'Pri vybranom ihrisku zadajte koniec';
    if (endTime && toMin(normHhmm(endTime)) <= toMin(normHhmm(startTime))) return 'Koniec musí byť po začiatku';
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      Alert.alert('Skontrolujte údaje', problem);
      return;
    }
    setClash('');
    const st = normHhmm(startTime);
    const en = endTime ? normHhmm(endTime) : '';
    const place = usePitch
      ? { pitchId }
      : { location: location || undefined, surface: surface || undefined };
    setBusy(true);
    try {
      if (mode === 'training' && recurring) {
        await api('/events/recurring', {
          method: 'POST',
          body: JSON.stringify({ title, teamId, weekdays, startTime: st, endTime: en || undefined, from, until, ...place }),
        });
      } else if (mode === 'tournament') {
        const created = await api<{ id: string }>('/events', {
          method: 'POST',
          body: JSON.stringify({
            type: 'TOURNAMENT',
            title: title.trim(),
            teamId,
            startAt: `${date}T${st}:00.000Z`,
            endAt: en ? `${date}T${en}:00.000Z` : undefined,
            location: location || undefined,
            address: address || undefined,
            participants: picked,
          }),
        });
        router.replace(`/tournament/${created.id}`);
        return;
      } else if (mode === 'training') {
        await api('/events', {
          method: 'POST',
          body: JSON.stringify({ type: 'TRAINING', title, teamId, startAt: `${date}T${st}:00.000Z`, endAt: en ? `${date}T${en}:00.000Z` : undefined, ...place }),
        });
      } else {
        const team = teams.find((t) => t.id === teamId);
        await api('/events', {
          method: 'POST',
          body: JSON.stringify({
            type: 'MATCH',
            title: isHome ? `${team?.name} vs ${opponent}` : `${opponent} vs ${team?.name}`,
            teamId,
            startAt: `${date}T${st}:00.000Z`,
            endAt: en ? `${date}T${en}:00.000Z` : undefined,
            ...(isHome ? place : { location: location || undefined, surface: surface || undefined }),
            opponent,
            isHome,
            friendly: friendly || undefined,
            jerseyColor: jerseyColor || undefined,
          }),
        });
      }
      Alert.alert('Hotovo', 'Udalosť bola vytvorená.');
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Uloženie zlyhalo';
      if (/obsaden/i.test(msg)) {
        setClash(msg);
        Alert.alert('Ihrisko je obsadené', `${msg}\n\nZvoľte iný čas alebo iné ihrisko.`);
      } else {
        Alert.alert('Chyba', msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const inputProps = {
    placeholderTextColor: ui.placeholder,
    keyboardAppearance: 'dark' as const,
  };
  const chip = (active: boolean) => [styles.chip, active && styles.chipActive];
  const chipTxt = (active: boolean) => [styles.chipText, active && styles.chipTextActive];

  return (
    <KeyboardScreen>
      <View style={styles.row}>
        <Pressable style={chip(mode === 'training')} onPress={() => setMode('training')}>
          <Text style={chipTxt(mode === 'training')}>Tréning</Text>
        </Pressable>
        <Pressable style={chip(mode === 'match')} onPress={() => setMode('match')}>
          <Text style={chipTxt(mode === 'match')}>Zápas</Text>
        </Pressable>
        <Pressable
          style={chip(mode === 'tournament')}
          onPress={() => {
            setMode('tournament');
            if (title === 'Tréning') setTitle('');
          }}
        >
          <Text style={chipTxt(mode === 'tournament')}>Turnaj</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Družstvo</Text>
      <View style={styles.wrapRow}>
        {myTeams.map((t) => (
          <Pressable key={t.id} style={chip(teamId === t.id)} onPress={() => setTeamId(t.id)}>
            <Text style={chipTxt(teamId === t.id)}>{t.name}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'training' ? (
        <>
          <View style={[styles.row, { marginTop: 12 }]}>
            <Pressable style={chip(recurring)} onPress={() => setRecurring(true)}>
              <Text style={chipTxt(recurring)}>Opakovaný</Text>
            </Pressable>
            <Pressable style={chip(!recurring)} onPress={() => setRecurring(false)}>
              <Text style={chipTxt(!recurring)}>Jednorazový</Text>
            </Pressable>
          </View>
          <Text style={styles.label}>Názov</Text>
          <TextInput {...inputProps} style={styles.input} value={title} onChangeText={setTitle} />
          {recurring ? (
            <>
              <Text style={styles.label}>Dni v týždni</Text>
              <View style={styles.wrapRow}>
                {WEEKDAY_SHORT_SK.map((lbl, i) => (
                  <Pressable key={i} style={chip(weekdays.includes(i))} onPress={() => toggleDay(i)}>
                    <Text style={chipTxt(weekdays.includes(i))}>{lbl}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>Od (RRRR-MM-DD)</Text>
              <TextInput {...inputProps} style={styles.input} value={from} onChangeText={setFrom} placeholder="2026-09-01" />
              <Text style={styles.label}>Do (RRRR-MM-DD)</Text>
              <TextInput {...inputProps} style={styles.input} value={until} onChangeText={setUntil} placeholder="2026-12-20" />
            </>
          ) : (
            <>
              <Text style={styles.label}>Dátum (RRRR-MM-DD)</Text>
              <TextInput {...inputProps} style={styles.input} value={date} onChangeText={setDate} placeholder="2026-09-05" />
            </>
          )}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Začiatok</Text>
              <TextInput {...inputProps} style={styles.input} value={startTime} onChangeText={setStartTime} placeholder="16:00" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Koniec</Text>
              <TextInput {...inputProps} style={styles.input} value={endTime} onChangeText={(v) => { setEndTouched(true); setEndTime(v); }} placeholder="17:00" />
            </View>
          </View>
        </>
      ) : mode === 'tournament' ? (
        <>
          <Text style={styles.label}>Názov turnaja</Text>
          <TextInput {...inputProps} style={styles.input} value={title} onChangeText={setTitle} placeholder="Jesenný turnaj" />
          <Text style={styles.label}>Zúčastnené mužstvá ({picked.length})</Text>
          {picked.length > 0 && (
            <View style={styles.wrapRow}>
              {picked.map((n) => (
                <Pressable key={n} style={chip(true)} onPress={() => togglePicked(n)}>
                  <Text style={chipTxt(true)}>{n} ✕</Text>
                </Pressable>
              ))}
            </View>
          )}
          <TextInput {...inputProps} style={[styles.input, { marginTop: 8 }]} value={clubQuery} onChangeText={setClubQuery} placeholder="Hľadať mužstvo…" />
          <View style={styles.wrapRow}>
            {shownClubs.map((c) => {
              const on = picked.some((x) => x.toLowerCase() === c.name.toLowerCase());
              return (
                <Pressable key={c.id} style={chip(on)} onPress={() => togglePicked(c.name)}>
                  <Text style={chipTxt(on)}>{on ? '✓ ' : ''}{c.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.label}>Pridať nové mužstvo</Text>
          <View style={styles.row}>
            <TextInput {...inputProps} style={[styles.input, { flex: 1 }]} value={newClub} onChangeText={setNewClub} onSubmitEditing={addNewClub} placeholder="Názov mužstva" />
            <Pressable style={[styles.chip, { justifyContent: 'center' }]} onPress={addNewClub}>
              <Text style={styles.chipText}>Pridať</Text>
            </Pressable>
          </View>
          <Text style={styles.label}>Dátum (RRRR-MM-DD)</Text>
          <TextInput {...inputProps} style={styles.input} value={date} onChangeText={setDate} placeholder="2026-09-12" />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Začiatok</Text>
              <TextInput {...inputProps} style={styles.input} value={startTime} onChangeText={setStartTime} placeholder="09:00" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Koniec</Text>
              <TextInput {...inputProps} style={styles.input} value={endTime} onChangeText={(v) => { setEndTouched(true); setEndTime(v); }} placeholder="15:00" />
            </View>
          </View>
          <Text style={styles.label}>Miesto</Text>
          <TextInput {...inputProps} style={styles.input} value={location} onChangeText={setLocation} placeholder="Ihrisko KNV" />
          <Text style={styles.label}>Adresa</Text>
          <TextInput {...inputProps} style={styles.input} value={address} onChangeText={setAddress} placeholder="Ulica 1, Komárno" />
        </>
      ) : (
        <>
          <View style={styles.row}>
            <Pressable style={chip(isHome)} onPress={() => setIsHome(true)}>
              <Text style={chipTxt(isHome)}>Doma</Text>
            </Pressable>
            <Pressable style={chip(!isHome)} onPress={() => setIsHome(false)}>
              <Text style={chipTxt(!isHome)}>Vonku</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            <Pressable style={chip(friendly)} onPress={() => setFriendly(!friendly)}>
              <Text style={chipTxt(friendly)}>Priateľský zápas</Text>
            </Pressable>
          </View>
          <Text style={styles.label}>Súper</Text>
          <TextInput {...inputProps} style={styles.input} value={opponent} onChangeText={setOpponent} />
          <Text style={styles.label}>Dres</Text>
          <View style={styles.row}>
            <Pressable
              style={chip(jerseyColor === 'DARK')}
              onPress={() => setJerseyColor(jerseyColor === 'DARK' ? '' : 'DARK')}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <JerseySwatch color="DARK" />
                <Text style={chipTxt(jerseyColor === 'DARK')}>Tmavý</Text>
              </View>
            </Pressable>
            <Pressable
              style={chip(jerseyColor === 'LIGHT')}
              onPress={() => setJerseyColor(jerseyColor === 'LIGHT' ? '' : 'LIGHT')}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <JerseySwatch color="LIGHT" />
                <Text style={chipTxt(jerseyColor === 'LIGHT')}>Svetlý</Text>
              </View>
            </Pressable>
          </View>
          <Text style={styles.label}>Dátum (RRRR-MM-DD)</Text>
          <TextInput {...inputProps} style={styles.input} value={date} onChangeText={setDate} placeholder="2026-09-12" />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Začiatok</Text>
              <TextInput {...inputProps} style={styles.input} value={startTime} onChangeText={setStartTime} placeholder="10:00" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Koniec{usePitch ? ' *' : ''}</Text>
              <TextInput {...inputProps} style={styles.input} value={endTime} onChangeText={(v) => { setEndTouched(true); setEndTime(v); }} placeholder="11:30" />
            </View>
          </View>
        </>
      )}

      {mode === 'tournament' || (mode === 'match' && !isHome) ? null : (
        <>
          <Text style={styles.label}>Ihrisko</Text>
          <View style={styles.wrapRow}>
            {pitches.map((p) => (
              <Pressable key={p.id} style={chip(pitchId === p.id)} onPress={() => setPitchId(p.id)}>
                <Text style={chipTxt(pitchId === p.id)}>
                  {p.name} · {p.surface}
                </Text>
              </Pressable>
            ))}
            <Pressable style={chip(!pitchId)} onPress={() => setPitchId('')}>
              <Text style={chipTxt(!pitchId)}>Iné</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => router.push('/pitches')}>
            <Text style={styles.link}>Pozrieť obsadenosť ihrísk ›</Text>
          </Pressable>
        </>
      )}
      {!!clash && <Text style={styles.clash}>{clash}</Text>}
      {!usePitch && mode !== 'tournament' && (
        <>
          <Text style={styles.label}>Miesto</Text>
          <TextInput {...inputProps} style={styles.input} value={location} onChangeText={setLocation} placeholder="Ihrisko KNV" />
          <Text style={styles.label}>Povrch</Text>
          <View style={styles.wrapRow}>
            <Pressable style={chip(!surface)} onPress={() => setSurface('')}>
              <Text style={chipTxt(!surface)}>—</Text>
            </Pressable>
            {SURFACE_CODES.map((c) => (
              <Pressable key={c} style={chip(surface === c)} onPress={() => setSurface(c)}>
                <Text style={chipTxt(surface === c)}>{c} · {SURFACE_LABELS[c]}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Pressable style={[styles.submit, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy || !teamId}>
        <Text style={styles.submitText}>{busy ? 'Ukladám…' : 'Vytvoriť'}</Text>
      </Pressable>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  label: { fontSize: 13, fontWeight: '600', color: ui.muted, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: ui.panel,
    color: ui.ink,
    borderWidth: 1,
    borderColor: ui.line,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  chip: { borderWidth: 1, borderColor: ui.line, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: ui.panel },
  chipActive: { backgroundColor: ui.blue, borderColor: ui.blue },
  chipText: { color: ui.ink, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: ui.onAccent },
  link: { color: ui.blueHi, fontSize: 13, marginTop: 8 },
  clash: { color: ui.red, fontSize: 13, marginTop: 10, fontWeight: '600' },
  submit: { backgroundColor: ui.blue, borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 24 },
  submitText: { color: ui.onAccent, fontWeight: '700', fontSize: 16 },
});
