import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSettings } from '@/state/settings';
import { radius, spacing, touchTarget, type, type Colors } from '@/theme';

export function AppText({ variant = 'body', color = 'onSurface', style, ...props }: TextProps & { variant?: keyof typeof type; color?: keyof Colors }) {
  const { colors } = useSettings();
  return <Text {...props} style={[type[variant], { color: colors[color], textAlign: 'auto' }, style]} />;
}

export function Screen({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useSettings();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <AppText variant="title" accessibilityRole="header" style={styles.title}>
        {title}
      </AppText>
      {children}
    </SafeAreaView>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'tonal';
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'filled', disabled = false, busy = false, accessibilityHint }: ButtonProps) {
  const { colors } = useSettings();
  const off = disabled || busy;
  const fill = variant === 'filled' ? colors.primary : colors.surfaceContainerHigh;
  const ink = variant === 'filled' ? colors.onPrimary : colors.onSurface;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      android_ripple={{ color: colors.outlineVariant }}
      style={({ pressed }) => [styles.button, { backgroundColor: fill, opacity: disabled ? 0.38 : pressed ? 0.88 : 1 }]}
    >
      {busy ? <ActivityIndicator color={ink} /> : <Text style={[type.label, { color: ink }]}>{label}</Text>}
    </Pressable>
  );
}

type StateProps =
  | { kind: 'loading'; title: string }
  | { kind: 'empty'; title: string; hint?: string }
  | { kind: 'error'; title: string; retryLabel: string; onRetry: () => void };

export function StateView(props: StateProps) {
  const { colors } = useSettings();
  return (
    <View style={styles.state} accessibilityLiveRegion="polite" accessibilityRole={props.kind === 'error' ? 'alert' : undefined}>
      {props.kind === 'loading' ? <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={props.title} /> : null}
      <AppText variant="body" color={props.kind === 'error' ? 'error' : 'onSurface'} style={styles.center}>
        {props.title}
      </AppText>
      {props.kind === 'empty' && props.hint ? (
        <AppText variant="bodySmall" color="onSurfaceVariant" style={styles.center}>
          {props.hint}
        </AppText>
      ) : null}
      {props.kind === 'error' ? <Button label={props.retryLabel} onPress={props.onRetry} variant="tonal" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: spacing.md, gap: spacing.md },
  title: { paddingTop: spacing.md },
  button: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  center: { textAlign: 'center' },
});
