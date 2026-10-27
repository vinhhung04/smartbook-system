import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { filterOptions, type SelectOption } from '../lib/optionSearch';
import { colors, fonts, radius, spacing, typography } from '../theme/tokens';

type Props<T extends SelectOption> = {
  visible: boolean;
  title: string;
  options: T[];
  onSelect: (option: T) => void;
  onClose: () => void;
  selectedId?: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  searchPlaceholder?: string;
  emptyText?: string;
};

/**
 * Searchable bottom-sheet picker. Replaces Alert.alert() button lists, which Android
 * caps at three buttons — a manager with twelve staff could only ever pick the first two.
 */
export function SelectionSheet<T extends SelectOption>({
  visible,
  title,
  options,
  onSelect,
  onClose,
  selectedId,
  loading = false,
  error = null,
  onRetry,
  searchPlaceholder = 'Tìm theo tên hoặc mã',
  emptyText = 'Không có lựa chọn nào',
}: Props<T>) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const filtered = useMemo(() => filterOptions(options, query), [options, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng danh sách chọn" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Đóng">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {options.length > 6 || query ? (
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.search}
                value={query}
                onChangeText={setQuery}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                accessibilityLabel={searchPlaceholder}
              />
            </View>
          ) : null}

          {loading ? (
            <View style={styles.state}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.stateText}>Đang tải danh sách…</Text>
            </View>
          ) : error ? (
            <View style={styles.state}>
              <Text style={styles.errorText}>{error}</Text>
              {onRetry ? (
                <Pressable style={styles.retryButton} onPress={onRetry} accessibilityRole="button">
                  <Text style={styles.retryText}>Thử lại</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={
                <View style={styles.state}>
                  <Text style={styles.stateText}>{query ? 'Không tìm thấy kết quả phù hợp' : emptyText}</Text>
                </View>
              }
              renderItem={({ item }) => {
                const selected = item.id === selectedId;
                return (
                  <Pressable
                    style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}
                    onPress={() => onSelect(item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={[item.title, item.subtitle].filter(Boolean).join(', ')}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
                      {item.subtitle ? <Text style={styles.rowSubtitle} numberOfLines={2}>{item.subtitle}</Text> : null}
                    </View>
                    {selected ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(16,20,17,0.45)',
  },
  sheet: {
    maxHeight: '82%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h3,
    flex: 1,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  search: {
    flex: 1,
    minHeight: 44,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textPrimary,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  rowSelected: {
    backgroundColor: colors.primarySoft,
  },
  rowPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  rowSubtitle: {
    ...typography.caption,
  },
  state: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  stateText: {
    ...typography.caption,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: colors.primary,
    fontFamily: fonts.bodySemibold,
  },
});
