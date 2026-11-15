import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarClock, CheckCircle2, Keyboard, Loader2, Plus, RefreshCw, ScanLine, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
import { FilterBar, EmptyState, ConfirmDialog } from '@/components/ui';
import { Button, IconButton } from '@/components/ui/button';
import { RowsSkeleton } from '@/components/ops/ops-kit';
import { warehouseService } from '@/services/warehouse';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { StatusBadge } from '@/components/status-badge';
import { getBorrowLabel, getStatusVariant } from '@/lib/status-registry';
import { BarcodeScanModal } from '@/components/barcode-scan-modal';
import { borrowService, type Reservation, type ReservationStatus } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { type StageTab } from './borrow-shared/stage-tabs';
import { ListFooter } from './borrow-shared/list-footer';
import { BorrowFormDialog, type BorrowFormMode } from './borrow-shared/borrow-form-dialog';
import { sumCounts, useServerList } from './borrow-shared/use-server-list';
import { useBookTitles } from './borrow-shared/use-book-titles';

const PAGE_SIZE = 15;

// The reservation pipeline as staff work it: confirm -> prepare the book -> customer picks up.
// Finished reservations (lent, expired, cancelled) share one tab.
const TABS = [
  { key: 'all', label: 'Tất cả', statuses: [] },
  { key: 'pending', label: 'Cần xác nhận', statuses: ['PENDING'], step: true, attention: true },
  { key: 'confirmed', label: 'Chuẩn bị sách', statuses: ['CONFIRMED'], step: true, attention: true },
  { key: 'ready', label: 'Chờ khách lấy', statuses: ['READY_FOR_PICKUP'], step: true },
  { key: 'done', label: 'Đã xong', statuses: ['CONVERTED_TO_LOAN', 'EXPIRED', 'CANCELLED'], separated: true },
] as const satisfies readonly { key: string; label: string; statuses: readonly ReservationStatus[]; step?: boolean; attention?: boolean; separated?: boolean }[];

type TabKey = (typeof TABS)[number]['key'];

const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'];

const NEXT_STEP_HINT: Partial<Record<ReservationStatus, string>> = {
  PENDING: 'Kiểm tra rồi xác nhận giữ sách',
  CONFIRMED: 'Lấy sách ra quầy rồi báo sẵn sàng',
  READY_FOR_PICKUP: 'Khách đọc mã này ở quầy nhận sách',
};

/** How long a live reservation has left, so staff can see what is about to lapse without reading timestamps. */
function expiryInfo(reservation: Reservation): { text: string; tone: 'danger' | 'warning' | 'muted' } | null {
  if (!ACTIVE_RESERVATION_STATUSES.includes(reservation.status)) return null;
  const remaining = new Date(reservation.expires_at).getTime() - Date.now();
  if (Number.isNaN(remaining)) return null;
  if (remaining <= 0) return { text: 'Đã quá hạn', tone: 'danger' };
  const minutes = Math.round(remaining / 60000);
  if (minutes < 60) return { text: `Còn ${Math.max(1, minutes)} phút`, tone: 'warning' };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { text: `Còn ${hours} giờ`, tone: 'warning' };
  return { text: `Còn ${Math.floor(hours / 24)} ngày`, tone: 'muted' };
}

const EXPIRY_TONE_CLASS = {
  danger: 'font-semibold text-red-700 dark:text-red-400',
  warning: 'font-semibold text-amber-700 dark:text-amber-300',
  muted: 'text-foreground',
} as const;

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value);
}

export function BorrowReservationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabKey = isTabKey(tabParam) ? tabParam : 'all';
  const activeTab = TABS.find((item) => item.key === tab) ?? TABS[0];

  const list = useServerList(borrowService.getReservations, {
    pageSize: PAGE_SIZE,
    errorMessage: 'Không tải được danh sách đặt trước',
    params: {
      ...(activeTab.statuses.length ? { status: activeTab.statuses.join(',') } : {}),
      // Working stages: what lapses first comes first. Otherwise newest first.
      ...(activeTab.key !== 'all' && activeTab.key !== 'done' ? { sort: 'expires_at' } : {}),
    },
  });
  const bookTitle = useBookTitles();

  const [formMode, setFormMode] = useState<BorrowFormMode | null>(null);
  const [pickupCode, setPickupCode] = useState('');
  const [pickupConverting, setPickupConverting] = useState(false);
  const [pickupScannerOpen, setPickupScannerOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Reservation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = list.meta.status_counts;
  const tabs: StageTab<TabKey>[] = TABS.map((item) => ({
    key: item.key,
    label: item.label,
    count: item.statuses.length ? sumCounts(counts, item.statuses) : sumCounts(counts, Object.keys(counts ?? {})),
    step: 'step' in item ? item.step : undefined,
    attention: 'attention' in item ? item.attention : undefined,
    separated: 'separated' in item ? item.separated : undefined,
  }));

  const selectTab = (key: TabKey) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (key === 'all') next.delete('tab'); else next.set('tab', key);
      return next;
    }, { replace: true });
  };

  const convertPickupCode = async (code = pickupCode) => {
    const value = String(code || '').trim();
    if (!value) {
      toast.error('Vui lòng nhập mã nhận sách');
      return;
    }
    try {
      setPickupConverting(true);
      const response = await borrowService.convertPickupCodeToLoan(value);
      toast.success(`Đã tạo phiếu mượn ${response.data.loan_number} từ mã nhận sách`);
      setPickupCode('');
      await list.reload();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Chuyển đổi mã nhận sách thất bại'));
    } finally {
      setPickupConverting(false);
    }
  };

  const confirmReservation = async (id: string, status: 'CONFIRMED' | 'READY_FOR_PICKUP' = 'CONFIRMED') => {
    setBusyId(id);
    try {
      await borrowService.confirmReservation(id, { status });
      toast.success(status === 'READY_FOR_PICKUP' ? 'Đặt trước sẵn sàng lấy sách' : 'Đã xác nhận đặt trước');
      await list.reload();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Xác nhận đặt trước thất bại'));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmCancelReservation = async () => {
    if (!cancelTarget) return;
    try {
      await borrowService.cancelReservation(cancelTarget.id);
      toast.success('Đã hủy đặt trước');
      setCancelTarget(null);
      await list.reload();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Hủy đặt trước thất bại'));
    }
  };

  const releaseExpiredReservations = async () => {
    try {
      const response = await borrowService.runExpiredReservationSweep();
      toast.success(`Đã giải phóng ${response.data.expired} đặt trước hết hạn`);
      await list.reload();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Giải phóng đặt trước hết hạn thất bại'));
    }
  };

  // Where the customer collects the book: a read-only lookup, the same list the warehouse pages load.
  const [branchNames, setBranchNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let active = true;
    warehouseService.getAll()
      .then((rows) => { if (active) setBranchNames(new Map((Array.isArray(rows) ? rows : []).map((w) => [w.id, w.name || w.code]))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const vn = (value: number) => value.toLocaleString('vi-VN');
  const working = [
    counts?.PENDING ? `${vn(counts.PENDING)} cần xác nhận` : null,
    counts?.CONFIRMED ? `${vn(counts.CONFIRMED)} đang chuẩn bị sách` : null,
    counts?.READY_FOR_PICKUP ? `${vn(counts.READY_FOR_PICKUP)} chờ khách lấy` : null,
  ].filter(Boolean);
  const lede = !counts
    ? 'Xác nhận, chuẩn bị sách và giao cho khách tại quầy.'
    : `${working.length ? `${working.join(', ')}.` : 'Không có đặt trước nào đang chờ xử lý.'} ${vn(counts.CONVERTED_TO_LOAN ?? 0)} đã thành phiếu mượn, ${vn(counts.EXPIRED ?? 0)} hết hạn, ${vn(counts.CANCELLED ?? 0)} đã hủy.`;
  const railButton = (item: StageTab<TabKey>, index: number | null) => {
    const active = tab === item.key;
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => selectTab(item.key)}
        aria-pressed={active}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          active ? 'bg-primary/[0.08] text-primary' : 'text-foreground hover:bg-muted/60',
        )}
      >
        {index !== null ? (
          <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')} aria-hidden="true">{index}</span>
        ) : null}
        <span className={cn('min-w-0 flex-1 truncate text-[13px]', active ? 'font-semibold' : 'font-medium')}>{item.label}</span>
        <span
          className={cn(
            'min-w-6 shrink-0 rounded-full px-1.5 text-center text-[12px] tabular-nums',
            item.attention && item.count > 0 ? 'bg-amber-100 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' : active ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {!counts ? '–' : vn(item.count)}
        </span>
      </button>
    );
  };
  const stepTabs = tabs.filter((item) => item.step);

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={CalendarClock}
          title="Đặt trước sách"
          description={lede}
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={() => void releaseExpiredReservations()} className="gap-2" title="Chuyển các đặt trước quá hạn nhận sang Hết hạn và trả sách về kho">
                <RefreshCw className="h-4 w-4" />
                Giải phóng hết hạn
              </Button>
              <Button size="sm" variant="outline" onClick={() => setFormMode('DIRECT_LOAN')} className="gap-2">
                <Plus className="h-4 w-4" />
                Mượn trực tiếp
              </Button>
              <Button size="sm" onClick={() => setFormMode('RESERVATION')} className="gap-2">
                <Plus className="h-4 w-4" />
                Đặt trước mới
              </Button>
            </>
          }
        />
      </FadeItem>

      {/* The counter: the one thing staff do with a customer standing in front of them. */}
      <FadeItem>
        <section aria-labelledby="pickup-counter-title" className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
            <div className="lg:w-72 lg:shrink-0">
              <h2 id="pickup-counter-title" className="font-display text-[18px] font-semibold tracking-tight">Quầy nhận sách</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Khách đưa mã nhận sách hoặc mã QR, hệ thống lập phiếu mượn ngay.</p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-card px-3 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                <Keyboard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">Mã nhận sách / Kết quả QR</span>
                <input
                  value={pickupCode}
                  onChange={(event) => setPickupCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void convertPickupCode();
                    }
                  }}
                  placeholder="PU-ABCD-1234 hoặc SMARTBOOK:PICKUP:..."
                  data-testid="pickup-code-input"
                  className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[14px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground"
                />
              </label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setPickupScannerOpen(true)} className="gap-2">
                  <ScanLine className="h-4 w-4" />
                  Quét QR
                </Button>
                <Button type="button" disabled={pickupConverting} onClick={() => void convertPickupCode()} data-testid="convert-pickup-submit" className="flex-1 gap-2 sm:flex-none">
                  {pickupConverting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Chuyển thành phiếu mượn
                </Button>
              </div>
            </div>
          </div>
        </section>
      </FadeItem>

      <FadeItem>
        {/* Named so the toolbar inside the list (its own container) can still ask whether the rail is showing. */}
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[232px_minmax(0,1fr)]">
            <nav aria-label="Lọc theo giai đoạn" className="hidden rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
              {railButton(tabs[0], null)}
              <p className="mt-3 px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Quy trình tại quầy</p>
              {stepTabs.map((item, index) => railButton(item, index + 1))}
              <div className="mt-3 border-t border-border pt-3">
                {tabs.filter((item) => item.separated).map((item) => railButton(item, null))}
              </div>
            </nav>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] @4xl/page:hidden" role="group" aria-label="Lọc theo giai đoạn">
              {tabs.map((item) => {
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => selectTab(item.key)}
                    aria-pressed={active}
                    className={cn(
                      'flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      active ? 'border-primary/30 bg-primary/[0.08] font-semibold text-primary' : 'border-border bg-card font-medium hover:bg-muted/60',
                    )}
                  >
                    <span className="whitespace-nowrap">{item.label}</span>
                    <span className="tabular-nums text-muted-foreground">{!counts ? '–' : vn(item.count)}</span>
                  </button>
                );
              })}
            </div>

            <section aria-label="Danh sách đặt trước" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="px-5 pb-1 pt-4">
                <h2 className="font-display text-[18px] font-semibold tracking-tight">{activeTab.key === 'all' ? 'Tất cả đặt trước' : activeTab.label}</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {activeTab.key === 'all' || activeTab.key === 'done' ? 'Mới nhất ở trên.' : 'Sắp hết hạn giữ sách ở trên.'}
                  {activeTab.key === 'pending' || activeTab.key === 'confirmed' || activeTab.key === 'ready' ? ` ${NEXT_STEP_HINT[activeTab.statuses[0]] ?? ''}.` : ''}
                </p>
              </div>
              <div className="border-b border-border px-4 py-3">
                <FilterBar
                  searchValue={list.search}
                  onSearchChange={list.setSearch}
                  searchPlaceholder="Tìm đặt trước..."
                  showSearchClear
                />
              </div>

              {list.loading && list.rows.length === 0 ? (
                <RowsSkeleton rows={6} />
              ) : list.rows.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    variant={list.search ? 'no-results' : 'no-data'}
                    title={list.search ? 'Không tìm thấy đặt trước' : `Không có đặt trước nào ở mục "${activeTab.label}"`}
                    description={list.search ? 'Thử từ khóa khác hoặc chọn mục khác.' : 'Đặt trước mới của khách sẽ xuất hiện ở đây.'}
                    className="py-0"
                  />
                </div>
              ) : (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Đặt trước</TableHead>
                      <TableHead className="hidden w-[30%] text-[12px] font-normal text-muted-foreground @3xl:table-cell">Sách</TableHead>
                      <TableHead className="hidden w-[150px] text-[12px] font-normal text-muted-foreground @2xl:table-cell">Hạn giữ sách</TableHead>
                      <TableHead className="w-[164px] pr-5 text-right text-[12px] font-normal text-muted-foreground">Trạng thái</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.rows.map((reservation) => {
                      const expiry = expiryInfo(reservation);
                      const isLive = ACTIVE_RESERVATION_STATUSES.includes(reservation.status);
                      const code = reservation.status === 'READY_FOR_PICKUP' ? reservation.pickup_code || '-' : null;
                      const busy = busyId === reservation.id;
                      const branch = branchNames.get(reservation.warehouse_id);
                      const book = (
                        <>
                          <span className="line-clamp-2 text-[13px] text-foreground">{bookTitle(reservation.variant_id)}</span>
                          <span className="block text-[12px] text-muted-foreground">
                            {reservation.quantity} cuốn, {getBorrowLabel('sourceChannel', reservation.source_channel)}{branch ? `, nhận tại ${branch}` : ''}
                          </span>
                        </>
                      );
                      const expiryBlock = (
                        <>
                          {expiry ? <span className={cn('block text-[13px]', EXPIRY_TONE_CLASS[expiry.tone])}>{expiry.text}</span> : null}
                          <span className="block text-[12px] tabular-nums text-muted-foreground">{new Date(reservation.expires_at).toLocaleString('vi-VN')}</span>
                        </>
                      );
                      return (
                        <TableRow key={reservation.id} className={cn('hover:bg-muted/30', list.loading && 'opacity-60')}>
                          <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                            <span className="block text-[14px] font-semibold text-foreground">{reservation.customers?.full_name || 'Khách hàng'}</span>
                            <span className="block font-mono text-[12px] text-muted-foreground">{reservation.reservation_number}</span>
                            <span className="block text-[12px] tabular-nums text-muted-foreground">Đặt lúc {new Date(reservation.reserved_at).toLocaleString('vi-VN')}</span>
                            {/* Columns the container hides move here, so no field is dropped. */}
                            <span className="mt-1.5 block @3xl:hidden">{book}</span>
                            <span className="mt-1 block @2xl:hidden">{expiryBlock}</span>
                            {reservation.notes ? <span className="mt-1 line-clamp-2 block max-w-prose text-[12px] text-muted-foreground" title={reservation.notes}>Ghi chú: {reservation.notes}</span> : null}
                          </TableCell>
                          <TableCell className="hidden whitespace-normal py-3.5 align-top @3xl:table-cell">{book}</TableCell>
                          <TableCell className="hidden whitespace-normal py-3.5 align-top @2xl:table-cell">{expiryBlock}</TableCell>
                          <TableCell className="whitespace-normal py-3.5 pr-5 text-right align-top">
                            <div className="flex flex-col items-end gap-1.5">
                              <StatusBadge
                                label={getBorrowLabel('reservation', reservation.status)}
                                variant={getStatusVariant('reservation', reservation.status)}
                                dot
                              />
                              {code ? (
                                <p className="w-fit rounded-md bg-primary/[0.08] px-2 py-0.5 font-mono text-[13px] font-semibold text-primary" title="Mã nhận sách">
                                  {code}
                                </p>
                              ) : null}
                              {NEXT_STEP_HINT[reservation.status] ? (
                                <span className="text-[12px] leading-snug text-muted-foreground">{NEXT_STEP_HINT[reservation.status]}</span>
                              ) : null}
                              {isLive ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  {reservation.status === 'PENDING' ? (
                                    <Button size="sm" disabled={busy}
                                      onClick={() => void confirmReservation(reservation.id)}
                                      data-testid="confirm-reservation-button"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Xác nhận
                                    </Button>
                                  ) : null}
                                  {reservation.status === 'CONFIRMED' ? (
                                    <Button size="sm" disabled={busy}
                                      onClick={() => void confirmReservation(reservation.id, 'READY_FOR_PICKUP')}
                                      data-testid="mark-ready-button"
                                    >
                                      Sẵn sàng
                                    </Button>
                                  ) : null}
                                  <IconButton
                                    variant="ghost"
                                    size="sm-icon"
                                    label={`Hủy đặt trước ${reservation.reservation_number}`}
                                    title="Hủy đặt trước"
                                    onClick={() => setCancelTarget(reservation)}
                                    className="text-muted-foreground hover:text-red-700 dark:hover:text-red-400"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </IconButton>
                                </div>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              <ListFooter
                page={list.page}
                pageSize={PAGE_SIZE}
                total={list.meta.total}
                totalPages={list.meta.totalPages}
                shown={list.rows.length}
                noun="đặt trước"
                onPageChange={list.setPage}
              />
            </section>
          </div>
        </div>
      </FadeItem>

      <BorrowFormDialog
        open={formMode !== null}
        mode={formMode ?? 'RESERVATION'}
        onOpenChange={(open) => { if (!open) setFormMode(null); }}
        onCreated={() => void list.reload()}
      />
      <BarcodeScanModal
        isOpen={pickupScannerOpen}
        onClose={() => setPickupScannerOpen(false)}
        onDetected={(code) => void convertPickupCode(code)}
        title="Quét QR nhận sách"
      />
      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        title="Hủy đặt trước này?"
        description={cancelTarget ? `Đặt trước ${cancelTarget.reservation_number} sẽ chuyển sang trạng thái đã hủy.` : undefined}
        variant="destructive"
        confirmLabel="Hủy đặt trước"
        onConfirm={handleConfirmCancelReservation}
      />
    </PageWrapper>
  );
}
