import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import * as customerBorrowApi from '../../../src/api/customerBorrow';
import * as customerCatalogApi from '../../../src/api/customerCatalog';
import { ApiError } from '../../../src/auth/auth-context';
import { getCategoryGradient, getMonogramLetter } from '../../../src/lib/posterArt';
import {
  buildReservationPayload,
  describeReservationError,
  initialPickupBranchId,
} from '../../../src/lib/publicCatalog';
import { colors, fonts, radius, shadow, spacing, typography } from '../../../src/theme/customerTokens';
import type { CustomerCatalogBook } from '../../../src/types/customerCatalog';

const HERO_HEIGHT = 320;

export default function CustomerBookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [book, setBook] = useState<CustomerCatalogBook | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReserving, setIsReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await customerCatalogApi.getCatalogBookById(id);
      setBook(result);
      // Keep the reader's choice if that branch still has a copy; otherwise start over.
      setBranchId((current) => (buildReservationPayload(result, current) ? current : initialPickupBranchId(result)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được thông tin sách');
    }
  }, [id]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  const payload = book ? buildReservationPayload(book, branchId) : null;
  const chosenBranch = book?.locations.find((location) => location.warehouse_id === branchId) ?? null;

  async function handleReserve() {
    if (!payload) return;
    setIsReserving(true);
    try {
      await customerBorrowApi.createMyReservation(payload);
      Alert.alert('Đặt trước thành công', `Nhận sách tại ${chosenBranch?.warehouse_name ?? 'chi nhánh đã chọn'}. Xem phiếu đặt ở tab "Sách của tôi".`, [
        { text: 'Xem phiếu đặt', onPress: () => router.replace('/customer/my-books') },
        { text: 'Đóng', style: 'cancel' },
      ]);
    } catch (err) {
      const failure = err instanceof ApiError
        ? describeReservationError(err.status, err.message)
        : { message: 'Không đặt trước được. Vui lòng thử lại sau.', refresh: false };
      Alert.alert('Không đặt trước được', failure.message);
      if (failure.refresh) void load();
    } finally {
      setIsReserving(false);
    }
  }

  const isReservable = Boolean(book?.reservable && book.variant_id);
  let buttonLabel = 'Hiện không thể đặt trước';
  if (isReservable) buttonLabel = chosenBranch && payload ? `Đặt trước tại ${chosenBranch.warehouse_name}` : 'Chọn chi nhánh nhận sách';

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
              <MetaRow label="Còn lại" value={`${book.available_quantity} cuốn`} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Nhận sách tại</Text>
              {book.locations.length === 0 ? (
                <Text style={styles.branchEmpty}>Chưa chi nhánh nào còn sách để đặt trước.</Text>
              ) : (
                <View accessibilityRole="radiogroup" style={styles.branchList}>
                  {book.locations.map((location) => {
                    const hasStock = location.available_quantity > 0;
                    const selected = location.warehouse_id === branchId;
                    return (
                      <Pressable
                        key={location.warehouse_id}
                        testID={`pickup-branch-${location.warehouse_id}`}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected, disabled: !hasStock }}
                        accessibilityLabel={`${location.warehouse_name}, ${hasStock ? `còn ${location.available_quantity} cuốn` : 'hết sách'}`}
                        disabled={!hasStock || isReserving}
                        onPress={() => setBranchId(location.warehouse_id)}
                        style={[styles.branchRow, selected && styles.branchRowSelected, !hasStock && styles.branchRowDisabled]}
                      >
                        <View style={[styles.radio, selected && styles.radioSelected]}>
                          {selected ? <View style={styles.radioDot} /> : null}
                        </View>
                        <Text style={styles.branchName}>{location.warehouse_name}</Text>
                        <Text style={styles.branchStock}>{hasStock ? `còn ${location.available_quantity} cuốn` : 'hết sách'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
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
                (!payload || isReserving) && styles.buttonDisabled,
                pressed && payload && styles.buttonPressed,
              ]}
              onPress={handleReserve}
              disabled={!payload || isReserving}
              accessibilityRole="button"
              accessibilityState={{ disabled: !payload || isReserving }}
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
                <Text style={styles.buttonText}>{buttonLabel}</Text>
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
  branchList: {
    gap: spacing.sm,
  },
  branchEmpty: {
    ...typography.caption,
  },
  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
  },
  branchRowSelected: {
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primarySoft,
  },
  branchRowDisabled: {
    opacity: 0.45,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  branchName: {
    ...typography.bodyBold,
    flex: 1,
  },
  branchStock: {
    ...typography.caption,
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
