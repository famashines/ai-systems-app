import { lexer, type Token, type Tokens } from 'marked';
import { memo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Clipboard, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppText, IconButton } from '@/components/ui';
import { useSettings } from '@/state/settings';
import { radius, spacing, tableCell, type } from '@/theme';

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
      onPress={copy}
    />
  );
}

function Inline({ tokens }: { tokens: Token[] }): ReactNode {
  const { colors } = useSettings();
  return tokens.map((token, index) => {
    const item = token as Tokens.Generic;
    const inner = item.tokens ? <Inline tokens={item.tokens} /> : (item.text as string | undefined);
    switch (token.type) {
      case 'strong':
        return (
          <Text key={index} style={styles.strong}>
            {inner}
          </Text>
        );
      case 'em':
        return (
          <Text key={index} style={styles.em}>
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
        <Text selectable style={[type.code, { color: colors.onSurface }]}>
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
        <AppText key={index} selectable variant={head ? 'label' : 'body'} style={styles.cell}>
          <Inline tokens={cell.tokens} />
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
          <AppText key={index} selectable accessibilityRole="header" variant={heading.depth === 1 ? 'headline' : heading.depth === 2 ? 'title' : 'label'}>
            <Inline tokens={heading.tokens} />
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
                <AppText color="onSurfaceVariant">{item.task ? (item.checked ? '☑' : '☐') : list.ordered ? `${start + at}.` : '•'}</AppText>
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
          <AppText key={index} selectable>
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
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  del: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  code: { borderRadius: radius.md, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2, overflow: 'hidden' },
  codeHead: { flexDirection: 'row', alignItems: 'center', paddingStart: spacing.md },
  codeBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  quote: { borderStartWidth: spacing.xs, paddingStart: spacing.md, gap: spacing.sm },
  item: { flexDirection: 'row', gap: spacing.sm },
  rule: { height: StyleSheet.hairlineWidth * 2 },
  table: { borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius.sm },
  tableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { width: tableCell, padding: spacing.sm },
});
