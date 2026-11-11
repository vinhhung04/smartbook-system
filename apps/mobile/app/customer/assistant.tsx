import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { discoverBooks, type DiscoverResult } from '../../src/api/discover';
import { ApiError, isAbortError } from '../../src/api/client';
import { BookTile } from '../../src/components/customer/BookCover';
import { describeDiscoverResult, MAX_DISCOVER_CHARS, normalizeDiscoverQuery } from '../../src/lib/discoverAnswer';
import { Button, PressableScale, ScreenHeader, fontFamily, radii, space, useTheme } from '../../src/design-system';

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
  const { colors, type } = useTheme();
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

  const canSend = !busy && input.trim().length > 0;

  return (
    <>
      <ScreenHeader title="Trợ lý tìm sách" />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <FlatList
          ref={listRef}
          data={turns}
          keyExtractor={(turn) => turn.id}
          contentContainerStyle={{ padding: space.lg, gap: space.lg, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          ListHeaderComponent={
            <View style={{ gap: space.md, paddingBottom: space.sm }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="sparkles" size={22} color={colors.onPrimary} />
              </View>
              <Text style={type.title} accessibilityRole="header">Bạn muốn đọc gì?</Text>
              <Text style={type.body}>
                Mô tả cuốn sách theo cách của bạn: chủ đề, thể loại, tác giả hay mục đích đọc. Trợ lý tìm theo ý nghĩa trong danh mục thư viện và chỉ gợi ý những cuốn thư viện đang có.
              </Text>
              {turns.length === 0 ? (
                <View style={{ gap: space.sm }}>
                  <Text style={type.label}>Thử hỏi</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {EXAMPLES.map((example) => (
                      <PressableScale
                        key={example}
                        onPress={() => void ask(example)}
                        accessibilityRole="button"
                        style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                      >
                        <Text style={{ fontFamily: fontFamily.medium, fontSize: 14, color: colors.textPrimary }}>{example}</Text>
                      </PressableScale>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) =>
            item.role === 'user' ? (
              <View style={{ alignSelf: 'flex-end', maxWidth: '85%', paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radii.lg, borderBottomRightRadius: radii.xs, backgroundColor: colors.primary }}>
                <Text style={{ fontFamily: fontFamily.medium, fontSize: 15.5, lineHeight: 22, color: colors.onPrimary }}>{item.text}</Text>
              </View>
            ) : (
              <View style={{ gap: space.md }}>
                <View
                  style={{
                    alignSelf: 'flex-start', maxWidth: '90%', paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radii.lg, borderBottomLeftRadius: radii.xs,
                    backgroundColor: item.error ? colors.dangerSoft : colors.surface, borderWidth: 1, borderColor: item.error ? 'transparent' : colors.border,
                  }}
                  accessibilityLiveRegion="polite"
                >
                  <Text style={[type.body, { fontSize: 15.5 }]}>{item.text}</Text>
                </View>
                {item.result && item.result.results.length > 0 ? (
                  <FlatList
                    horizontal
                    data={item.result.results}
                    keyExtractor={(row) => row.book.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: space.md, paddingRight: space.lg }}
                    renderItem={({ item: row }) => <BookTile book={row.book} width={108} onPress={() => router.push(`/customer/book/${row.book.id}`)} />}
                  />
                ) : null}
                {item.result?.status === 'NO_EVIDENCE' || item.error ? (
                  <Button label="Tìm theo từ khóa" icon="search" variant="secondary" size="md" fullWidth={false} onPress={() => router.push('/customer/search')} />
                ) : null}
              </View>
            )
          }
          ListFooterComponent={busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.primary} />
              <Text style={type.caption}>Đang tìm trong thư viện…</Text>
            </View>
          ) : undefined}
        />
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: Math.max(insets.bottom, space.md), gap: space.xs, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
          {inputError ? <Text style={{ fontFamily: fontFamily.medium, fontSize: 13.5, color: colors.danger }} accessibilityLiveRegion="polite">{inputError}</Text> : null}
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
            <TextInput
              style={[
                Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
                { flex: 1, minHeight: 48, maxHeight: 120, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radii.lg, backgroundColor: colors.bg, color: colors.textPrimary, fontFamily: fontFamily.regular, fontSize: 16 },
              ]}
              value={input}
              onChangeText={(value) => { setInput(value); if (inputError) setInputError(null); }}
              placeholder="Ví dụ: sách về khởi nghiệp cho người mới"
              placeholderTextColor={colors.textMuted}
              maxLength={MAX_DISCOVER_CHARS}
              multiline
              submitBehavior="submit"
              returnKeyType="send"
              onSubmitEditing={() => void ask(input)}
              editable={!busy}
              accessibilityLabel="Mô tả sách bạn muốn tìm"
            />
            <Pressable
              style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', opacity: canSend ? 1 : 0.4 }}
              onPress={() => void ask(input)}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Gửi"
              accessibilityState={{ disabled: !canSend }}
            >
              <Ionicons name="arrow-up" size={21} color={colors.onPrimary} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
