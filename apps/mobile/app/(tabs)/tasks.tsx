import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { TaskCard } from '../../src/components/TaskCard';
import { useDashboardTasks, type TaskEntry } from '../../src/hooks/useDashboardTasks';
import { normalizeSearchText } from '../../src/lib/optionSearch';
import { TASK_TYPE_LABEL, type TaskPhase } from '../../src/lib/taskRoutes';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';

type Filter = 'open' | TaskPhase;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Đang mở' },
  { key: 'todo', label: 'Cần làm' },
  { key: 'in_progress', label: 'Đang làm' },
  { key: 'done', label: 'Đã xong' },
];

const SECTION_TITLE: Record<TaskPhase, string> = {
  in_progress: 'Đang thực hiện',
  todo: 'Cần làm',
  waiting: 'Chờ quản lý xử lý',
  done: 'Hoàn thành gần đây',
};

const EMPTY_TEXT: Record<Filter, string> = {
  open: 'Không còn việc nào đang mở. Kéo xuống để làm mới.',
  todo: 'Không có việc mới cần làm.',
  in_progress: 'Không có việc nào đang dở dang.',
  waiting: 'Không có yêu cầu nào đang chờ duyệt.',
  done: 'Chưa có việc nào hoàn thành gần đây.',
};

function matchesQuery(entry: TaskEntry, query: string): boolean {
  if (!query) return true;
  const haystack = normalizeSearchText(
    [entry.task.title, entry.task.warehouse, TASK_TYPE_LABEL[entry.task.type], entry.statusLabel, entry.task.description].filter(Boolean).join(' '),
  );
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export default function TasksScreen() {
  const { data, isLoading, isRefreshing, error, refetch } = useDashboardTasks();
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const phases: TaskPhase[] = filter === 'open' ? ['in_progress', 'todo', 'waiting'] : [filter];
    return phases
      .map((phase) => ({
        phase,
        title: SECTION_TITLE[phase],
        data: data.entries.filter((entry) => entry.phase === phase && matchesQuery(entry, query)),
      }))
      .filter((section) => section.data.length > 0);
  }, [data.entries, filter, query]);

  function handleOpen(entry: TaskEntry) {
    if (entry.route.kind === 'screen') {
      router.push(entry.route.href as never);
      return;
    }
    Alert.alert(entry.task.title, entry.route.reason);
  }

  const countFor = (key: Filter) => (key === 'open' ? data.counts.todo + data.counts.in_progress + data.counts.waiting : data.counts[key]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Việc của tôi</Text>
        <Text style={styles.subtitle}>
          {data.counts.todo} cần làm · {data.counts.in_progress} đang làm · {data.counts.waiting} chờ duyệt · {data.counts.done} xong gần đây
        </Text>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Tìm mã phiếu, kho, loại việc"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Tìm công việc"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Xóa tìm kiếm">
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.filters} accessibilityRole="tablist">
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <Pressable
                key={item.key}
                style={[styles.filter, active && styles.filterActive]}
                onPress={() => setFilter(item.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.filterText, active && styles.filterTextActive]} numberOfLines={1}>
                  {item.label} {countFor(item.key)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => void refetch()} style={styles.retry} accessibilityRole="button">
            <Text style={styles.retryText}>Thử lại</Text>
          </Pressable>
        </View>
      ) : null}
      {data.warnings.map((warning) => (
        <Text key={warning} style={styles.warning}>{warning}</Text>
      ))}

      {isLoading && data.entries.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refetch} tintColor={colors.primary} colors={[colors.primary]} />}
          renderSectionHeader={({ section }) =>
            filter === 'open' ? <Text style={styles.sectionTitle}>{section.title} ({section.data.length})</Text> : null
          }
          ListEmptyComponent={
            error ? null : (
              <View style={styles.empty}>
                <Ionicons name={query ? 'search-outline' : 'checkmark-done-outline'} size={28} color={colors.textMuted} />
                <Text style={styles.emptyText}>{query ? 'Không có việc nào khớp từ khóa.' : EMPTY_TEXT[filter]}</Text>
              </View>
            )
          }
          renderItem={({ item }) => <TaskCard entry={item} onOpen={handleOpen} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: {
    ...typography.h2,
  },
  subtitle: {
    ...typography.caption,
    marginTop: -spacing.xs,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  search: {
    flex: 1,
    minHeight: 44,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textPrimary,
  },
  filters: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  filter: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 4,
  },
  filterActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    color: colors.textSecondary,
  },
  filterTextActive: {
    color: colors.onPrimary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  error: {
    flex: 1,
    color: colors.danger,
    fontSize: 13,
  },
  retry: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  retryText: {
    color: colors.danger,
    fontFamily: fonts.bodySemibold,
  },
  warning: {
    ...typography.caption,
    color: colors.warning,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
  },
  sectionTitle: {
    ...typography.label,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  separator: {
    height: spacing.sm,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.caption,
    textAlign: 'center',
  },
});
