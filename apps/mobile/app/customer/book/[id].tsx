import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text, View } from 'react-native';

import * as customerBorrowApi from '../../../src/api/customerBorrow';
import { isOutcomeUnknown } from '../../../src/api/client';
import { BookReviews } from '../../../src/components/customer/BookReviews';
import { useBookEngagement } from '../../../src/hooks/useBookEngagement';
import { useSubmitLock } from '../../../src/lib/submitLock';
import * as customerCatalogApi from '../../../src/api/customerCatalog';
import { ApiError } from '../../../src/auth/auth-context';
import { BookCover } from '../../../src/components/customer/BookCover';
import {
  buildReservationPayload,
  describeReservationError,
  initialPickupBranchId,
} from '../../../src/lib/publicCatalog';
import {
  Button, Card, ErrorState, InfoRow, LoadingState, PressableScale, Screen, ScreenHeader, SectionHeader, StatusBadge, fontFamily, radii, space, useTheme,
} from '../../../src/design-system';
import type { CustomerCatalogBook } from '../../../src/types/customerCatalog';

export default function CustomerBookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, type } = useTheme();
  const [book, setBook] = useState<CustomerCatalogBook | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReserving, setIsReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const engagement = useBookEngagement(id);
  const reserveLock = useSubmitLock();

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
    await reserveLock.run(async () => {
      setIsReserving(true);
      try {
        await customerBorrowApi.createMyReservation(payload);
        Alert.alert('Đặt trước thành công', `Nhận sách tại ${chosenBranch?.warehouse_name ?? 'chi nhánh đã chọn'}. Xem phiếu đặt ở tab "Sách của tôi".`, [
          { text: 'Xem phiếu đặt', onPress: () => router.replace('/customer/my-books') },
          { text: 'Đóng', style: 'cancel' },
        ]);
      } catch (err) {
        if (isOutcomeUnknown(err)) {
          // Re-sending could reserve a second copy: send the reader to check first.
          Alert.alert('Chưa rõ đã đặt trước được chưa', 'Kết nối bị gián đoạn khi gửi. Hãy kiểm tra tab "Sách của tôi" trước khi đặt lại.', [
            { text: 'Kiểm tra', onPress: () => router.replace('/customer/my-books') },
            { text: 'Đóng', style: 'cancel' },
          ]);
          return;
        }
        const failure = err instanceof ApiError
          ? describeReservationError(err.status, err.message)
          : { message: 'Không đặt trước được. Vui lòng thử lại sau.', refresh: false };
        Alert.alert('Không đặt trước được', failure.message);
        if (failure.refresh) void load();
      } finally {
        setIsReserving(false);
      }
    });
  }

  const outOfStock = book ? book.available_quantity <= 0 || !book.reservable : false;

  const isReservable = Boolean(book?.reservable && book.variant_id);
  let buttonLabel = 'Hiện không thể đặt trước';
  if (isReservable) buttonLabel = chosenBranch && payload ? `Đặt trước tại ${chosenBranch.warehouse_name}` : 'Chọn chi nhánh nhận sách';

  const branchesWithStock = book ? book.locations.filter((location) => location.available_quantity > 0).length : 0;

  if (isLoading) {
    return (
      <>
        <ScreenHeader title="Chi tiết sách" />
        <Screen scroll={false}><LoadingState label="Đang mở sách…" /></Screen>
      </>
    );
  }
  if (error || !book) {
    return (
      <>
        <ScreenHeader title="Chi tiết sách" />
        <Screen scroll={false}><ErrorState title="Không mở được sách" message={error ?? 'Không tìm thấy sách'} onRetry={() => { setIsLoading(true); void load().finally(() => setIsLoading(false)); }} /></Screen>
      </>
    );
  }

  return (
    <>
      <ScreenHeader title="Chi tiết sách" />
      <Screen
        bleed
        footer={
          <Button
            label={buttonLabel}
            icon="bookmark-outline"
            loading={isReserving}
            loadingLabel="Đang đặt trước…"
            disabled={!payload}
            onPress={handleReserve}
          />
        }
      >
        {/* The book on its own lit field: the cover is the content. */}
        <View style={{ marginHorizontal: space.lg, padding: space.xl, gap: space.lg, alignItems: 'center', borderRadius: radii.xl, borderCurve: 'continuous', backgroundColor: colors.inkField }}>
          <BookCover title={book.title} author={book.author} category={book.category} coverImageUrl={book.cover_image_url} width={150} />
          <View style={{ alignItems: 'center', gap: space.xs }}>
            <Text style={{ fontFamily: fontFamily.serif, fontSize: 26, lineHeight: 31, color: colors.onInk, textAlign: 'center' }} accessibilityRole="header">{book.title}</Text>
            {book.subtitle ? <Text style={{ fontFamily: fontFamily.regular, fontSize: 15, color: colors.onInkMuted, textAlign: 'center' }}>{book.subtitle}</Text> : null}
            <Text style={{ fontFamily: fontFamily.medium, fontSize: 15, color: colors.onInkMuted }}>{book.author ?? 'Chưa rõ tác giả'}</Text>
          </View>
          <View style={{ paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: outOfStock ? colors.onInkMuted : '#B8F0D2' }}>
              {outOfStock ? 'Đã được mượn hết' : `Còn ${book.available_quantity} cuốn ở ${branchesWithStock} chi nhánh`}
            </Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: space.lg, gap: space.xl }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Button
              label={engagement.saved ? 'Đã lưu' : 'Yêu thích'}
              icon={engagement.saved ? 'heart' : 'heart-outline'}
              variant="secondary"
              size="md"
              fullWidth={false}
              loading={engagement.busy === 'wishlist'}
              disabled={engagement.saved === null || engagement.busy !== null}
              onPress={() => void engagement.toggleWishlist()}
              accessibilityLabel={engagement.saved ? 'Bỏ khỏi danh sách yêu thích' : 'Thêm vào danh sách yêu thích'}
            />
            {outOfStock ? (
              <Button
                label={engagement.alertActive ? 'Sẽ báo khi có sách' : 'Báo khi có sách'}
                icon={engagement.alertActive ? 'notifications' : 'notifications-outline'}
                variant="secondary"
                size="md"
                fullWidth={false}
                loading={engagement.busy === 'alert'}
                disabled={engagement.alertActive === null || engagement.busy !== null}
                onPress={() => void engagement.toggleAlert()}
                accessibilityLabel={engagement.alertActive ? 'Hủy báo khi có sách' : 'Báo cho tôi khi có sách'}
              />
            ) : null}
          </View>

          <View style={{ gap: space.md }}>
            <SectionHeader title="Nhận sách tại" caption={book.locations.length > 0 ? 'Chọn chi nhánh bạn sẽ đến lấy sách.' : undefined} />
            {book.locations.length === 0 ? (
              <Text style={type.caption}>Chưa chi nhánh nào còn sách để đặt trước.</Text>
            ) : (
              <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
                {book.locations.map((location) => {
                  const hasStock = location.available_quantity > 0;
                  const selected = location.warehouse_id === branchId;
                  return (
                    <PressableScale
                      key={location.warehouse_id}
                      testID={`pickup-branch-${location.warehouse_id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: !hasStock }}
                      accessibilityLabel={`${location.warehouse_name}, ${hasStock ? `còn ${location.available_quantity} cuốn` : 'hết sách'}`}
                      disabled={!hasStock || isReserving}
                      onPress={() => setBranchId(location.warehouse_id)}
                      scale={false}
                      style={{
                        minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, borderRadius: radii.md,
                        backgroundColor: selected ? colors.primarySoft : colors.surface, borderWidth: selected ? 2 : 1, borderColor: selected ? colors.primary : colors.border,
                        opacity: hasStock ? 1 : 0.55,
                      }}
                    >
                      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? colors.primary : colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
                        {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} /> : null}
                      </View>
                      <Text style={{ flex: 1, fontFamily: fontFamily.semibold, fontSize: 15.5, color: colors.textPrimary }}>{location.warehouse_name}</Text>
                      <Text style={{ fontFamily: fontFamily.medium, fontSize: 13.5, color: hasStock ? colors.success : colors.textMuted }}>
                        {hasStock ? `còn ${location.available_quantity}` : 'hết sách'}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            )}
          </View>

          {book.description ? (
            <View style={{ gap: space.md }}>
              <SectionHeader title="Giới thiệu" />
              <Text style={[type.body, { lineHeight: 25 }]}>{book.description}</Text>
            </View>
          ) : null}

          <Card>
            <InfoRow label="Tác giả" value={book.author ?? '—'} />
            <InfoRow label="Thể loại" value={book.category ?? '—'} />
            <InfoRow label="Nhà xuất bản" value={book.publisher ?? '—'} />
            {book.publish_year ? <InfoRow label="Năm xuất bản" value={String(book.publish_year)} /> : null}
            <InfoRow label="ISBN" value={book.isbn ?? '—'} mono />
            <InfoRow label="Còn lại" value={<StatusBadge tone={outOfStock ? 'neutral' : 'success'} label={`${book.available_quantity} cuốn`} icon={outOfStock ? null : 'checkmark-circle'} />} />
          </Card>

          <BookReviews bookId={book.id} />
        </View>
      </Screen>
    </>
  );
}
