import { useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { filterOptions, type SelectOption } from '../lib/optionSearch';
import { ErrorState, IconButton, LoadingState, SearchField, fontFamily, radii, space, useTheme } from '../design-system';

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
  const { colors, type } = useTheme();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const filtered = useMemo(() => filterOptions(options, query), [options, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng danh sách chọn" />
        <View
          style={{
            maxHeight: '85%', backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, borderCurve: 'continuous',
            paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, space.lg), gap: space.md,
          }}
          accessibilityViewIsModal
        >
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm }}>
            <Text style={[type.title, { flex: 1, fontSize: 20 }]} accessibilityRole="header">{title}</Text>
            <IconButton icon="close" accessibilityLabel="Đóng" onPress={onClose} />
          </View>

          {options.length > 6 || query ? (
            <View style={{ paddingHorizontal: space.lg }}>
              <SearchField value={query} onChangeText={setQuery} placeholder={searchPlaceholder} autoCapitalize="none" accessibilityLabel={searchPlaceholder} />
            </View>
          ) : null}

          {loading ? (
            <LoadingState label="Đang tải danh sách…" />
          ) : error ? (
            <ErrorState message={error} onRetry={onRetry} compact />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: space.sm }}
              ListEmptyComponent={
                <Text style={[type.caption, { textAlign: 'center', paddingVertical: space.xl }]}>{query ? 'Không tìm thấy kết quả phù hợp' : emptyText}</Text>
              }
              renderItem={({ item }) => {
                const selected = item.id === selectedId;
                return (
                  <Pressable
                    style={({ pressed }) => ({
                      minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radii.sm,
                      backgroundColor: selected ? colors.primarySoft : pressed ? colors.surfaceRaised : 'transparent',
                    })}
                    onPress={() => onSelect(item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={[item.title, item.subtitle].filter(Boolean).join(', ')}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontFamily: selected ? fontFamily.semibold : fontFamily.medium, fontSize: 16, color: colors.textPrimary }} numberOfLines={2}>{item.title}</Text>
                      {item.subtitle ? <Text style={type.caption} numberOfLines={2}>{item.subtitle}</Text> : null}
                    </View>
                    {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
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
