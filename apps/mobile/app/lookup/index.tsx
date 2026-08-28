import { useState } from 'react';
import { Stack } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import * as catalogApi from '../../src/api/catalog';
import { ApiError } from '../../src/auth/auth-context';
import { notifyScanError, notifyScanSuccess } from '../../src/scanner/haptics';
import { ScanField } from '../../src/scanner/ScanField';
import type { BookSummary } from '../../src/types/catalog';
import { colors, radius, shadow, spacing, typography } from '../../src/theme/tokens';

export default function QuickLookupScreen() {
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
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Tra cứu nhanh' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <ScanField
          value={code}
          onChangeText={setCode}
          onSubmit={handleSubmit}
          placeholder="Quét hoặc nhập ISBN/barcode/SKU"
          autoFocus
        />

        {isLoading ? <ActivityIndicator style={styles.spinner} color={colors.primary} /> : null}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        {book ? (
          <View style={styles.card}>
            <Text style={styles.title}>{book.title}</Text>
            {book.subtitle ? <Text style={styles.subtitle}>{book.subtitle}</Text> : null}
            <View style={styles.metaList}>
              <Text style={styles.meta}>Tác giả: {book.author}</Text>
              <Text style={styles.meta}>NXB: {book.publisher}</Text>
              <Text style={styles.meta}>Danh mục: {book.category}</Text>
              <Text style={styles.meta}>ISBN/Mã: {book.isbn}</Text>
            </View>

            <View style={styles.stockRow}>
              <View style={styles.stockBox}>
                <Text style={styles.stockNumber}>{book.quantity}</Text>
                <Text style={styles.stockLabel}>Tổng tồn</Text>
              </View>
              <View style={[styles.stockBox, styles.stockBoxSuccess]}>
                <Text style={[styles.stockNumber, styles.stockNumberSuccess]}>{book.available_quantity}</Text>
                <Text style={styles.stockLabel}>Có thể lấy</Text>
              </View>
              <View style={[styles.stockBox, styles.stockBoxWarning]}>
                <Text style={[styles.stockNumber, styles.stockNumberWarning]}>{book.receiving_quantity}</Text>
                <Text style={styles.stockLabel}>Chờ nhập kho</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Vị trí lưu trữ ({book.location_count})</Text>
            {book.locations.length === 0 ? (
              <Text style={styles.meta}>Không còn tồn kho ở vị trí nào.</Text>
            ) : (
              <View style={styles.locationList}>
                {book.locations.map((loc) => (
                  <View key={`${loc.warehouse_id}-${loc.location_id}`} style={styles.locationRow}>
                    <Text style={styles.locationLabel}>{loc.label}</Text>
                    <Text style={styles.locationQty}>{loc.quantity}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  spinner: {
    marginTop: spacing.sm,
  },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  title: {
    ...typography.h2,
  },
  subtitle: {
    ...typography.caption,
    marginTop: 2,
  },
  metaList: {
    marginTop: spacing.sm,
    gap: 2,
  },
  meta: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  stockRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  stockBox: {
    flex: 1,
    backgroundColor: colors.neutralSoft,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  stockBoxSuccess: {
    backgroundColor: colors.successSoft,
  },
  stockBoxWarning: {
    backgroundColor: colors.warningSoft,
  },
  stockNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  stockNumberSuccess: {
    color: colors.success,
  },
  stockNumberWarning: {
    color: colors.warning,
  },
  stockLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sectionTitle: {
    ...typography.label,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  locationList: {
    gap: 0,
  },
  locationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  locationLabel: {
    flex: 1,
    marginRight: spacing.sm,
    color: colors.textPrimary,
  },
  locationQty: {
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
