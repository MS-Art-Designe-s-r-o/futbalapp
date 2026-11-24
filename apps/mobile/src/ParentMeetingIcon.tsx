import { View } from 'react-native';

/**
 * Ikona rodičovského združenia (dvaja rodičia a dieťa uprostred) — rovnaký návrh ako na webe.
 * Nakreslená z obyčajných View (bez knižnice na SVG), preto nevyžaduje nový natívny build.
 */
const W = 32;
const H = 20;
const INK = '#16223c';

export function ParentMeetingIcon({ height = 14 }: { height?: number }) {
  const k = height / H;
  const box = (x: number, y: number, w: number, h: number, extra: object) => ({
    position: 'absolute' as const,
    left: x * k,
    top: y * k,
    width: w * k,
    height: h * k,
    backgroundColor: '#ffffff',
    ...extra,
  });
  const bw = Math.max(1, k);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Rodičovské združenie"
      style={{ width: W * k, height: H * k }}
    >
      {/* rodič vľavo */}
      <View style={box(5, 3, 6, 6, { borderRadius: 3 * k })} />
      <View style={box(2, 10, 12, 8, { borderTopLeftRadius: 6 * k, borderTopRightRadius: 6 * k })} />
      {/* rodič vpravo */}
      <View style={box(21, 3, 6, 6, { borderRadius: 3 * k })} />
      <View style={box(18, 10, 12, 8, { borderTopLeftRadius: 6 * k, borderTopRightRadius: 6 * k })} />
      {/* dieťa uprostred */}
      <View style={box(13.1, 6.1, 5.8, 5.8, { borderRadius: 3 * k, borderWidth: bw, borderColor: INK })} />
      <View
        style={box(11, 12.7, 10, 6.3, {
          borderTopLeftRadius: 5 * k,
          borderTopRightRadius: 5 * k,
          borderWidth: bw,
          borderBottomWidth: 0,
          borderColor: INK,
        })}
      />
    </View>
  );
}
