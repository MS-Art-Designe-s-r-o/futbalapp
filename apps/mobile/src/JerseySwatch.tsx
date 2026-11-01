import { Pressable, Text, View } from 'react-native';
import { ui } from "./theme";

/**
 * Malý štvorček vo farbe dresu — tmavý (tmavomodrý) alebo svetlý (biely).
 * Bez závislosti na react-native-svg (v projekte nie je).
 */
export function JerseySwatch({ color, size = 14 }: { color: 'DARK' | 'LIGHT'; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 3,
        backgroundColor: color === 'DARK' ? '#16223c' : '#ffffff',
        borderWidth: 1,
        borderColor: color === 'DARK' ? ui.muted : ui.line,
      }}
    />
  );
}

export type Jersey = 'DARK' | 'LIGHT';

/** Zo staršieho jerseyColor odvodí pole (ak API jerseyColors neposlalo). */
export function jerseyList(m?: { jerseyColors?: Jersey[] | null; jerseyColor?: Jersey | null } | null): Jersey[] {
  if (!m) return [];
  if (Array.isArray(m.jerseyColors)) return m.jerseyColors;
  return m.jerseyColor ? [m.jerseyColor] : [];
}

/** Zobrazenie dresov nášho mužstva: jeden alebo oba (prineste oba). */
export function JerseyPair({ colors, size = 13 }: { colors?: Jersey[] | null; size?: number }) {
  const list = colors ?? [];
  if (list.length === 0) return null;
  const both = list.length >= 2;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Text style={{ color: ui.muted, fontSize: 12 }}>Dresy:</Text>
      {(['LIGHT', 'DARK'] as const)
        .filter((c) => list.includes(c))
        .map((c) => (
          <View key={c} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <JerseySwatch color={c} size={size} />
            <Text style={{ color: ui.muted, fontSize: 12 }}>{c === 'LIGHT' ? 'biely' : 'modrý'}</Text>
          </View>
        ))}
      {both ? <Text style={{ color: ui.muted, fontSize: 12 }}>– prineste oba</Text> : null}
    </View>
  );
}

/** Viacvýber dresu: Biely / Modrý, nezávisle zapnúť/vypnúť. */
export function JerseyPicker({ label, value, onChange }: { label: string; value: Jersey[]; onChange: (v: Jersey[]) => void }) {
  const hint =
    value.length === 0
      ? 'Dres zatiaľ neurčený'
      : value.length === 1
        ? `Hráči prinesú: ${value[0] === 'LIGHT' ? 'biely' : 'modrý'} dres`
        : 'Hráči prinesú oba dresy (biely aj modrý)';
  return (
    <View>
      <Text style={{ fontSize: 13, fontWeight: '600', color: ui.muted, marginTop: 12, marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['LIGHT', 'DARK'] as const).map((c) => {
          const on = value.includes(c);
          return (
            <Pressable
              key={c}
              onPress={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                borderWidth: 1,
                borderColor: on ? ui.blue : ui.line,
                backgroundColor: on ? ui.blue : ui.panel,
                borderRadius: 20,
                paddingVertical: 8,
                paddingHorizontal: 14,
              }}
            >
              <JerseySwatch color={c} />
              <Text style={{ color: on ? ui.onAccent : ui.ink, fontWeight: '600', fontSize: 13 }}>{c === 'LIGHT' ? 'Biely' : 'Modrý'}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: ui.muted, fontSize: 12, marginTop: 6 }}>{hint}</Text>
      <Text style={{ color: ui.muted, fontSize: 12 }}>Ak ešte neviete, vyberte oba.</Text>
    </View>
  );
}
