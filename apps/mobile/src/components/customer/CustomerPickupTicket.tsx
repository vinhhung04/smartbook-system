import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { buildPickupQrValue } from '../../lib/pickupQr';
import { getReservationStatusDisplay } from '../../lib/reservationStatus';
import { StatusBadge, fontFamily, radii, space, useTheme } from '../../design-system';
import type { ReservationStatus } from '../../types/borrow';

type Props = {
  reservationNumber: string;
  pickupCode: string | null;
  status: ReservationStatus;
  expiresAt: string | null;
};

/**
 * The pickup ticket. Its only job is to be read correctly at a counter, so it
 * is plain: an ink header with the ticket number and status, then the code in
 * large mono type and the QR in pure black on pure white (the most reliable
 * pairing for counter scanners), no motion, no effects.
 */
export function CustomerPickupTicket({ reservationNumber, pickupCode, status, expiresAt }: Props) {
  const { colors, type } = useTheme();
  const display = getReservationStatusDisplay(status);
  const qrValue = pickupCode ? buildPickupQrValue(pickupCode) : null;

  return (
    <View style={{ borderRadius: radii.xl, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ backgroundColor: colors.inkField, paddingHorizontal: space.xl, paddingVertical: space.lg, gap: space.sm }}>
        <Text style={{ fontFamily: fontFamily.medium, fontSize: 13.5, color: colors.onInkMuted }}>Phiếu nhận sách</Text>
        <Text selectable style={{ fontFamily: fontFamily.monoBold, fontSize: 16, color: colors.onInk, letterSpacing: 0.5 }}>{reservationNumber}</Text>
      </View>
      <View style={{ padding: space.xl, alignItems: 'center', gap: space.lg }}>
        <StatusBadge tone={display.tone} label={display.label} />
        {pickupCode ? (
          <>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Text style={type.caption}>Mã nhận sách</Text>
              <Text
                selectable
                style={{ fontFamily: fontFamily.monoBold, fontSize: 34, letterSpacing: 4, color: colors.textPrimary }}
                accessibilityLabel={`Mã nhận sách ${pickupCode.split('').join(' ')}`}
              >
                {pickupCode}
              </Text>
            </View>
            <View style={{ padding: space.md, borderRadius: radii.md, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border }} accessible accessibilityLabel="Mã QR nhận sách">
              <QRCode value={qrValue ?? pickupCode} size={184} color="#000000" backgroundColor="#FFFFFF" />
            </View>
            {expiresAt ? (
              <Text style={[type.callout, { textAlign: 'center' }]}>
                Nhận trước {new Date(expiresAt).toLocaleString('vi-VN')}
              </Text>
            ) : null}
            <Text style={[type.caption, { textAlign: 'center' }]}>Đưa mã hoặc mã QR này cho nhân viên tại quầy để nhận sách.</Text>
          </>
        ) : (
          <Text style={[type.caption, { textAlign: 'center' }]}>Mã nhận sách sẽ xuất hiện ở đây khi thư viện xác nhận phiếu đặt.</Text>
        )}
      </View>
    </View>
  );
}
