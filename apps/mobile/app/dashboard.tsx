import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, FlatList, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { eventTypeColor, formatEventDateSk, formatEventDateTimeSk, formatEventTimeSk } from '@fkknv/shared';
import { api, setToken } from '@/api';
import { flush } from '@/offline';
import { registerForPushNotifications } from '@/notifications';
import { canManage, canManageTeam, fetchMe, isParent, type Me } from '@/auth';
import { ui } from '@/theme';
import { JerseySwatch } from '@/JerseySwatch';
import { checkForUpdateNow, runningBundleLabel } from '@/updates';

interface EventItem {
  id: string;
  type: string;
  title: string;
  startAt: string;
  location: string | null;
  address?: string | null;
  parentEventId?: string | null;
  tournamentOrder?: number | null;
  parent?: { id: string; title: string } | null;
  team: { id: string; name: string } | null;
  audienceTeams?: Array<{ id: string; name: string }>;
  match: {
    id: string;
    opponent: string;
    isHome: boolean;
    opponentLogo: string | null;
    isFriendly?: boolean;
    meetAt: string | null;
    jerseyColor: 'DARK' | 'LIGHT' | null;
  } | null;
}

// logo nášho klubu (FK Košická Nová Ves) z futbalnetu
const OUR_LOGO = 'https://api.sportnet.online/data/ppo/fk-kosicka-nova-ves.futbalnet.sk/logo';

type Row = { kind: 'header'; label: string; key: string } | { kind: 'event'; e: EventItem; key: string };
type ViewMode = 'upcoming' | 'month';

interface RegCard {
  id: string;
  firstName: string;
  lastName: string;
  registrationValidUntil: string | null;
  team: string | null;
  daysLeft: number | null;
  expired: boolean;
}

const typeLabels: Record<string, string> = {
  TRAINING: 'Tréning',
  MATCH: 'Zápas',
  TOURNAMENT: 'Turnaj',
  CLUB_EVENT: 'Podujatie',
  PARENT_MEETING: 'Rodičovské združenie',
};

const MONTHS_SK = [
  'Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún',
  'Júl', 'August', 'September', 'Október', 'November', 'December',
];
const WEEKDAYS_SK = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [cards, setCards] = useState<RegCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [updChecking, setUpdChecking] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [nominated, setNominated] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewMode>('upcoming');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const load = useCallback(async () => {
    await flush(); // dopošli offline zápisy z ihriska
    try {
      let url: string;
      if (view === 'month') {
        const y = month.getFullYear();
        const m = month.getMonth();
        const lastDay = new Date(y, m + 1, 0).getDate();
        const from = `${y}-${pad(m + 1)}-01T00:00:00.000Z`;
        const to = `${y}-${pad(m + 1)}-${pad(lastDay)}T23:59:59.999Z`;
        url = `/events?mine=true&from=${from}&to=${to}`;
      } else {
        // od začiatku dnešného dňa — aby sa zobrazili aj udalosti, ktoré dnes už prebehli
        const now = new Date();
        const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00:00.000Z`;
        url = `/events?mine=true&from=${from}`;
      }
      const list = await api<EventItem[]>(url);
      setEvents(view === 'month' ? list : list.slice(0, 20));
      api<RegCard[]>('/members/registration-cards').then(setCards).catch(() => {});
      api<Array<{ matchId: string }>>('/matches/my/nominated')
        .then((rows) => setNominated(new Set(rows.map((r) => r.matchId))))
        .catch(() => {});
    } catch {
      // token expiroval → späť na login
      await setToken(null);
      router.replace('/');
    }
  }, [router, view, month]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void registerForPushNotifications();
    fetchMe().then(setMe).catch(() => {});
  }, []);

  // detail tréningu (dochádzku) otvorí len vedenie a tréner daného družstva
  function canOpen(item: EventItem): boolean {
    if (item.match) return true;
    if (item.type === 'TOURNAMENT') return true;
    if (item.type === 'TRAINING') return canManageTeam(me, item.team?.id);
    return false;
  }
  function openEvent(item: EventItem) {
    if (item.match) router.push(`/match/${item.match.id}`);
    else if (item.type === 'TOURNAMENT') router.push(`/tournament/${item.id}`);
    else if (item.type === 'TRAINING' && canManageTeam(me, item.team?.id)) router.push(`/event/${item.id}/attendance`);
  }

  // zvlášť zápasy (prvé) a tréningy
  const matches = events.filter((e) => e.match);
  const trainings = events.filter((e) => e.type === 'TRAINING');
  const others = events.filter((e) => !e.match && e.type !== 'TRAINING');
  const rows: Row[] = [];
  if (matches.length) {
    rows.push({ kind: 'header', label: 'Najbližšie zápasy', key: 'h-m' });
    matches.forEach((e) => rows.push({ kind: 'event', e, key: e.id }));
  }
  if (trainings.length) {
    rows.push({ kind: 'header', label: 'Najbližšie tréningy', key: 'h-t' });
    trainings.forEach((e) => rows.push({ kind: 'event', e, key: e.id }));
  }
  if (others.length) {
    rows.push({ kind: 'header', label: 'Ostatné', key: 'h-o' });
    others.forEach((e) => rows.push({ kind: 'event', e, key: e.id }));
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function renderEventCard(item: EventItem) {
    const openable = canOpen(item);
    const isNominated = !!item.match && nominated.has(item.match.id);
    const audience =
      item.type === 'PARENT_MEETING'
        ? item.audienceTeams && item.audienceTeams.length > 0
          ? item.audienceTeams.map((t) => t.name).join(', ')
          : 'celý klub'
        : null;
    return (
      <Pressable style={styles.card} onPress={() => openEvent(item)} disabled={!openable}>
        <View style={styles.badgeRow}>
          <Text style={styles.badge}>
            {typeLabels[item.type] ?? item.type}
            {item.team ? ` · ${item.team.name}` : ''}
          </Text>
          {item.match?.isFriendly && <Text style={styles.nomBadge}>Priateľský</Text>}
          {isNominated && <Text style={styles.nomBadge}>Nominovaný</Text>}
        </View>
        <Text style={styles.cardMeta}>
          {formatEventDateTimeSk(item.startAt)}
          {item.location ? ' · ' : ''}
          {item.location ? (
            item.address ? (
              <Text style={{ textDecorationLine: 'underline' }} onPress={() => openMap(item.address!)}>
                {item.location} 📍
              </Text>
            ) : (
              item.location
            )
          ) : null}
        </Text>
        {item.parent && item.tournamentOrder ? (
          <Text style={styles.cardMeta}>
            Turnaj: {item.parent.title} · {item.tournamentOrder}. zápas
          </Text>
        ) : null}
        {item.match ? <MatchTeams item={item} /> : <Text style={styles.cardTitle}>{item.title}</Text>}
        {item.match && (
          <View style={styles.meetRow}>
            {item.match.jerseyColor && <JerseySwatch color={item.match.jerseyColor} size={13} />}
            <Text style={styles.meetLine}>
              Zraz: {formatEventTimeSk(item.match.meetAt ?? new Date(new Date(item.startAt).getTime() - 3_600_000))}
            </Text>
          </View>
        )}
        {audience && <Text style={styles.audience}>Pre: {audience}</Text>}
        {openable && (
          <Text style={styles.cardAction}>
            {item.match ? 'Otvoriť zápas →' : item.type === 'TOURNAMENT' ? 'Otvoriť turnaj →' : 'Dochádzka →'}
          </Text>
        )}
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.topRow}>
        <Pressable style={[styles.topBtn, styles.topBtnDark]} onPress={() => router.push('/chat')}>
          <Text style={styles.topBtnText}>💬 Kanály</Text>
        </Pressable>
        <Pressable style={[styles.topBtn, styles.topBtnDark]} onPress={() => router.push('/statistics')}>
          <Text style={styles.topBtnText}>📊 Štatistiky</Text>
        </Pressable>
        <Pressable style={[styles.topBtn, styles.topBtnDark]} onPress={() => router.push('/matches/played')}>
          <Text style={styles.topBtnText}>🎞 Odohrané</Text>
        </Pressable>
        <Pressable style={[styles.topBtn, styles.topBtnDark]} onPress={() => router.push('/pitches')}>
          <Text style={styles.topBtnText}>🏟 Ihriská</Text>
        </Pressable>
        {canManage(me) && (
          <>
            <Pressable style={[styles.topBtn, { backgroundColor: ui.blue }]} onPress={() => router.push('/event/new')}>
              <Text style={styles.topBtnText}>＋ Udalosť</Text>
            </Pressable>
            <Pressable style={[styles.topBtn, styles.topBtnDark]} onPress={() => router.push('/tasks')}>
              <Text style={styles.topBtnText}>✅ Úlohy</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* prepínač zobrazenia */}
      <View style={styles.viewToggle}>
        <Pressable
          style={[styles.toggleBtn, view === 'upcoming' && styles.toggleBtnActive]}
          onPress={() => setView('upcoming')}
        >
          <Text style={[styles.toggleText, view === 'upcoming' && styles.toggleTextActive]}>Najbližšie</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, view === 'month' && styles.toggleBtnActive]}
          onPress={() => setView('month')}
        >
          <Text style={[styles.toggleText, view === 'month' && styles.toggleTextActive]}>Mesiac</Text>
        </Pressable>
      </View>

      {view === 'upcoming' ? (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ui.lime} colors={[ui.blue]} progressBackgroundColor={ui.panel} />}
          ListHeaderComponent={
            cards.length > 0 ? (
              <View style={styles.cardsBlock}>
                <Text style={styles.heading}>
                  {canManage(me)
                    ? 'Platnosť registračných preukazov'
                    : isParent(me)
                      ? 'Vaši hráči'
                      : 'Registračný preukaz'}
                </Text>
                {cards.slice(0, canManage(me) ? 15 : cards.length).map((c) => (
                  <View key={c.id} style={styles.regRow}>
                    <Text style={styles.regName}>
                      {c.lastName} {c.firstName}
                      {c.team ? <Text style={styles.regTeam}> · {c.team}</Text> : null}
                    </Text>
                    <Text
                      style={[
                        styles.regBadge,
                        c.registrationValidUntil == null
                          ? styles.regNone
                          : c.expired
                            ? styles.regExpired
                            : (c.daysLeft ?? 0) <= 30
                              ? styles.regSoon
                              : styles.regOk,
                      ]}
                    >
                      {c.registrationValidUntil == null
                        ? 'preukaz bez dátumu platnosti'
                        : c.expired
                          ? `po platnosti (${formatEventDateSk(c.registrationValidUntil)})`
                          : `do ${formatEventDateSk(c.registrationValidUntil)}`}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null
          }
          ListEmptyComponent={<Text style={styles.empty}>Žiadne udalosti pre dnešok a ďalej.</Text>}
          renderItem={({ item: row }) => {
            if (row.kind === 'header') return <Text style={styles.heading}>{row.label}</Text>;
            return renderEventCard(row.e);
          }}
        />
      ) : (
        <MonthPane
          month={month}
          events={events}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          renderEventCard={renderEventCard}
        />
      )}

      <Pressable
        style={styles.logout}
        onPress={async () => {
          await setToken(null);
          router.replace('/');
        }}
      >
        <Text style={styles.logoutText}>Odhlásiť sa</Text>
      </Pressable>

      <Pressable
        style={styles.updateRow}
        disabled={updChecking}
        onPress={async () => {
          setUpdChecking(true);
          const res = await checkForUpdateNow();
          setUpdChecking(false);
          if (res === 'current') Alert.alert('Aktualizácia', 'Máte najnovšiu verziu.');
          else if (res === 'unavailable') Alert.alert('Aktualizácia', 'Kontrola je dostupná len v nainštalovanej aplikácii.');
          else if (res === 'error') Alert.alert('Aktualizácia', 'Kontrolu sa nepodarilo dokončiť (skontrolujte pripojenie).');
          // 'updated' → appka sa reštartuje do novej verzie
        }}
      >
        <Text style={styles.updateText}>
          {updChecking ? 'Kontrolujem…' : 'Skontrolovať aktualizáciu'} · {runningBundleLabel()}
        </Text>
      </Pressable>
    </View>
  );
}

/** Mesačný prehľad: mriežka dní (bodka = sú udalosti), po ťuknutí na deň sa zobrazia jeho udalosti. */
function MonthPane({
  month,
  events,
  refreshing,
  onRefresh,
  onPrev,
  onNext,
  renderEventCard,
}: {
  month: Date;
  events: EventItem[];
  refreshing: boolean;
  onRefresh: () => void;
  onPrev: () => void;
  onNext: () => void;
  renderEventCard: (e: EventItem) => ReactNode;
}) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const [selected, setSelected] = useState<number | null>(null);

  // po zmene mesiaca zruš výber (a predvyber dnešok, ak je v tomto mesiaci)
  useEffect(() => {
    const now = new Date();
    setSelected(now.getFullYear() === y && now.getMonth() === m ? now.getDate() : null);
  }, [y, m]);

  // udalosti podľa dňa (deň čítame z UTC komponentov — konvencia času udalostí)
  const byDay = new Map<number, EventItem[]>();
  for (const e of events) {
    const d = new Date(e.startAt);
    if (d.getUTCFullYear() === y && d.getUTCMonth() === m) {
      const arr = byDay.get(d.getUTCDate()) ?? [];
      arr.push(e);
      byDay.set(d.getUTCDate(), arr);
    }
  }

  const startWeekday = (new Date(y, m, 1).getDay() + 6) % 7; // Po = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<number | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const now = new Date();
  const isToday = (d: number) => now.getFullYear() === y && now.getMonth() === m && now.getDate() === d;

  const selectedEvents = selected
    ? (byDay.get(selected) ?? []).slice().sort((a, b) => a.startAt.localeCompare(b.startAt))
    : [];

  return (
    <ScrollView
      style={styles.monthScroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ui.lime} colors={[ui.blue]} progressBackgroundColor={ui.panel} />}
    >
      <View style={styles.monthNav}>
        <Pressable style={styles.monthNavBtn} onPress={onPrev} hitSlop={8}>
          <Text style={styles.monthNavText}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>
          {MONTHS_SK[m]} {y}
        </Text>
        <Pressable style={styles.monthNavBtn} onPress={onNext} hitSlop={8}>
          <Text style={styles.monthNavText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekHeaderRow}>
        {WEEKDAYS_SK.map((w) => (
          <Text key={w} style={styles.weekHeaderCell}>
            {w}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((d, di) => {
            const dayEvents = d ? byDay.get(d) ?? [] : [];
            return (
              <Pressable
                key={di}
                disabled={!d}
                onPress={() => d && setSelected(d)}
                style={[
                  styles.dayCell,
                  d != null && isToday(d) && styles.dayCellToday,
                  d != null && selected === d && styles.dayCellSelected,
                ]}
              >
                {d ? (
                  <>
                    <Text style={[styles.dayNum, selected === d && styles.dayNumSelected]}>{d}</Text>
                    <View style={styles.dotRow}>
                      {dayEvents.slice(0, 3).map((e) => (
                        <View key={e.id} style={[styles.dot, { backgroundColor: eventTypeColor(e.type).bg }]} />
                      ))}
                    </View>
                  </>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={styles.selectedBlock}>
        {selected ? (
          selectedEvents.length ? (
            <>
              <Text style={styles.selectedHeading}>
                {selected}. {MONTHS_SK[m]}
              </Text>
              {selectedEvents.map((e) => (
                <View key={e.id}>{renderEventCard(e)}</View>
              ))}
            </>
          ) : (
            <Text style={styles.empty}>V tento deň nie sú žiadne udalosti.</Text>
          )
        ) : (
          <Text style={styles.empty}>Ťuknite na deň pre zobrazenie udalostí.</Text>
        )}
      </View>
    </ScrollView>
  );
}

function openMap(address: string) {
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`);
}

/** Zápas ako mini-tabuľka: domáci hore, hostia dole (s logami). */
function MatchTeams({ item }: { item: EventItem }) {
  const m = item.match!;
  const our = { name: item.team?.name ?? 'FK KNV', logo: OUR_LOGO };
  const opp = { name: m.opponent, logo: m.opponentLogo };
  const home = m.isHome ? our : opp;
  const away = m.isHome ? opp : our;
  return (
    <View style={styles.teams}>
      <View style={styles.teamRow}>
        {home.logo ? <Image source={{ uri: home.logo }} style={styles.teamLogo} /> : <View style={styles.teamLogo} />}
        <Text style={styles.teamName}>{home.name}</Text>
      </View>
      <View style={styles.teamRow}>
        {away.logo ? <Image source={{ uri: away.logo }} style={styles.teamLogo} /> : <View style={styles.teamLogo} />}
        <Text style={styles.teamName}>{away.name}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg, padding: 16 },
  teams: { marginTop: 8, gap: 6 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamLogo: { width: 26, height: 26, resizeMode: 'contain' },
  teamName: { fontSize: 15, fontWeight: '600', color: ui.ink, flexShrink: 1 },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  topBtn: { flexGrow: 1, flexBasis: '30%', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  topBtnDark: { backgroundColor: ui.panel2, borderWidth: 1, borderColor: ui.line },
  topBtnText: { color: ui.ink, fontWeight: '700', fontSize: 13 },
  viewToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ui.line,
    overflow: 'hidden',
    marginBottom: 16,
  },
  toggleBtn: { paddingVertical: 8, paddingHorizontal: 18, backgroundColor: ui.panel },
  toggleBtnActive: { backgroundColor: ui.blue },
  toggleText: { color: ui.ink, fontWeight: '600', fontSize: 14 },
  toggleTextActive: { color: ui.onAccent },
  heading: { fontSize: 18, fontWeight: '800', color: ui.ink, marginBottom: 12 },
  empty: { color: ui.muted, textAlign: 'center', marginTop: 24 },
  card: {
    backgroundColor: ui.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ui.line,
    padding: 14,
    marginBottom: 10,
  },
  badge: { color: ui.lime, fontSize: 12, fontWeight: '600', marginBottom: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nomBadge: {
    color: ui.ok,
    backgroundColor: '#12301f',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 4,
  },
  audience: { color: ui.ink, fontSize: 12, marginTop: 4 },
  meetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  meetLine: { color: ui.ink, fontSize: 13 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: ui.ink },
  cardMeta: { color: ui.muted, fontSize: 13, marginTop: 4 },
  cardAction: { color: ui.lime, fontSize: 13, fontWeight: '600', marginTop: 6 },
  cardsBlock: { marginBottom: 8 },
  regRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: ui.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ui.line,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  regName: { color: ui.ink, fontWeight: '600', fontSize: 14, flexShrink: 1 },
  regTeam: { color: ui.muted, fontWeight: '400', fontSize: 12 },
  regBadge: { fontSize: 12, fontWeight: '600', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8, overflow: 'hidden' },
  regExpired: { backgroundColor: '#3a1019', color: '#ff7a93' },
  regSoon: { backgroundColor: '#3a2e0f', color: ui.warn },
  regOk: { backgroundColor: ui.panel2, color: ui.muted },
  regNone: { backgroundColor: '#1b2748', color: '#a5b4fc' },
  logout: { padding: 14, alignItems: 'center' },
  logoutText: { color: ui.blueHi, fontWeight: '600' },
  updateRow: { paddingBottom: 8, alignItems: 'center' },
  updateText: { color: ui.muted, fontSize: 11 },
  // mesačný prehľad
  monthScroll: { flex: 1 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  monthNavBtn: {
    width: 40,
    height: 36,
    borderRadius: 8,
    backgroundColor: ui.panel,
    borderWidth: 1,
    borderColor: ui.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavText: { fontSize: 22, color: ui.ink, fontWeight: '700', lineHeight: 24 },
  monthLabel: { fontSize: 17, fontWeight: '700', color: ui.ink },
  weekHeaderRow: { flexDirection: 'row', marginBottom: 4 },
  weekHeaderCell: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600', color: ui.muted },
  weekRow: { flexDirection: 'row' },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    margin: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ui.line,
    backgroundColor: ui.panel,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
  },
  dayCellToday: { borderColor: ui.blue },
  dayCellSelected: { backgroundColor: ui.blue, borderColor: ui.blue },
  dayNum: { fontSize: 14, fontWeight: '600', color: ui.ink },
  dayNumSelected: { color: ui.onAccent },
  dotRow: { flexDirection: 'row', gap: 2, marginTop: 3, height: 6 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  selectedBlock: { marginTop: 16 },
  selectedHeading: { fontSize: 16, fontWeight: '700', color: ui.ink, marginBottom: 10 },
});
