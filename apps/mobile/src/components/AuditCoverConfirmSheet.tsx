import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AuditCoverMatch } from '../lib/auditCoverMatch';
import { colors, fonts, radius, spacing, typography } from '../theme/tokens';

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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleDismiss} statusBarTranslucent>
      <View style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={handleDismiss} accessibilityLabel="Bỏ qua kết quả nhận diện" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">Xác nhận sách vừa chụp</Text>
          <Text style={styles.subtitle}>
            AI chỉ gợi ý. Chọn đúng sách và vị trí bạn đang đếm — số lượng chỉ tăng sau khi bạn xác nhận.
          </Text>
          {photoTitle ? <Text style={styles.ocr} numberOfLines={2}>Chữ đọc được trên bìa: {photoTitle}</Text> : null}

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {matches.map((match) => {
              const isSelected = match.line.id === selectedId;
              const percent = Math.round(match.confidence * 100);
              return (
                <Pressable
                  key={match.line.id}
                  style={[styles.option, isSelected && styles.optionSelected]}
                  onPress={() => {
                    setSelectedId(match.line.id);
                    setCheckedLowConfidence(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${match.line.title ?? match.candidateTitle}, vị trí ${match.line.location_code ?? 'không rõ'}, độ tin cậy ${percent} phần trăm`}
                >
                  <View style={styles.optionHeader}>
                    <Ionicons name={isSelected ? 'radio-button-on' : 'radio-button-off'} size={20} color={isSelected ? colors.primary : colors.textMuted} />
                    <Text style={styles.optionTitle} numberOfLines={2}>{match.line.title ?? match.candidateTitle}</Text>
                  </View>
                  <Text style={styles.meta}>ISBN: {match.line.isbn13 ?? match.line.isbn10 ?? '—'}</Text>
                  <Text style={styles.meta}>
                    Vị trí: {match.line.location_code ?? '—'} · Đã đếm: {match.line.counted_qty ?? 0} · Hệ thống: {match.line.expected_qty}
                  </Text>
                  <View style={[styles.confidence, match.lowConfidence ? styles.confidenceLow : styles.confidenceOk]}>
                    <Ionicons name={match.lowConfidence ? 'warning' : 'checkmark-circle'} size={14} color={match.lowConfidence ? colors.warning : colors.success} />
                    <Text style={[styles.confidenceText, { color: match.lowConfidence ? colors.warning : colors.success }]}>
                      Độ tin cậy {percent}%{match.lowConfidence ? ' — thấp, cần kiểm tra thủ công' : ''}
                    </Text>
                  </View>
                  {match.evidence.length > 0 ? <Text style={styles.evidence}>{match.evidence.join(' · ')}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          {selected?.lowConfidence ? (
            <Pressable
              style={styles.checkRow}
              onPress={() => setCheckedLowConfidence((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: checkedLowConfidence }}
            >
              <Ionicons name={checkedLowConfidence ? 'checkbox' : 'square-outline'} size={22} color={colors.warning} />
              <Text style={styles.checkText}>Tôi đã đối chiếu tên sách và ISBN trên sách thật</Text>
            </Pressable>
          ) : null}

          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.secondary]} onPress={handleDismiss} accessibilityRole="button">
              <Text style={styles.secondaryText}>Không đúng sách</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.primary, (!selected || needsManualCheck || saving) && styles.disabled]}
              onPress={handleConfirm}
              disabled={!selected || needsManualCheck || saving}
              accessibilityRole="button"
              accessibilityState={{ disabled: !selected || needsManualCheck || saving }}
            >
              <Text style={styles.primaryText}>{saving ? 'Đang lưu…' : 'Xác nhận +1'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(16,20,17,0.45)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  title: { ...typography.h3 },
  subtitle: { ...typography.caption },
  ocr: { ...typography.caption, fontStyle: 'italic' },
  list: { flexGrow: 0 },
  listContent: { gap: spacing.sm, paddingVertical: spacing.xs },
  option: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionTitle: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.textPrimary },
  meta: { ...typography.caption, marginLeft: 28 },
  confidence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginLeft: 28,
    marginTop: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  confidenceOk: { backgroundColor: colors.successSoft },
  confidenceLow: { backgroundColor: colors.warningSoft },
  confidenceText: { fontFamily: fonts.bodySemibold, fontSize: 12 },
  evidence: { ...typography.caption, fontSize: 12, marginLeft: 28, color: colors.textMuted },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  checkText: { flex: 1, fontFamily: fonts.bodyMedium, color: colors.textPrimary },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  button: { flex: 1, minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  secondary: { borderWidth: 1.5, borderColor: colors.border },
  secondaryText: { fontFamily: fonts.bodySemibold, color: colors.textSecondary },
  primary: { backgroundColor: colors.primary },
  primaryText: { fontFamily: fonts.bodySemibold, color: colors.onPrimary },
  disabled: { opacity: 0.45 },
});
