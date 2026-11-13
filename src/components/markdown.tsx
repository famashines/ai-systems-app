import { lexer, type Token, type Tokens } from 'marked';
import { memo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Clipboard, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppText, IconButton } from '@/components/ui';
import { useSettings } from '@/state/settings';
import { fonts, radius, spacing, tableCell, type } from '@/theme';

export const copiedShowMs = 2_000;

export function safeLink(href: string): string | null {
  return /^https?:\/\//i.test(href) ? href : null;
}

export function CopyButton({ text, label, testID }: { text: string; label: string; testID?: string }) {
  const { t } = useSettings();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    Clipboard.setString(text);
    AccessibilityInfo.announceForAccessibility(t('chat.copied'));
    setCopied(true);
    setTimeout(() => setCopied(false), copiedShowMs);
  };
  return (
    <IconButton
      testID={testID}
      icon={copied ? { ios: 'checkmark', android: 'check', web: 'check' } : { ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' }}
      label={copied ? t('chat.copied') : label}
      color={copied ? 'success' : 'onSurface'}
      onPress={copy}
    />
  );
}

const face = (bold: boolean, italic: boolean) => ({ fontFamily: bold ? (italic ? fonts.serifBoldItalic : fonts.serifBold) : italic ? fonts.serifItalic : fonts.serif });

function Inline({ tokens, bold = false, italic = false }: { tokens: Token[]; bold?: boolean; italic?: boolean }): ReactNode {
  const { colors } = useSettings();
  return tokens.map((token, index) => {
    const item = token as Tokens.Generic;
    const strong = bold || token.type === 'strong';
    const slanted = italic || token.type === 'em';
    const inner = item.tokens ? <Inline tokens={item.tokens} bold={strong} italic={slanted} /> : (item.text as string | undefined);
    switch (token.type) {
      case 'strong':
        return (
          <Text key={index} style={face(true, italic)}>
            {inner}
          </Text>
        );
      case 'em':
        return (
          <Text key={index} style={face(bold, true)}>
            {inner}
          </Text>
        );
      case 'del':
        return (
          <Text key={index} style={styles.del}>
            {inner}
          </Text>
        );
      case 'codespan':
        return (
          <Text key={index} style={[type.code, { backgroundColor: colors.surfaceContainerHigh }]}>
            {item.text as string}
          </Text>
        );
      case 'br':
        return '\n';
      case 'link':
      case 'image': {
        const href = safeLink(String(item.href ?? ''));
        if (!href) return <Text key={index}>{inner}</Text>;
        return (
          <Text key={index} accessibilityRole="link" onPress={() => void Linking.openURL(href).catch(() => {})} style={[styles.link, { color: colors.primary }]}>
            {inner || href}
          </Text>
        );
      }
      default:
        return <Text key={index}>{inner ?? token.raw}</Text>;
    }
  });
}

function Code({ token }: { token: Tokens.Code }) {
  const { t, colors } = useSettings();
  return (
    <View style={[styles.code, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant }]}>
      <View style={styles.codeHead}>
        <AppText variant="bodySmall" color="onSurfaceVariant" style={styles.fill}>
          {token.lang ?? ''}
        </AppText>
        <CopyButton text={token.text} label={t('chat.copyCode')} />
      </View>
      <ScrollView horizontal contentContainerStyle={styles.codeBody}>
        <Text selectable style={[type.code, styles.codeText, { color: colors.onSurface }]}>
          {token.text}
        </Text>
      </ScrollView>
    </View>
  );
}

function Table({ token }: { token: Tokens.Table }) {
  const { colors } = useSettings();
  const row = (cells: Tokens.TableCell[], key: number, head: boolean) => (
    <View key={key} style={[styles.tableRow, { borderColor: colors.outlineVariant }]}>
      {cells.map((cell, index) => (
        <AppText key={index} selectable variant={head ? 'answerHead3' : 'answer'} style={styles.cell}>
          <Inline tokens={cell.tokens} bold={head} />
        </AppText>
      ))}
    </View>
  );
  return (
    <ScrollView horizontal>
      <View style={[styles.table, { borderColor: colors.outlineVariant }]}>
        {row(token.header, -1, true)}
        {token.rows.map((cells, index) => row(cells, index, false))}
      </View>
    </ScrollView>
  );
}

function Blocks({ tokens }: { tokens: Token[] }): ReactNode {
  const { colors } = useSettings();
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'space':
      case 'checkbox':
        return null;
      case 'heading': {
        const heading = token as Tokens.Heading;
        return (
          <AppText key={index} selectable accessibilityRole="header" variant={heading.depth === 1 ? 'answerHead1' : heading.depth === 2 ? 'answerHead2' : 'answerHead3'}>
            <Inline tokens={heading.tokens} bold />
          </AppText>
        );
      }
      case 'code':
        return <Code key={index} token={token as Tokens.Code} />;
      case 'blockquote':
        return (
          <View key={index} style={[styles.quote, { borderColor: colors.outline }]}>
            <Blocks tokens={(token as Tokens.Blockquote).tokens} />
          </View>
        );
      case 'list': {
        const list = token as Tokens.List;
        const start = Number(list.start) || 1;
        return (
          <View key={index} style={styles.block}>
            {list.items.map((item, at) => (
              <View key={at} style={styles.item}>
                <AppText variant="answer" color="onSurfaceVariant">{item.task ? (item.checked ? '☑' : '☐') : list.ordered ? `${start + at}.` : '•'}</AppText>
                <View style={[styles.fill, styles.block]}>
                  <Blocks tokens={item.tokens} />
                </View>
              </View>
            ))}
          </View>
        );
      }
      case 'table':
        return <Table key={index} token={token as Tokens.Table} />;
      case 'hr':
        return <View key={index} style={[styles.rule, { backgroundColor: colors.outlineVariant }]} />;
      default: {
        const block = token as Tokens.Generic;
        return (
          <AppText key={index} selectable variant="answer">
            {block.tokens ? <Inline tokens={block.tokens} /> : ((block.text as string | undefined) ?? token.raw)}
          </AppText>
        );
      }
    }
  });
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <View style={styles.block}>
      <Blocks tokens={lexer(text)} />
    </View>
  );
});

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  fill: { flex: 1 },
  del: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  code: { direction: 'ltr', borderRadius: radius.md, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2, overflow: 'hidden' },
  codeText: { textAlign: 'left', writingDirection: 'ltr' },
  codeHead: { flexDirection: 'row', alignItems: 'center', paddingStart: spacing.md },
  codeBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  quote: { borderStartWidth: spacing.xs, paddingStart: spacing.md, gap: spacing.sm },
  item: { flexDirection: 'row', gap: spacing.sm },
  rule: { height: StyleSheet.hairlineWidth * 2 },
  table: { borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius.md },
  tableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { width: tableCell, padding: spacing.sm },
});
