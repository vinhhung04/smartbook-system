import { StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';
import QRCode from 'react-native-qrcode-svg';

import { buildPickupQrValue } from '../../lib/pickupQr';
import { getReservationStatusDisplay } from '../../lib/reservationStatus';
import { colors, fonts, radius, shadow, spacing, typography } from '../../theme/customerTokens';
import { GlowBadge } from './GlowBadge';
import type { ReservationStatus } from '../../types/borrow';

type Props = {
  reservationNumber: string;
  pickupCode: string | null;
  status: ReservationStatus;
  expiresAt: string | null;
};

/**
 * Dark-glass counterpart to the staff app's paper PickupTicket. Deliberately
 * skips BlurView here (unlike the rest of the customer app) — this screen's
 * only job is "read the code correctly at a counter", so legibility beats
 * the glass effect. The QR itself keeps a light background with dark
 * modules even on this dark card — a dark-mode QR (light modules on dark)
 * is a common real-world scanning failure.
 */
export function CustomerPickupTicket({ reservationNumber, pickupCode, status, expiresAt }: Props) {
  const display = getReservationStatusDisplay(status);
  const qrValue = pickupCode ? buildPickupQrValue(pickupCode) : null;

  return (
    <MotiView
      from={{ opacity: 0, translateY: 10 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 300 }}
      style={styles.card}
    >
      <View style={styles.topEdge} />

      <Text style={styles.eyebrow}>PHIẾU NHẬN SÁCH · {reservationNumber}</Text>

      <View style={styles.badgeRow}>
        <GlowBadge text={display.label} tone={display.tone} />
      </View>

      {pickupCode ? (
        <>
          <Text style={styles.code}>{pickupCode}</Text>
          <View style={styles.qrWrap}>
            <QRCode value={qrValue ?? pickupCode} size={168} color="#1A1206" backgroundColor="#F5F3EF" />
          </View>
          {expiresAt ? (
            <Text style={styles.expiry}>Hạn nhận: {new Date(expiresAt).toLocaleString('vi-VN')}</Text>
          ) : null}
          <View style={styles.divider} />
          <Text style={styles.hint}>Đưa mã hoặc mã QR này cho nhân viên tại quầy để nhận sách.</Text>
        </>
      ) : (
        <Text style={styles.hint}>Mã nhận sách sẽ xuất hiện ở đây khi thư viện xác nhận phiếu đặt.</Text>
      )}
    </MotiView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    alignItems: 'center',
    overflow: 'hidden',
    ...shadow.card,
  },
  topEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.primary,
  },
  eyebrow: {
    ...typography.label,
    marginBottom: spacing.md,
  },
  badgeRow: {
    marginBottom: spacing.lg,
  },
  code: {
    fontFamily: fonts.monoSemibold,
    fontSize: 34,
    letterSpacing: 2,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  qrWrap: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#F5F3EF',
    marginBottom: spacing.md,
  },
  expiry: {
    ...typography.caption,
    marginBottom: spacing.lg,
  },
  divider: {
    width: '100%',
    borderStyle: 'dashed',
    borderTopWidth: 1.5,
    borderColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  hint: {
    ...typography.caption,
    textAlign: 'center',
  },
});
