import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AuditCoverMatch } from '../lib/auditCoverMatch';
import { Button, StatusBadge, fontFamily, radii, space, useTheme } from '../design-system';

type Props = {
  visible: boolean;
  matches: AuditCoverMatch[];
  photoTitle: string | null;
  saving: boolean;
  onConfirm: (match: AuditCoverMatch) => void;
  onDismiss: () => void;
};

/**
 * The AI only proposes; the counter decides. Nothing is counted until a specific line
 * (book + shelf location) is tapped and then confirmed — a low-confidence guess takes an
 * extra, explicit "Tôi đã kiểm tra" step instead of a single tap.
 */
export function AuditCoverConfirmSheet({ visible, matches, photoTitle, saving, onConfirm, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedLowConfidence, setCheckedLowConfidence] = useState(false);

  const selected = matches.find((match) => match.line.id === selectedId) ?? null;
  const needsManualCheck = Boolean(selected?.lowConfidence) && !checkedLowConfidence;

  function reset() {
    setSelectedId(null);
    setCheckedLowConfidence(false);
  }

  function handleDismiss() {
    reset();
    onDismiss();
  }

  function handleConfirm() {
    if (!selected || needsManualCheck || saving) return;
    onConfirm(selected);
    reset();
  }

  const blocked = !selected || needsManualCheck || saving;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleDismiss} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={handleDismiss} accessibilityRole="button" accessibilityLabel="Bỏ qua kết quả nhận diện" />
        <View
          style={{
            maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, borderCurve: 'continuous',
            paddingTop: space.sm, paddingHorizontal: space.lg, paddingBottom: Math.max(insets.bottom, space.lg), gap: space.md,
          }}
          accessibilityViewIsModal
        >
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong }} />
          <View style={{ gap: space.xs }}>
            <Text style={[type.title, { fontSize: 20 }]} accessibilityRole="header">Xác nhận sách vừa chụp</Text>
            <Text style={type.caption}>
              AI chỉ gợi ý. Chọn đúng sách và vị trí bạn đang đếm — số lượng chỉ tăng sau khi bạn xác nhận.
            </Text>
          </View>
          {photoTitle ? (
            <Text style={{ fontFamily: fontFamily.mono, fontSize: 13, color: colors.textSecondary, padding: space.sm, borderRadius: radii.xs, backgroundColor: colors.surfaceRaised }} numberOfLines={2}>
              Chữ đọc được trên bìa: {photoTitle}
            </Text>
          ) : null}

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.sm }} accessibilityRole="radiogroup">
            {matches.map((match) => {
              const isSelected = match.line.id === selectedId;
              const percent = Math.round(match.confidence * 100);
              return (
                <Pressable
                  key={match.line.id}
                  style={({ pressed }) => ({
                    padding: space.md, gap: 6, borderRadius: radii.sm, borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? colors.primary : colors.border,
                    backgroundColor: isSelected ? colors.primarySoft : pressed ? colors.surfaceRaised : colors.surface,
                  })}
                  onPress={() => {
                    setSelectedId(match.line.id);
                    setCheckedLowConfidence(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${match.line.title ?? match.candidateTitle}, vị trí ${match.line.location_code ?? 'không rõ'}, độ tin cậy ${percent} phần trăm`}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
                    <Ionicons name={isSelected ? 'radio-button-on' : 'radio-button-off'} size={20} color={isSelected ? colors.primary : colors.textMuted} />
                    <Text style={{ flex: 1, fontFamily: fontFamily.semibold, fontSize: 15, lineHeight: 21, color: colors.textPrimary }} numberOfLines={2}>{match.line.title ?? match.candidateTitle}</Text>
                  </View>
                  <Text style={{ fontFamily: fontFamily.mono, fontSize: 13, color: colors.textSecondary }}>ISBN {match.line.isbn13 ?? match.line.isbn10 ?? '—'}</Text>
                  <Text style={type.caption}>
                    Vị trí <Text style={{ fontFamily: fontFamily.monoBold, color: colors.textPrimary }}>{match.line.location_code ?? '—'}</Text>, đã đếm {match.line.counted_qty ?? 0}, hệ thống {match.line.expected_qty}
                  </Text>
                  <View style={{ alignSelf: 'flex-start' }}>
                    <StatusBadge
                      tone={match.lowConfidence ? 'warning' : 'success'}
                      icon={match.lowConfidence ? 'warning' : 'checkmark-circle'}
                      label={`Độ tin cậy ${percent}%${match.lowConfidence ? ', cần kiểm tra thủ công' : ''}`}
                    />
                  </View>
                  {match.evidence.length > 0 ? <Text style={{ fontFamily: fontFamily.regular, fontSize: 12.5, color: colors.textMuted }}>{match.evidence.join(' · ')}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          {selected?.lowConfidence ? (
            <Pressable
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.md, borderRadius: radii.sm, backgroundColor: colors.warningSoft }}
              onPress={() => setCheckedLowConfidence((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: checkedLowConfidence }}
            >
              <Ionicons name={checkedLowConfidence ? 'checkbox' : 'square-outline'} size={22} color={colors.warning} />
              <Text style={{ flex: 1, fontFamily: fontFamily.medium, fontSize: 14.5, color: colors.textPrimary }}>Tôi đã đối chiếu tên sách và ISBN trên sách thật</Text>
            </Pressable>
          ) : null}

          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button label="Không đúng sách" variant="secondary" onPress={handleDismiss} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Xác nhận +1" icon="add-circle" loading={saving} loadingLabel="Đang lưu…" disabled={blocked} onPress={handleConfirm} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
