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

export type Jersey = 'DARK' | 'LIGHT' | null;

/** Dva štvorčeky s popiskom: náš dres a dres súpera (zobrazí iba zadané). */
export function JerseyPair({ own, opponent, size = 13 }: { own?: Jersey; opponent?: Jersey; size?: number }) {
  if (!own && !opponent) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {own ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text style={{ color: ui.muted, fontSize: 12 }}>Náš dres</Text>
          <JerseySwatch color={own} size={size} />
        </View>
      ) : null}
      {opponent ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text style={{ color: ui.muted, fontSize: 12 }}>Dres súpera</Text>
          <JerseySwatch color={opponent} size={size} />
        </View>
      ) : null}
    </View>
  );
}

/** Výber Tmavý / Svetlý / nezadané (opätovné ťuknutie zruší výber). */
export function JerseyPicker({ label, value, onChange }: { label: string; value: Jersey; onChange: (v: Jersey) => void }) {
  return (
    <View>
      <Text style={{ fontSize: 13, fontWeight: '600', color: ui.muted, marginTop: 12, marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['DARK', 'LIGHT'] as const).map((c) => {
          const on = value === c;
          return (
            <Pressable
              key={c}
              onPress={() => onChange(on ? null : c)}
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
              <Text style={{ color: on ? ui.onAccent : ui.ink, fontWeight: '600', fontSize: 13 }}>{c === 'DARK' ? 'Tmavý' : 'Svetlý'}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
