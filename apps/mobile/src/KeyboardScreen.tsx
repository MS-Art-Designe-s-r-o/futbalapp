import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ui } from '@/theme';

/**
 * Obrazovka s formulárom, ktorú klávesnica neprekryje (Android aj iOS):
 * KeyboardAvoidingView + ScrollView, ťuknutie mimo poľa nezatvára klávesnicu pri ťuknutí na tlačidlo.
 * Používaj namiesto holého <ScrollView> na každej obrazovke s TextInput.
 */
export function KeyboardScreen({
  children,
  style,
  contentContainerStyle,
  ...rest
}: { children: ReactNode; style?: StyleProp<ViewStyle>; contentContainerStyle?: StyleProp<ViewStyle> } & Omit<
  ScrollViewProps,
  'style' | 'contentContainerStyle'
>) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: ui.bg }}
      // „padding“ aj na Androide: s edge-to-edge (SDK 54) okno pri klávesnici nemení veľkosť, „height“ nepomáha
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      <ScrollView
        style={style}
        contentContainerStyle={[{ padding: 16, paddingBottom: insets.bottom + 120 }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
        {...rest}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
