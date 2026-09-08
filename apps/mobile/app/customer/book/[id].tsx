import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import * as customerBorrowApi from '../../../src/api/customerBorrow';
import * as customerCatalogApi from '../../../src/api/customerCatalog';
import { ApiError } from '../../../src/auth/auth-context';
import { getCategoryGradient, getMonogramLetter } from '../../../src/lib/posterArt';
import { colors, fonts, radius, shadow, spacing, typography } from '../../../src/theme/customerTokens';
import type { CustomerCatalogBook } from '../../../src/types/customerCatalog';

const HERO_HEIGHT = 320;

export default function CustomerBookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [book, setBook] = useState<CustomerCatalogBook | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReserving, setIsReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await customerCatalogApi.getCatalogBookById(id);
      setBook(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được thông tin sách');
    }
  }, [id]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  async function handleReserve() {
    if (!book?.variant_id || !book.default_warehouse_id) return;
    setIsReserving(true);
    try {
      await customerBorrowApi.createMyReservation({
        variant_id: book.variant_id,
        warehouse_id: book.default_warehouse_id,
        pickup_location_id: book.default_location_id ?? undefined,
        quantity: 1,
      });
      Alert.alert('Đặt sách thành công', 'Xem phiếu đặt của bạn ở tab "Sách của tôi".', [
        { text: 'Xem phiếu đặt', onPress: () => router.replace('/customer/my-books') },
        { text: 'Đóng', style: 'cancel' },
      ]);
    } catch (err) {
      Alert.alert('Không đặt được sách', err instanceof ApiError ? err.message : 'Vui lòng thử lại sau.');
    } finally {
      setIsReserving(false);
    }
  }

  const canReserve = Boolean(book?.reservable && book.variant_id && book.default_warehouse_id && book.available_quantity > 0);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: '', headerTransparent: true }} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error || !book ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error ?? 'Không tìm thấy sách'}</Text>
        </View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <HeroArt book={book} />

          <View style={styles.body}>
            <View style={styles.metaGrid}>
              <MetaRow label="Tác giả" value={book.author ?? '—'} />
              <MetaRow label="Thể loại" value={book.category ?? '—'} />
              <MetaRow label="Nhà xuất bản" value={book.publisher ?? '—'} />
              <MetaRow label="ISBN" value={book.isbn ?? '—'} />
              <MetaRow label="Còn lại" value={`${book.available_quantity}/${book.quantity}`} />
            </View>

            {book.description ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Mô tả</Text>
                <Text style={styles.description}>{book.description}</Text>
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                (!canReserve || isReserving) && styles.buttonDisabled,
                pressed && canReserve && styles.buttonPressed,
              ]}
              onPress={handleReserve}
              disabled={!canReserve || isReserving}
            >
              <LinearGradient
                colors={[colors.accentGradientStart, colors.accentGradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.buttonGloss} />
              {isReserving ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>{canReserve ? 'Đặt sách' : 'Hiện không thể đặt'}</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      )}
    </>
  );
}

function HeroArt({ book }: { book: CustomerCatalogBook }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(book.cover_image_url) && !imageFailed;
  const [gradientStart, gradientEnd] = getCategoryGradient(book.category);

  return (
    <View style={styles.hero}>
      {showImage ? (
        <Image
          source={{ uri: book.cover_image_url! }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <>
          <LinearGradient
            colors={[gradientStart, gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={[styles.heroMonogram, { color: gradientStart }]}>{getMonogramLetter(book.title)}</Text>
        </>
      )}
      <LinearGradient colors={['transparent', colors.bg]} locations={[0.4, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.heroText}>
        <Text style={styles.title}>{book.title}</Text>
        {book.subtitle ? <Text style={styles.subtitle}>{book.subtitle}</Text> : null}
      </View>
    </View>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.bg,
  },
  error: {
    color: colors.danger,
    fontWeight: '600',
  },
  hero: {
    height: HERO_HEIGHT,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  heroMonogram: {
    position: 'absolute',
    top: -30,
    left: -16,
    fontFamily: fonts.displayBold,
    fontSize: HERO_HEIGHT * 0.9,
    lineHeight: HERO_HEIGHT * 0.9,
    opacity: 0.22,
  },
  heroText: {
    padding: spacing.lg,
  },
  title: {
    ...typography.h1,
  },
  subtitle: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  body: {
    paddingHorizontal: spacing.lg,
  },
  metaGrid: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaLabel: {
    ...typography.caption,
  },
  metaValue: {
    ...typography.bodyBold,
  },
  section: {
    marginTop: spacing.xl,
  },
  sectionLabel: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  description: {
    ...typography.body,
  },
  button: {
    borderRadius: radius.pill,
    paddingVertical: spacing.md + 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xxl,
    overflow: 'hidden',
  },
  buttonGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontFamily: fonts.displayBold,
    color: colors.onPrimary,
    fontSize: 18,
  },
});
