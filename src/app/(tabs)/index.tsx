import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { AccessibilityInfo, Animated, FlatList, Keyboard, LayoutAnimation, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ChatMenu } from '@/components/chat-menu';
import { Menu } from '@/components/drawer';
import { CopyButton, Markdown } from '@/components/markdown';
import { ModelPicker, useChoice } from '@/components/model-picker';
import { AppText, IconButton, Screen } from '@/components/ui';
import { formatDay, formatTime, type Key } from '@/i18n';
import { messageTextMax } from '@/lib/api';
import { direct, type DirectError, type DirectMessage } from '@/lib/direct';
import { formatUsd } from '@/lib/money';
import { useSettings } from '@/state/settings';
import { mark, motion, radius, shadow, spacing, touchTarget, type } from '@/theme';

const awayOffset = 240;

const errorKeys: Record<DirectError, Key> = {
  network: 'chat.errorNetwork',
  unauthorized: 'chat.errorUnauthorized',
  rateLimited: 'chat.errorRateLimited',
  budget: 'chat.errorBudget',
  tooLong: 'chat.errorTooLong',
  failed: 'chat.errorFailed',
};

function Thinking() {
  const { t, colors } = useSettings();
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced || !live) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.3, duration: motion.pulse, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: motion.pulse, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      live = false;
      loop?.stop();
    };
  }, [pulse]);
  return (
    <View testID="thinking" accessible accessibilityLiveRegion="polite" accessibilityLabel={t('chat.writing')} style={styles.thinking}>
      <Animated.View style={[styles.dot, { backgroundColor: colors.primary, opacity: pulse }]} />
    </View>
  );
}

function Day({ at }: { at: string }) {
  const { language } = useSettings();
  return (
    <AppText variant="meta" color="onSurfaceVariant" accessibilityRole="header" style={styles.day}>
      {formatDay(language, at)}
    </AppText>
  );
}

function Meta({ items, label }: { items: string[]; label?: string }) {
  return (
    <AppText variant="meta" color="onSurfaceVariant" accessibilityLabel={label} style={styles.metaText}>
      {items.join('  ·  ')}
    </AppText>
  );
}

function Message({ message, last, day }: { message: DirectMessage; last: boolean; day: boolean }) {
  const { t, colors, language } = useSettings();
  const choice = useChoice();
  const time = formatTime(language, message.createdAt);
  if (message.role === 'user') {
    return (
      <View testID={`direct-${message.id}`} style={styles.mine}>
        {day ? <Day at={message.createdAt} /> : null}
        <View accessible accessibilityLabel={t('chat.you', { text: message.text })} style={[styles.bubble, { backgroundColor: colors.primaryContainer }]}>
          <AppText selectable color="onPrimaryContainer">
            {message.text}
          </AppText>
        </View>
        <View style={styles.meta}>
          <Meta items={[time]} />
          <CopyButton quiet text={message.text} label={t('chat.copy')} />
        </View>
      </View>
    );
  }
  const streaming = message.state === 'streaming';
  const again = last && !streaming && choice.model !== undefined;
  return (
    <View testID={`direct-${message.id}`} style={styles.answer}>
      {day ? <Day at={message.createdAt} /> : null}
      {message.text ? (
        <View accessibilityLabel={streaming ? undefined : t('chat.answer', { text: message.text })}>
          <Markdown text={message.text} />
        </View>
      ) : null}
      {streaming ? <Thinking /> : null}
      {message.state === 'stopped' ? (
        <AppText variant="bodySmall" color="onSurfaceVariant">
          {t('chat.stopped')}
        </AppText>
      ) : null}
      {message.cut ? (
        <AppText variant="bodySmall" color="onSurfaceVariant">
          {t('chat.cut')}
        </AppText>
      ) : null}
      {message.error ? (
        <AppText color="error" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t(errorKeys[message.error])}
        </AppText>
      ) : null}
      {streaming ? null : (
        <View style={styles.meta}>
          {message.text ? <CopyButton quiet testID="copy-answer" text={message.text} label={t('chat.copy')} /> : null}
          {again ? (
            <IconButton
              testID="regenerate"
              icon={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
              label={t('chat.regenerate')}
              color="onSurfaceVariant"
              quiet
              onPress={() => direct.regenerate(choice)}
            />
          ) : null}
          {message.costMicroUsd === undefined ? (
            <Meta items={[time]} />
          ) : (
            <Meta items={[time, formatUsd(language, message.costMicroUsd)]} label={`${time}, ${t('chat.cost', { cost: formatUsd(language, message.costMicroUsd) })}`} />
          )}
        </View>
      )}
    </View>
  );
}

function Thread({ messages }: { messages: DirectMessage[] }) {
  const { t } = useSettings();
  const list = useRef<FlatList<DirectMessage>>(null);
  const [away, setAway] = useState(false);
  if (messages.length === 0) return <Pressable testID="chat-empty" accessible={false} importantForAccessibility="no" onPress={() => Keyboard.dismiss()} style={styles.fill} />;
  const newestFirst = [...messages].reverse();
  return (
    <View style={styles.fill}>
      <FlatList
        ref={list}
        testID="chat-list"
        inverted
        accessibilityLabel={t('chat.messages')}
        data={newestFirst}
        keyExtractor={(message) => message.id}
        renderItem={({ item, index }) => <Message message={item} last={index === 0} day={new Date(newestFirst[index + 1]?.createdAt ?? 0).toDateString() !== new Date(item.createdAt).toDateString()} />}
        onScroll={(event) => setAway(event.nativeEvent.contentOffset.y > awayOffset)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
      />
      {away ? (
        <View style={styles.latest}>
          <IconButton
            testID="latest"
            filled
            icon={{ ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' }}
            label={t('chat.latest')}
            onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function Chat() {
  const { t, colors } = useSettings();
  const chat = useSyncExternalStore(direct.subscribe, direct.get);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [still, setStill] = useState(false);
  const [reader, setReader] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const choice = useChoice();
  const needsModel = choice.model === undefined;
  const chipShown = focused || needsModel || reader;
  const canSend = text.trim() !== '' && !needsModel && !chat.busy;
  const summary = chat.history.find((item) => item.chatId === chat.chatId);
  const title = summary?.title ?? t('chat.newChat');

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
    const motionSub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    void AccessibilityInfo.isScreenReaderEnabled().then(setReader);
    const readerSub = AccessibilityInfo.addEventListener('screenReaderChanged', setReader);
    const keyboardSub = Keyboard.addListener('keyboardDidHide', () => input.current?.blur());
    return () => {
      motionSub.remove();
      readerSub.remove();
      keyboardSub.remove();
    };
  }, []);

  const focus = (on: boolean) => {
    if (!still && !needsModel) LayoutAnimation.configureNext(LayoutAnimation.create(motion.fade, 'easeInEaseOut', 'opacity'));
    setFocused(on);
  };
  const submit = () => {
    if (!canSend) return;
    direct.send(text, choice);
    setText('');
  };
  const startNew = () => {
    direct.clear();
    setText('');
    input.current?.focus();
  };

  return (
    <Screen
      title={title}
      start={<Menu />}
      end={
        chat.messages.length > 0 ? (
          <>
            <IconButton icon={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }} label={t('chat.newChat')} onPress={startNew} />
            {summary ? <ChatMenu chat={summary} /> : null}
          </>
        ) : null
      }
    >
      <Thread messages={chat.messages} />
      <View style={styles.composer}>
        {needsModel ? (
          <AppText variant="bodySmall" color="onSurfaceVariant" accessibilityLiveRegion="polite">
            {t('chat.modelNeeded')}
          </AppText>
        ) : null}
        <View testID="composer" style={[styles.bar, { backgroundColor: colors.surfaceContainer }]}>
          <View style={styles.fill}>
            <TextInput
              ref={input}
              testID="chat-input"
              value={text}
              onChangeText={setText}
              onFocus={() => focus(true)}
              onBlur={() => focus(false)}
              multiline
              maxLength={messageTextMax}
              accessibilityLabel={t('chat.inputLabel')}
              placeholder={t('chat.placeholder')}
              placeholderTextColor={colors.onSurfaceVariant}
              style={[styles.input, type.body, { color: colors.onSurface }]}
            />
            <ModelPicker disabled={false} hidden={!chipShown} />
          </View>
          {chat.busy ? (
            <IconButton testID="stop" icon={{ ios: 'stop.fill', android: 'stop', web: 'stop' }} label={t('chat.stop')} filled compact onPress={direct.stop} />
          ) : (
            <IconButton icon={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }} label={t('chat.send')} filled compact disabled={!canSend} onPress={submit} />
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: spacing.lg, paddingVertical: spacing.md },
  mine: { alignItems: 'flex-end' },
  bubble: { maxWidth: '85%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm + spacing.xs, borderRadius: radius.md },
  answer: { gap: spacing.sm, alignSelf: 'stretch' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: -spacing.xs, marginHorizontal: -spacing.xs },
  metaText: { paddingHorizontal: spacing.xs },
  day: { alignSelf: 'center', paddingVertical: spacing.sm },
  thinking: { height: touchTarget / 2, justifyContent: 'center' },
  dot: { width: mark.thinking, height: mark.thinking, borderRadius: radius.full },
  latest: { position: 'absolute', alignSelf: 'center', bottom: spacing.sm },
  composer: { gap: spacing.sm, paddingBottom: spacing.md },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, padding: spacing.sm, borderRadius: radius.field, boxShadow: shadow.composer },
  input: { minHeight: touchTarget, maxHeight: 160, paddingHorizontal: spacing.sm, paddingVertical: (touchTarget - type.body.lineHeight) / 2, textAlign: 'auto', textAlignVertical: 'top' },
});
