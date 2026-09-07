/**
 * Minimal UI kit. React Native core only — no third-party UI library (ask
 * before adding one). Plain on purpose: this is an index card, not a
 * dashboard. There are no streaks, badges, or progress bars anywhere.
 */
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    bg: dark ? '#111214' : '#f7f6f2',
    card: dark ? '#1b1c20' : '#ffffff',
    text: dark ? '#eceae4' : '#1c1b18',
    muted: dark ? '#9a9890' : '#6b6a64',
    line: dark ? '#2c2d33' : '#e2e0d8',
    accent: dark ? '#d8b36a' : '#8a6a1f',
    danger: '#b3261e',
  };
}

export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: ViewStyle }) {
  const t = useTheme();
  const inner = <View style={[styles.pad, style]}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'left', 'right']}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48 }}>{inner}</ScrollView> : inner}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.h1, { color: t.text }]}>{children}</Text>;
}
export function H2({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.h2, { color: t.text }]}>{children}</Text>;
}
export function P({ children, muted = false, style }: { children: React.ReactNode; muted?: boolean; style?: object }) {
  const t = useTheme();
  return <Text style={[styles.p, { color: muted ? t.muted : t.text }, style]}>{children}</Text>;
}
export function Small({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.small, { color: t.muted }]}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }, style]}>{children}</View>;
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[styles.label, { color: t.text }]}>{label}</Text>
      {hint ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
      <TextInput
        placeholderTextColor={t.muted}
        style={[styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }, props.multiline ? { minHeight: 88, textAlignVertical: 'top' } : null]}
        {...props}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'link';
  disabled?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : 'transparent';
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : kind === 'link' ? t.accent : t.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? t.line : 'transparent', opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        kind === 'link' ? { paddingVertical: 8 } : null,
      ]}
    >
      <Text style={{ color: fg, fontSize: 16, fontWeight: '600', textAlign: 'center' }}>{title}</Text>
    </Pressable>
  );
}

/** Pick one of a few options. Used for verdict, source, channels, kit. */
export function Choice<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  multi = false,
}: {
  label: string;
  hint?: string;
  options: Array<{ value: T; label: string }>;
  value: T | T[] | null;
  onChange: (v: T) => void;
  multi?: boolean;
}) {
  const t = useTheme();
  const selected = (v: T) => (multi ? (value as T[] | null)?.includes(v) : value === v);
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[styles.label, { color: t.text }]}>{label}</Text>
      {hint ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.chip, { borderColor: selected(o.value) ? t.accent : t.line, backgroundColor: selected(o.value) ? t.accent : t.card }]}
          >
            <Text style={{ color: selected(o.value) ? '#fff' : t.text }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** A number on a scale, chosen by tapping. 0–100 shows steps of 10; 0–10 shows each. */
export function Scale({
  label,
  hint,
  min,
  max,
  step = 1,
  value,
  onChange,
  suffix = '',
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step?: number;
  value: number | null;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  const t = useTheme();
  const steps: number[] = [];
  for (let v = min; v <= max; v += step) steps.push(v);
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[styles.label, { color: t.text }]}>
        {label}
        {value != null ? <Text style={{ color: t.accent }}>{`  ${value}${suffix}`}</Text> : null}
      </Text>
      {hint ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {steps.map((v) => (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            style={[styles.scaleBtn, { borderColor: value === v ? t.accent : t.line, backgroundColor: value === v ? t.accent : t.card }]}
          >
            <Text style={{ color: value === v ? '#fff' : t.text, fontVariant: ['tabular-nums'] }}>{v}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.line, marginVertical: 16 }} />;
}

const styles = StyleSheet.create({
  pad: { padding: 20, gap: 4 },
  h1: { fontSize: 28, fontWeight: '700', marginBottom: 8, letterSpacing: -0.3 },
  h2: { fontSize: 19, fontWeight: '600', marginTop: 8, marginBottom: 6 },
  p: { fontSize: 16, lineHeight: 23, marginBottom: 8 },
  small: { fontSize: 13, lineHeight: 18 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  label: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  hint: { fontSize: 13, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  btn: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, marginTop: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  scaleBtn: { minWidth: 40, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});
