import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Pressable, StyleSheet, Text, View, type TextProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSettings } from '@/state/settings';
import { headerHeight, radius, readingWidth, spacing, touchTarget, type, type Colors } from '@/theme';

export function AppText({ variant = 'body', color = 'onSurface', style, ...props }: TextProps & { variant?: keyof typeof type; color?: keyof Colors }) {
  const { colors } = useSettings();
  return <Text {...props} style={[type[variant], { color: colors[color], textAlign: 'auto' }, style]} />;
}

export function Mark({ size }: { size: number }) {
  const { dark } = useSettings();
  return <Image testID="fama-mark" source={dark ? require('../../assets/images/mark-dark.png') : require('../../assets/images/mark-light.png')} importantForAccessibility="no" style={{ width: size, height: size }} />;
}

export type IconName = Extract<SymbolViewProps['name'], object>;

export function Icon({ name, color = 'onSurface', size = 24 }: { name: IconName; color?: keyof Colors; size?: number }) {
  const { colors } = useSettings();
  return <SymbolView name={name} tintColor={colors[color]} size={size} />;
}

type IconButtonProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  filled?: boolean;
  compact?: boolean;
  color?: keyof Colors;
  testID?: string;
  accessibilityHint?: string;
};

export function IconButton({ icon, label, onPress, disabled = false, filled = false, compact = false, color = 'onSurface', testID, accessibilityHint }: IconButtonProps) {
  const { colors } = useSettings();
  const muted = filled && disabled;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={compact ? (touchTarget - compactButton) / 2 : undefined}
      android_ripple={{ color: colors.outlineVariant, borderless: !filled }}
      style={({ pressed }) => [
        styles.iconButton,
        compact && styles.compact,
        { backgroundColor: muted ? colors.surfaceContainerHigh : filled ? colors.primary : 'transparent', opacity: muted ? 1 : disabled ? 0.38 : pressed ? 0.7 : 1 },
      ]}
    >
      <Icon name={icon} color={muted ? 'onSurfaceVariant' : filled ? 'onPrimary' : color} size={compact ? 18 : filled ? 22 : 24} />
    </Pressable>
  );
}

export function Screen({ title, start, end, children }: { title: string; start?: ReactNode; end?: ReactNode; children: ReactNode }) {
  const { colors } = useSettings();
  const { bottom } = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={-bottom} style={[styles.fill, { backgroundColor: colors.surface }]}>
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.fill}>
        <View style={styles.header}>
          <View style={[styles.slot, styles.start]}>{start}</View>
          <AppText variant="title" accessibilityRole="header" numberOfLines={1} style={styles.title}>
            {title}
          </AppText>
          <View style={[styles.slot, styles.end]}>{end}</View>
        </View>
        <View style={styles.body}>{children}</View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'outline';
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'filled', disabled = false, busy = false, accessibilityHint }: ButtonProps) {
  const { colors } = useSettings();
  const off = disabled || busy;
  const filled = variant === 'filled';
  const ink = filled ? colors.onPrimary : colors.onSurface;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      android_ripple={{ color: colors.outlineVariant }}
      style={({ pressed }) => [
        styles.button,
        filled ? { backgroundColor: colors.primary } : { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.outline },
        { opacity: disabled ? 0.38 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={ink} /> : <Text style={[type.label, { color: ink }]}>{label}</Text>}
    </Pressable>
  );
}

export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors } = useSettings();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant }]}>
      {children}
    </View>
  );
}

type StateProps =
  | { kind: 'loading'; title: string }
  | { kind: 'empty'; title: string; hint?: string; mark?: boolean }
  | { kind: 'error'; title: string; retryLabel: string; onRetry: () => void };

export function StateView(props: StateProps) {
  const { colors } = useSettings();
  return (
    <View style={styles.state} accessibilityLiveRegion="polite" accessibilityRole={props.kind === 'error' ? 'alert' : undefined}>
      {props.kind === 'loading' ? <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={props.title} /> : null}
      {props.kind === 'empty' && props.mark ? <Mark size={96} /> : null}
      <AppText variant="body" color={props.kind === 'error' ? 'error' : 'onSurfaceVariant'} style={styles.center}>
        {props.title}
      </AppText>
      {props.kind === 'empty' && props.hint ? (
        <AppText variant="bodySmall" color="onSurfaceVariant" style={styles.center}>
          {props.hint}
        </AppText>
      ) : null}
      {props.kind === 'error' ? <Button label={props.retryLabel} onPress={props.onRetry} variant="outline" /> : null}
    </View>
  );
}

const compactButton = 36;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: headerHeight, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  slot: { width: touchTarget * 2, flexDirection: 'row' },
  start: { justifyContent: 'flex-start' },
  end: { justifyContent: 'flex-end' },
  title: { flex: 1, textAlign: 'center' },
  body: { flex: 1, width: '100%', maxWidth: readingWidth, alignSelf: 'center', paddingHorizontal: spacing.md, gap: spacing.md },
  iconButton: { width: touchTarget, height: touchTarget, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  compact: { width: compactButton, height: compactButton, margin: (touchTarget - compactButton) / 2 },
  button: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  center: { textAlign: 'center' },
});
