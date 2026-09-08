import { StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';
import QRCode from 'react-native-qrcode-svg';

import { buildPickupQrValue } from '../lib/pickupQr';
import { getReservationStatusDisplay } from '../lib/reservationStatus';
import { colors, fonts, radius, shadow, spacing, typography } from '../theme/tokens';
import { StampBadge } from './StampBadge';
import type { ReservationStatus } from '../types/borrow';

const NOTCH_SIZE = 22;

type Props = {
  reservationNumber: string;
  pickupCode: string | null;
  status: ReservationStatus;
  expiresAt: string | null;
};

/**
 * The one moment a customer actually needs mobile for: proof of a hold at the
 * counter. Modeled as a perforated library ticket stub — two background-color
 * notches punched into the card edges plus a dashed tear line — rather than a
 * generic rounded card, to carry the same physical-library metaphor as
 * StampBadge/SpineChart into the customer side of the app.
 */
export function PickupTicket({ reservationNumber, pickupCode, status, expiresAt }: Props) {
  const display = getReservationStatusDisplay(status);
  const qrValue = pickupCode ? buildPickupQrValue(pickupCode) : null;

  return (
    <MotiView
      from={{ opacity: 0, translateY: 10 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 300 }}
      style={styles.card}
    >
      <View style={[styles.notch, styles.notchLeft]} />
      <View style={[styles.notch, styles.notchRight]} />

      <Text style={styles.eyebrow}>PHIẾU NHẬN SÁCH · {reservationNumber}</Text>

      <View style={styles.stampRow}>
        <StampBadge text={display.label} tone={display.tone} />
      </View>

      {pickupCode ? (
        <>
          <Text style={styles.code}>{pickupCode}</Text>
          <View style={styles.qrWrap}>
            <QRCode value={qrValue ?? pickupCode} size={168} color={colors.textPrimary} backgroundColor={colors.surface} />
          </View>
          {expiresAt ? (
            <Text style={styles.expiry}>Hạn nhận: {new Date(expiresAt).toLocaleString('vi-VN')}</Text>
          ) : null}
          <View style={styles.tearLine} />
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
    ...shadow.card,
    overflow: 'visible',
  },
  notch: {
    position: 'absolute',
    top: '50%',
    width: NOTCH_SIZE,
    height: NOTCH_SIZE,
    borderRadius: NOTCH_SIZE / 2,
    backgroundColor: colors.bg,
    marginTop: -NOTCH_SIZE / 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notchLeft: {
    left: -NOTCH_SIZE / 2,
  },
  notchRight: {
    right: -NOTCH_SIZE / 2,
  },
  eyebrow: {
    ...typography.label,
    marginBottom: spacing.md,
  },
  stampRow: {
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  expiry: {
    ...typography.caption,
    marginBottom: spacing.lg,
  },
  tearLine: {
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
