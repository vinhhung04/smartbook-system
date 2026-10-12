import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarClock, CheckCircle2, Keyboard, Loader2, Plus, RefreshCw, ScanLine, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
import { SectionCard, FilterBar, EmptyState, ConfirmDialog } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonTableRow } from '@/components/ui/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { StatusBadge } from '@/components/status-badge';
import { getBorrowLabel, getStatusVariant } from '@/lib/status-registry';
import { BarcodeScanModal } from '@/components/barcode-scan-modal';
import { borrowService, type Reservation, type ReservationStatus } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { StageTabs, type StageTab } from './borrow-shared/stage-tabs';
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
  danger: 'font-semibold text-rose-600 dark:text-rose-400',
  warning: 'font-semibold text-amber-600 dark:text-amber-400',
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

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={CalendarClock}
          title="Đặt trước sách"
          description="Xác nhận, chuẩn bị sách và giao cho khách tại quầy"
          iconBg="bg-gradient-to-br from-indigo-100 to-purple-50 border border-indigo-200/40 shadow-sm dark:from-indigo-500/15 dark:to-purple-500/10 dark:border-indigo-500/20"
          iconColor="text-indigo-600 dark:text-indigo-400"
          actions={
            <>
              <Button size="sm" variant="outline" onClick={() => void releaseExpiredReservations()} className="gap-2" title="Chuyển các đặt trước quá hạn nhận sang Hết hạn và trả sách về kho">
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

      <FadeItem>
        <SectionCard title="Quầy nhận sách" subtitle="Khách đưa mã nhận sách hoặc mã QR — hệ thống lập phiếu mượn ngay">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-primary/20">
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
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
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
        </SectionCard>
      </FadeItem>

      <FadeItem>
        <div className="rounded-xl border border-border bg-card">
          <StageTabs label="Lọc theo giai đoạn" tabs={tabs} value={tab} onChange={selectTab} loading={list.loading && !counts} />
          <div className="border-t border-border px-4 py-3">
            <FilterBar
              searchValue={list.search}
              onSearchChange={list.setSearch}
              searchPlaceholder="Tìm đặt trước..."
              showSearchClear
            />
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                {[
                  { label: 'Đặt trước', className: '' },
                  { label: 'Sách', className: 'hidden w-[26%] xl:table-cell' },
                  { label: 'Hạn nhận', className: 'hidden w-[150px] lg:table-cell' },
                  { label: 'Trạng thái', className: 'hidden w-[190px] md:table-cell' },
                  { label: 'Thao tác', className: 'w-[150px] text-right' },
                ].map((header) => (
                  <TableHead key={header.label} className={cn('px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground', header.className)}>
                    {header.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.loading && list.rows.length === 0 ? (
                <SkeletonTableRow columns={5} rows={5} />
              ) : list.rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="whitespace-normal">
                    <EmptyState
                      variant={list.search ? 'no-results' : 'no-data'}
                      title={list.search ? 'Không tìm thấy đặt trước' : `Không có đặt trước nào ở mục "${activeTab.label}"`}
                      description={list.search ? 'Thử từ khóa khác hoặc chọn mục khác.' : 'Đặt trước mới của khách sẽ xuất hiện ở đây.'}
                      className="py-12"
                    />
                  </TableCell>
                </TableRow>
              ) : (
                list.rows.map((reservation) => {
                  const expiry = expiryInfo(reservation);
                  const isLive = ACTIVE_RESERVATION_STATUSES.includes(reservation.status);
                  const code = reservation.status === 'READY_FOR_PICKUP' ? reservation.pickup_code || '-' : null;
                  const badge = (
                    <StatusBadge
                      label={getBorrowLabel('reservation', reservation.status)}
                      variant={getStatusVariant('reservation', reservation.status)}
                      dot
                    />
                  );
                  const busy = busyId === reservation.id;
                  return (
                    <TableRow key={reservation.id} className={cn('hover:bg-muted/30', list.loading && 'opacity-60')}>
                      <TableCell className="px-4 py-3">
                        <p className="truncate text-sm font-semibold">{reservation.reservation_number}</p>
                        <p className="truncate text-xs text-muted-foreground">{reservation.customers?.full_name || 'Khách hàng'}</p>
                        <p className="truncate text-xs text-muted-foreground xl:hidden">{bookTitle(reservation.variant_id)}</p>
                        <div className="mt-1.5 space-y-1 md:hidden">
                          {badge}
                          {code ? <span className="block font-mono text-xs font-semibold text-cyan-700 dark:text-cyan-300">{code}</span> : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 xl:table-cell">
                        <p className="line-clamp-2 whitespace-normal text-sm">{bookTitle(reservation.variant_id)}</p>
                        <p className="text-xs text-muted-foreground">
                          {reservation.quantity} cuốn · {getBorrowLabel('sourceChannel', reservation.source_channel)}
                        </p>
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 text-sm lg:table-cell">
                        {expiry ? <p className={cn('text-sm', EXPIRY_TONE_CLASS[expiry.tone])}>{expiry.text}</p> : null}
                        <p className="text-xs text-muted-foreground">{new Date(reservation.expires_at).toLocaleString('vi-VN')}</p>
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 md:table-cell">
                        <div className="flex flex-col items-start gap-1.5">
                          {badge}
                          {code ? (
                            <p className="w-fit rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 font-mono text-xs font-semibold text-cyan-800 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300" title="Mã nhận sách">
                              {code}
                            </p>
                          ) : null}
                          {NEXT_STEP_HINT[reservation.status] ? (
                            <span className="whitespace-normal text-[11px] leading-snug text-muted-foreground">{NEXT_STEP_HINT[reservation.status]}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        {isLive ? (
                          <div className="flex items-center justify-end gap-1.5">
                            {reservation.status === 'PENDING' ? (
                              <Button size="sm" variant="outline" disabled={busy}
                                className="border-sky-200 text-sky-700 hover:bg-sky-50 dark:border-sky-500/20 dark:text-sky-400 dark:hover:bg-sky-500/10"
                                onClick={() => void confirmReservation(reservation.id)}
                                data-testid="confirm-reservation-button"
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                Xác nhận
                              </Button>
                            ) : null}
                            {reservation.status === 'CONFIRMED' ? (
                              <Button size="sm" variant="outline" disabled={busy}
                                className="border-cyan-200 text-cyan-700 hover:bg-cyan-50 dark:border-cyan-500/20 dark:text-cyan-400 dark:hover:bg-cyan-500/10"
                                onClick={() => void confirmReservation(reservation.id, 'READY_FOR_PICKUP')}
                                data-testid="mark-ready-button"
                              >
                                Sẵn sàng
                              </Button>
                            ) : null}
                            <button
                              type="button"
                              aria-label={`Hủy đặt trước ${reservation.reservation_number}`}
                              title="Hủy đặt trước"
                              onClick={() => setCancelTarget(reservation)}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="block text-right text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <ListFooter
            page={list.page}
            pageSize={PAGE_SIZE}
            total={list.meta.total}
            totalPages={list.meta.totalPages}
            shown={list.rows.length}
            noun="đặt trước"
            onPageChange={list.setPage}
          />
        </SectionCard>
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
