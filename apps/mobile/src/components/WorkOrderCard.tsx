import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, PressableScale, fontFamily, radii, space, useTheme } from '../design-system';

type Props = {
  /** The document code workers read off the slip (order, receipt, transfer). */
  code: string;
  detail?: string | null;
  badges?: ReactNode;
  onOpen: () => void;
  accessibilityLabel: string;
  /** Verb shown before the chevron when tapping does more than open (e.g. "Nhận phiếu"). */
  cta?: string;
  /** The card's own press is in flight: spinner instead of chevron, presses ignored. */
  busy?: boolean;
  /** Manager-only side action (e.g. assign); a sibling of the card, never nested in it. */
  action?: { label: string; busyLabel?: string; busy?: boolean; onPress: () => void; accessibilityLabel: string } | null;
};

/**
 * One work document in a staff list: the code large in mono (it is matched
 * against paper), what it is and where under it, its state as badges, and a
 * chevron that says the whole card opens it.
 */
export function WorkOrderCard({ code, detail, badges, onOpen, accessibilityLabel, cta, busy = false, action }: Props) {
  const { colors, type } = useTheme();
  return (
    <View style={{ borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
      <PressableScale
        onPress={onOpen}
        disabled={busy}
        scale={false}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ busy, disabled: busy }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg }}
        pressedStyle={{ backgroundColor: colors.surfaceRaised }}
      >
        <View style={{ flex: 1, gap: space.sm }}>
          <Text style={{ fontFamily: fontFamily.monoBold, fontSize: 16, lineHeight: 21, color: colors.textPrimary }} numberOfLines={2}>{code}</Text>
          {detail ? <Text style={type.caption} numberOfLines={2}>{detail}</Text> : null}
          {badges ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{badges}</View> : null}
        </View>
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            {cta ? <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.primary }}>{cta}</Text> : null}
            <Ionicons name="chevron-forward" size={20} color={cta ? colors.primary : colors.textMuted} />
          </View>
        )}
      </PressableScale>
      {action ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <Button
            label={action.label}
            loadingLabel={action.busyLabel}
            loading={action.busy}
            icon="person-add-outline"
            variant="secondary"
            size="md"
            fullWidth={false}
            onPress={action.onPress}
            accessibilityLabel={action.accessibilityLabel}
          />
        </View>
      ) : null}
    </View>
  );
}
