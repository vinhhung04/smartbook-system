import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BookCover } from '../../src/components/customer/BookCover';
import { useCatalogPages } from '../../src/hooks/useCatalogPages';
import {
  EmptyState, ErrorState, IconButton, InlineAlert, PressableScale, ScreenHeader, SearchField, Skeleton, StatusBadge, fontFamily, radii, space, useTheme,
} from '../../src/design-system';

const SEARCH_DEBOUNCE_MS = 400;

function Chip({ label, active, icon, onPress, accessibilityLabel }: { label: string; active?: boolean; icon?: 'close' | 'sparkles-outline' | 'checkmark'; onPress: () => void; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        minHeight: 40, paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radii.pill,
        backgroundColor: active ? colors.textPrimary : colors.surface, borderWidth: 1, borderColor: active ? colors.textPrimary : colors.border,
      }}
    >
      {icon && icon !== 'close' ? <Ionicons name={icon} size={15} color={active ? colors.surface : colors.primary} /> : null}
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: active ? colors.surface : colors.textPrimary }}>{label}</Text>
      {icon === 'close' ? <Ionicons name="close" size={15} color={active ? colors.surface : colors.textPrimary} /> : null}
    </PressableScale>
  );
}

export default function CustomerSearchScreen() {
  const { colors, type } = useTheme();
  // Opened from a home "Thể loại" tile: browse that category without typing.
  const params = useLocalSearchParams<{ category?: string; categoryName?: string }>();
  const [category, setCategory] = useState<{ slug: string; name: string } | null>(
    params.category ? { slug: String(params.category), name: String(params.categoryName ?? params.category) } : null,
  );
  const [availableOnly, setAvailableOnly] = useState(false);
  const [search, setSearch] = useState('');
  // The term actually queried: updated after the debounce, so each keystroke
  // does not start a request. Empty → nothing to load.
  const [term, setTerm] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const catalog = useCatalogPages(
    term || category
      ? { ...(term ? { search: term } : {}), ...(category ? { category: category.slug } : {}), ...(availableOnly ? { availability: 'available' as const } : {}) }
      : null,
  );
  const isTyping = search.trim() !== term;
  const querying = Boolean(search.trim() || category);

  return (
    <>
      <ScreenHeader
        title="Tìm sách"
        right={<IconButton icon="camera-outline" accessibilityLabel="Tìm sách bằng ảnh bìa" onPress={() => router.push('/customer/scan-cover')} />}
      />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.md }}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Tên sách, tác giả…"
            autoCapitalize="none"
            autoFocus={!category}
            accessibilityLabel="Tìm sách"
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {category ? <Chip label={category.name} active icon="close" onPress={() => setCategory(null)} accessibilityLabel={`Bỏ lọc thể loại ${category.name}`} /> : null}
            <Chip label="Chỉ sách còn" active={availableOnly} icon={availableOnly ? 'checkmark' : undefined} onPress={() => setAvailableOnly((value) => !value)} />
            <Chip label="Mô tả bằng lời" icon="sparkles-outline" onPress={() => router.push('/customer/assistant')} accessibilityLabel="Mô tả cuốn sách bằng lời cho trợ lý" />
          </View>
        </View>

        {!querying ? (
          <EmptyState
            icon="search-outline"
            title="Tìm trong thư viện"
            message="Gõ tên sách hoặc tác giả. Không nhớ tên? Hãy mô tả nội dung, hoặc chụp ảnh bìa."
            actionLabel="Tìm bằng ảnh bìa"
            onAction={() => router.push('/customer/scan-cover')}
          />
        ) : (catalog.loadingInitial || (isTyping && catalog.items.length === 0)) ? (
          <View style={{ paddingHorizontal: space.lg, gap: space.md }} accessibilityLabel="Đang tìm">
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ flexDirection: 'row', gap: space.md }}>
                <Skeleton width={64} height={96} />
                <View style={{ flex: 1, gap: space.sm, paddingTop: space.sm }}>
                  <Skeleton width="80%" height={16} />
                  <Skeleton width="50%" height={13} />
                </View>
              </View>
            ))}
          </View>
        ) : catalog.error && catalog.items.length === 0 ? (
          <ErrorState message={catalog.error} onRetry={catalog.retry} />
        ) : (
          <FlatList
            data={catalog.items}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}
            // Guarded in the loader: ignored while a page is loading or after the last page.
            onEndReached={catalog.loadMore}
            onEndReachedThreshold={0.5}
            ListHeaderComponent={(term || category) && catalog.total > 0 ? <Text style={[type.caption, { marginBottom: space.xs }]}>{catalog.total} kết quả</Text> : null}
            ListFooterComponent={
              catalog.loadingMore ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: space.lg }} />
              ) : catalog.error ? (
                <InlineAlert message="Không tải thêm được kết quả." actionLabel="Thử lại" onAction={catalog.retry} />
              ) : null
            }
            ListEmptyComponent={
              term && !isTyping ? (
                <EmptyState
                  icon="book-outline"
                  title="Không có sách khớp với từ khoá"
                  message="Thử từ khoá ngắn hơn, bỏ bớt bộ lọc, hoặc mô tả nội dung để trợ lý tìm giúp."
                  actionLabel="Mô tả bằng lời"
                  onAction={() => router.push('/customer/assistant')}
                />
              ) : null
            }
            renderItem={({ item }) => {
              const available = item.available_quantity > 0;
              return (
                <PressableScale
                  onPress={() => router.push(`/customer/book/${item.id}`)}
                  scale={false}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, ${item.author ?? 'chưa rõ tác giả'}, ${available ? `còn ${item.available_quantity} cuốn` : 'hết sách'}`}
                  style={{ flexDirection: 'row', gap: space.md, padding: space.sm, borderRadius: radii.md }}
                  pressedStyle={{ backgroundColor: colors.surfaceRaised }}
                >
                  <BookCover title={item.title} author={item.author} category={item.category} coverImageUrl={item.cover_image_url} width={64} />
                  <View style={{ flex: 1, justifyContent: 'center', gap: 4 }}>
                    <Text style={{ fontFamily: fontFamily.serif, fontSize: 17, lineHeight: 22, color: colors.textPrimary }} numberOfLines={2}>{item.title}</Text>
                    <Text style={type.caption} numberOfLines={1}>
                      {item.author ?? 'Chưa rõ tác giả'}{item.category ? `, ${item.category}` : ''}
                    </Text>
                    <StatusBadge tone={available ? 'success' : 'neutral'} label={available ? `Còn ${item.available_quantity} cuốn` : 'Hết sách'} icon={available ? 'checkmark-circle' : null} />
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={{ alignSelf: 'center' }} />
                </PressableScale>
              );
            }}
          />
        )}
      </View>
    </>
  );
}
