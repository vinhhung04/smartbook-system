import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import * as catalogApi from '../api/catalog';
import { ApiError } from '../auth/auth-context';
import { notifyScanError, notifyScanSuccess } from '../scanner/haptics';
import { ScanField } from '../scanner/ScanField';
import type { BookSummary } from '../types/catalog';
import { Card, EmptyState, InfoRow, InlineAlert, LoadingState, SectionHeader, fontFamily, radii, space, useTheme } from '../design-system';

function Stock({ label, value, tone }: { label: string; value: number; tone: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, padding: space.md, gap: 2, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={{ fontFamily: fontFamily.bold, fontSize: 26, color: tone, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ fontFamily: fontFamily.medium, fontSize: 12.5, color: colors.textSecondary }}>{label}</Text>
    </View>
  );
}

/**
 * Scan-to-lookup body, shared by app/lookup/index.tsx (pushed to from the
 * Home dashboard, wrapped in its own Stack.Screen header) and the "Quét"
 * tab (rendered directly as a tab root, no Stack.Screen needed there).
 */
export function QuickLookupPanel() {
  const { colors, type } = useTheme();
  const [code, setCode] = useState('');
  const [book, setBook] = useState<BookSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(value: string) {
    const barcode = value.trim();
    if (!barcode) return;

    setIsLoading(true);
    setError(null);
    setBook(null);
    try {
      const resolved = await catalogApi.findByBarcode(barcode);
      const detail = await catalogApi.getBookById(resolved.book_id);
      notifyScanSuccess();
      setBook(detail);
    } catch (err) {
      notifyScanError();
      setError(err instanceof ApiError ? err.message : 'Không tra được mã này');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <ScanField
        value={code}
        onChangeText={setCode}
        onSubmit={handleSubmit}
        placeholder="Quét hoặc nhập ISBN, barcode, SKU"
        autoFocus
      />

      {isLoading ? <LoadingState label="Đang tra cứu mã…" /> : null}
      {error ? <InlineAlert title="Không tra được mã này" message={error} /> : null}

      {!book && !isLoading && !error ? (
        <EmptyState icon="scan-outline" title="Quét một mã để bắt đầu" message="Dùng máy quét cầm tay, camera, hoặc gõ mã rồi nhấn Xong." compact />
      ) : null}

      {book ? (
        <View style={{ gap: space.lg }}>
          <View style={{ gap: 2 }}>
            <Text style={type.title} accessibilityRole="header">{book.title}</Text>
            {book.subtitle ? <Text style={type.caption}>{book.subtitle}</Text> : null}
          </View>

          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Stock label="Tổng tồn" value={book.quantity} tone={colors.textPrimary} />
            <Stock label="Có thể lấy" value={book.available_quantity} tone={colors.success} />
            <Stock label="Chờ nhập kho" value={book.receiving_quantity} tone={colors.warning} />
          </View>

          <View style={{ gap: space.md }}>
            <SectionHeader title={`Vị trí lưu trữ (${book.location_count})`} />
            {book.locations.length === 0 ? (
              <Text style={type.caption}>Không còn tồn kho ở vị trí nào.</Text>
            ) : (
              <Card padded={false}>
                {book.locations.map((loc, index) => (
                  <View
                    key={`${loc.warehouse_id}-${loc.location_id}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 52, borderTopWidth: index > 0 ? 1 : 0, borderTopColor: colors.border }}
                  >
                    <Text selectable style={{ flex: 1, fontFamily: fontFamily.monoBold, fontSize: 15, color: colors.textPrimary }}>{loc.label}</Text>
                    <Text style={{ fontFamily: fontFamily.bold, fontSize: 16, color: colors.textPrimary, fontVariant: ['tabular-nums'] }}>{loc.quantity}</Text>
                  </View>
                ))}
              </Card>
            )}
          </View>

          <Card>
            <InfoRow label="Tác giả" value={book.author ?? '—'} />
            <InfoRow label="Nhà xuất bản" value={book.publisher ?? '—'} />
            <InfoRow label="Danh mục" value={book.category ?? '—'} />
            <InfoRow label="ISBN / mã" value={book.isbn ?? '—'} mono />
          </Card>
        </View>
      ) : null}
    </ScrollView>
  );
}
