import { useEffect, useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { discoverBooks, type DiscoverResult } from '../../src/api/discover';
import { ApiError, isAbortError } from '../../src/api/client';
import { PosterCard } from '../../src/components/customer/PosterCard';
import { describeDiscoverResult, MAX_DISCOVER_CHARS, normalizeDiscoverQuery } from '../../src/lib/discoverAnswer';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/customerTokens';

type Turn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; result?: DiscoverResult; error?: boolean };

const EXAMPLES = ['Truyện trinh thám kịch tính', 'Sách giúp quản lý thời gian', 'Tiểu thuyết Nhật Bản nhẹ nhàng', 'Sách thiếu nhi về động vật'];

/**
 * "Trợ lý tìm sách": the reader describes a book in their own words and gets books that
 * exist in the library, with live availability. Answers come from /public/discover
 * (retrieval over the public catalog, no LLM text): it cannot see accounts, staff data
 * or reports and cannot act on anything — which is why the staff/admin chatbot is not
 * exposed here.
 */
export default function CustomerAssistantScreen() {
  const insets = useSafeAreaInsets();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<Turn>>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function ask(raw: string) {
    const check = normalizeDiscoverQuery(raw);
    if (!check.ok) {
      setInputError(check.error);
      return;
    }
    if (busy) return;
    setInputError(null);
    setInput('');
    const stamp = Date.now().toString(36);
    setTurns((current) => [...current, { id: `u-${stamp}`, role: 'user', text: check.query }]);
    setBusy(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await discoverBooks(check.query, controller.signal);
      setTurns((current) => [...current, { id: `a-${stamp}`, role: 'assistant', text: describeDiscoverResult(result), result }]);
    } catch (err) {
      if (isAbortError(err)) return;
      const text =
        err instanceof ApiError && err.status === 429
          ? 'Trợ lý đang nhận quá nhiều câu hỏi. Đợi một chút rồi thử lại, hoặc dùng ô Tìm kiếm theo từ khóa.'
          : err instanceof ApiError && err.kind !== 'http'
            ? 'Không kết nối được trợ lý. Kiểm tra mạng rồi thử lại.'
            : 'Trợ lý tạm thời không khả dụng. Bạn vẫn có thể tìm theo từ khóa.';
      setTurns((current) => [...current, { id: `a-${stamp}`, role: 'assistant', text, error: true }]);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setBusy(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Trợ lý tìm sách' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <FlatList
          ref={listRef}
          data={turns}
          keyExtractor={(turn) => turn.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.intro}>
              <Ionicons name="sparkles-outline" size={22} color={colors.primary} />
              <Text style={styles.introTitle}>Bạn muốn đọc gì?</Text>
              <Text style={styles.introText}>
                Mô tả cuốn sách theo cách của bạn — thể loại, chủ đề, tác giả hay mục đích đọc. Kết quả lấy trực tiếp từ danh mục thư viện.
              </Text>
              {turns.length === 0 ? (
                <View style={styles.examples}>
                  {EXAMPLES.map((example) => (
                    <Pressable key={example} style={styles.example} onPress={() => void ask(example)} accessibilityRole="button">
                      <Text style={styles.exampleText}>{example}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) =>
            item.role === 'user' ? (
              <View style={[styles.bubble, styles.userBubble]}>
                <Text style={styles.userText}>{item.text}</Text>
              </View>
            ) : (
              <View style={styles.answer}>
                <View style={[styles.bubble, styles.assistantBubble, item.error && styles.errorBubble]}>
                  <Text style={styles.assistantText}>{item.text}</Text>
                </View>
                {item.result && item.result.results.length > 0 ? (
                  <FlatList
                    horizontal
                    data={item.result.results}
                    keyExtractor={(row) => row.book.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.results}
                    renderItem={({ item: row }) => (
                      <View style={styles.resultCard}>
                        <PosterCard title={row.book.title} category={row.book.category} coverImageUrl={row.book.cover_image_url} width={104} height={156} onPress={() => router.push(`/customer/book/${row.book.id}`)} />
                        <Text style={styles.resultTitle} numberOfLines={2}>{row.book.title}</Text>
                        <Text style={[styles.resultMeta, row.book.available_quantity > 0 ? styles.available : styles.unavailable]}>
                          {row.book.available_quantity > 0 ? `Còn ${row.book.available_quantity} cuốn` : 'Hết sách'}
                        </Text>
                      </View>
                    )}
                  />
                ) : null}
                {item.result?.status === 'NO_EVIDENCE' || item.error ? (
                  <Pressable onPress={() => router.push('/customer/search')} style={styles.link} accessibilityRole="button">
                    <Text style={styles.linkText}>Tìm theo từ khóa</Text>
                  </Pressable>
                ) : null}
              </View>
            )
          }
          ListFooterComponent={busy ? <ActivityIndicator color={colors.primary} style={styles.footer} /> : null}
        />
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {inputError ? <Text style={styles.error}>{inputError}</Text> : null}
          <View style={styles.composerRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ví dụ: sách về khởi nghiệp cho người mới"
              placeholderTextColor={colors.textMuted}
              maxLength={MAX_DISCOVER_CHARS}
              returnKeyType="send"
              onSubmitEditing={() => void ask(input)}
              editable={!busy}
              accessibilityLabel="Mô tả sách bạn muốn tìm"
            />
            <Pressable style={[styles.send, (busy || !input.trim()) && styles.sendDisabled]} onPress={() => void ask(input)} disabled={busy || !input.trim()} accessibilityRole="button" accessibilityLabel="Gửi">
              <Ionicons name="arrow-up" size={20} color={colors.onPrimary} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  intro: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  introTitle: { ...typography.h3 },
  introText: { ...typography.caption, textAlign: 'center' },
  examples: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
  example: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primaryBorder },
  exampleText: { ...typography.caption, color: colors.primary },
  bubble: { maxWidth: '85%', padding: spacing.md, borderRadius: radius.md },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  userText: { fontFamily: fonts.bodyMedium, color: colors.onPrimary, fontSize: 15 },
  answer: { gap: spacing.sm },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  errorBubble: { borderWidth: 1, borderColor: colors.dangerBorder },
  assistantText: { ...typography.body, fontSize: 15 },
  results: { gap: spacing.md, paddingRight: spacing.lg },
  resultCard: { width: 104, gap: 4 },
  resultTitle: { ...typography.caption, color: colors.textPrimary, fontSize: 12 },
  resultMeta: { ...typography.caption, fontSize: 11 },
  available: { color: colors.success },
  unavailable: { color: colors.warning },
  link: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' },
  linkText: { fontFamily: fonts.bodySemibold, color: colors.primary },
  footer: { marginVertical: spacing.md },
  composer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgElevated, gap: 4 },
  composerRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: 12 },
});
