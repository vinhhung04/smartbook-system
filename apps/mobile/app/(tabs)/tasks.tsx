import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Alert, RefreshControl, SectionList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TaskCard } from '../../src/components/TaskCard';
import { useDashboardTasks, type TaskEntry } from '../../src/hooks/useDashboardTasks';
import { normalizeSearchText } from '../../src/lib/optionSearch';
import { TASK_TYPE_LABEL, type TaskPhase } from '../../src/lib/taskRoutes';
import { EmptyState, FilterChips, InlineAlert, PageTitle, SearchField, Skeleton, radii, space, useTheme } from '../../src/design-system';

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
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md }}>
        <PageTitle
          title="Việc của tôi"
          subtitle={`${data.counts.todo} cần làm, ${data.counts.in_progress} đang làm, ${data.counts.waiting} chờ duyệt`}
        />
        <SearchField value={query} onChangeText={setQuery} placeholder="Mã phiếu, kho, loại việc" autoCapitalize="none" accessibilityLabel="Tìm công việc" />
        <FilterChips
          accessibilityLabel="Lọc theo trạng thái"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((item) => ({ value: item.key, label: item.label, count: countFor(item.key) }))}
        />
        {error ? <InlineAlert message={error} actionLabel="Thử lại" onAction={() => void refetch()} /> : null}
        {data.warnings.map((warning) => <InlineAlert key={warning} tone="warning" message={warning} />)}
      </View>

      {isLoading && data.entries.length === 0 ? (
        <View style={{ paddingHorizontal: space.lg, gap: space.md }} accessibilityLabel="Đang tải công việc">
          {[0, 1, 2].map((i) => <Skeleton key={i} height={150} radius={radii.md} />)}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refetch} tintColor={colors.primary} colors={[colors.primary]} />}
          renderSectionHeader={({ section }) =>
            filter === 'open' ? (
              <Text style={[type.heading, { marginTop: space.lg, marginBottom: space.sm }]} accessibilityRole="header">
                {section.title} ({section.data.length})
              </Text>
            ) : null
          }
          ListEmptyComponent={
            error ? undefined : (
              <EmptyState
                icon={query ? 'search-outline' : 'checkmark-done-outline'}
                title={query ? 'Không có việc nào khớp từ khóa' : EMPTY_TEXT[filter]}
                actionLabel={query ? 'Xóa tìm kiếm' : undefined}
                onAction={query ? () => setQuery('') : undefined}
              />
            )
          }
          renderItem={({ item }) => <TaskCard entry={item} onOpen={handleOpen} />}
          ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        />
      )}
    </View>
  );
}
