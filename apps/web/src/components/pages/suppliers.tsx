import { supplierService, Supplier } from '@/services/supplier';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Truck, Plus, Pencil, Trash2, RefreshCw, X, Search } from 'lucide-react';
import { getApiErrorMessage } from '@/services/api';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { PageWrapper, FadeItem } from '../motion-utils';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { QueueTabs, RowsSkeleton } from '@/components/ops/ops-kit';
import { StatusBadge } from '@/components/status-badge';
import { getStatusVariant } from '@/lib/status-registry';
import { authService } from '@/services/auth';
import { canAccess, ROUTE_ACCESS } from '@/lib/rbac';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from '@/components/ui/pagination';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { getPaginationRange } from '@/lib/pagination';
import { cn } from '@/components/ui/utils';

interface SupplierFormState {
  code: string;
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  tax_code: string;
}

const EMPTY_FORM: SupplierFormState = {
  code: '',
  name: '',
  contact_name: '',
  phone: '',
  email: '',
  address: '',
  tax_code: '',
};

function isActiveStatus(status: string) {
  return String(status || '').toUpperCase() === 'ACTIVE';
}

const PAGE_SIZE = 10;
const PANEL_ID = 'supplier-list';

// The API stores English codes; staff read Vietnamese.
const SUPPLIER_STATUS_LABELS: Record<string, string> = { ACTIVE: 'Đang hoạt động', INACTIVE: 'Ngừng hợp tác' };
function supplierStatusLabel(status: string) {
  return SUPPLIER_STATUS_LABELS[String(status || '').toUpperCase()] ?? (status || '-');
}

function formatShortDate(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('vi-VN');
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'OTHER';

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const canManageSuppliers = canAccess(authService.getCurrentUser(), ROUTE_ACCESS.supplierWrite);
  const modalRef = useRef<HTMLDivElement>(null);

  const loadSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await supplierService.getAll();
      setSuppliers(Array.isArray(rows) ? rows : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được danh sách nhà cung cấp'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const activeCount = suppliers.filter((s) => isActiveStatus(s.status)).length;

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return suppliers.filter((row) => {
      if (statusFilter === 'ACTIVE' && !isActiveStatus(row.status)) return false;
      if (statusFilter === 'OTHER' && isActiveStatus(row.status)) return false;
      if (!keyword) return true;
      return [row.code, row.name, row.contact_name, row.phone, row.email, row.tax_code]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [suppliers, search, statusFilter]);

  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedSuppliers = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (row: Supplier) => {
    setEditing(row);
    setForm({
      code: row.code ?? '',
      name: row.name ?? '',
      contact_name: row.contact_name ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      address: row.address ?? '',
      tax_code: row.tax_code ?? '',
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  useDialogA11y(modalOpen, closeModal, modalRef);

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('Tên nhà cung cấp là bắt buộc');
      return;
    }

    const payload: Partial<Supplier> = {
      code: form.code.trim() || null,
      name: form.name.trim(),
      contact_name: form.contact_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      tax_code: form.tax_code.trim() || null,
    };

    try {
      setSaving(true);
      if (editing) {
        await supplierService.update(editing.id, payload);
        toast.success('Đã cập nhật nhà cung cấp');
      } else {
        await supplierService.create(payload);
        toast.success('Đã tạo nhà cung cấp');
      }
      closeModal();
      await loadSuppliers();
    } catch (error) {
      toast.error(getApiErrorMessage(error, editing ? 'Cập nhật thất bại' : 'Tạo mới thất bại'));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    try {
      setDeletingId(deleteTarget.id);
      await supplierService.delete(deleteTarget.id);
      toast.success('Đã xóa nhà cung cấp');
      setDeleteTarget(null);
      await loadSuppliers();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Xóa thất bại'));
    } finally {
      setDeletingId(null);
    }
  };

  const totalPos = suppliers.reduce((sum, s) => sum + (s._count?.purchase_orders ?? 0), 0);
  const totalTitles = suppliers.reduce((sum, s) => sum + (s._count?.supplier_variants ?? 0), 0);
  const busiest = [...suppliers].sort((a, b) => (b._count?.purchase_orders ?? 0) - (a._count?.purchase_orders ?? 0))[0];
  const lede = loading
    ? 'Danh bạ nhà cung cấp và lịch sử đặt hàng với từng nơi.'
    : suppliers.length === 0
      ? 'Chưa có nhà cung cấp nào. Thêm nhà cung cấp để bắt đầu đặt hàng.'
      : `${suppliers.length} nhà cung cấp, ${activeCount} đang hoạt động. ${totalPos.toLocaleString('vi-VN')} đơn đặt hàng${busiest && (busiest._count?.purchase_orders ?? 0) > 0 ? `, nhiều nhất với ${busiest.name} (${busiest._count?.purchase_orders})` : ''}.`;
  const statusTabs: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: 'ALL', label: 'Tất cả', count: suppliers.length },
    { key: 'ACTIVE', label: 'Đang hoạt động', count: activeCount },
    { key: 'OTHER', label: 'Ngừng hợp tác', count: suppliers.length - activeCount },
  ];
  const fieldClass = 'h-10 w-full rounded-md border border-input bg-input-background px-3 text-[14px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-muted/40';

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={Truck}
          title="Nhà cung cấp"
          description={lede}
          actions={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadSuppliers()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 motion-reduce:animate-none ${loading ? 'animate-spin' : ''}`} />
                Làm mới
              </Button>
              {canManageSuppliers ? <Button type="button" size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" />
                Nhà cung cấp mới
              </Button> : null}
            </>
          }
        />
      </FadeItem>

      <FadeItem>
        <section aria-label="Danh sách nhà cung cấp" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
          <QueueTabs label="Lọc theo trạng thái" tabs={statusTabs} value={statusFilter} onChange={setStatusFilter} panelId={PANEL_ID} loading={loading} />
          <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="relative min-w-0 sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm tên, mã, người liên hệ, điện thoại…"
                aria-label="Tìm nhà cung cấp"
                className="h-10 w-full rounded-md border border-input bg-input-background pl-9 pr-3 text-[14px] outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-border dark:bg-muted/40 sm:h-9"
              />
            </div>
            {!loading ? (
              <p className="text-[13px] tabular-nums text-muted-foreground">
                {totalTitles.toLocaleString('vi-VN')} đầu sách có giá nhà cung cấp
              </p>
            ) : null}
          </div>

          <div id={PANEL_ID} role="tabpanel" aria-labelledby={`${PANEL_ID}-tab-${statusFilter}`} aria-busy={loading}>
            {loading ? (
              <RowsSkeleton rows={4} />
            ) : filtered.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState
                  variant={suppliers.length === 0 ? 'no-data' : 'no-results'}
                  title={suppliers.length === 0 ? 'Chưa có nhà cung cấp' : 'Không tìm thấy nhà cung cấp phù hợp'}
                  description={suppliers.length === 0 ? 'Thêm nhà cung cấp mới để bắt đầu' : 'Thử đổi từ khóa hoặc bộ lọc.'}
                  className="py-0"
                />
              </div>
            ) : (
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Nhà cung cấp</TableHead>
                    <TableHead className="hidden w-[240px] text-[12px] font-normal text-muted-foreground @3xl:table-cell">Liên hệ</TableHead>
                    <TableHead className="hidden w-[120px] text-right text-[12px] font-normal text-muted-foreground @2xl:table-cell">Giao dịch</TableHead>
                    <TableHead className="w-[132px] pr-5 text-right text-[12px] font-normal text-muted-foreground">Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSuppliers.map((row) => {
                    const poCount = row._count?.purchase_orders ?? 0;
                    const titleCount = row._count?.supplier_variants ?? 0;
                    const contactLines = (
                      <>
                        <p className="truncate text-[13px] text-foreground" title={row.contact_name || undefined}>{row.contact_name || 'Chưa có người liên hệ'}</p>
                        {row.phone ? <a href={`tel:${row.phone}`} className="block truncate text-[13px] tabular-nums text-primary underline-offset-2 hover:underline">{row.phone}</a> : null}
                        {row.email ? <a href={`mailto:${row.email}`} className="block truncate text-[13px] text-primary underline-offset-2 hover:underline" title={row.email}>{row.email}</a> : null}
                      </>
                    );
                    return (
                      <TableRow key={row.id} className="hover:bg-muted/30">
                        <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                          <p className="text-[14px] font-semibold text-foreground">{row.name}</p>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">
                            {row.code ? <span className="font-mono">{row.code}</span> : null}
                            {row.code && row.tax_code ? ', ' : null}
                            {row.tax_code ? <>MST <span className="font-mono">{row.tax_code}</span></> : null}
                            {!row.code && !row.tax_code ? 'Chưa có mã' : null}
                          </p>
                          {row.address ? <p className="mt-1 line-clamp-2 max-w-prose text-[13px] text-muted-foreground" title={row.address}>{row.address}</p> : null}
                          {/* Columns the container hides move here, so no field is dropped. */}
                          <div className="mt-1.5 @3xl:hidden">{contactLines}</div>
                          <p className="mt-1 text-[12px] tabular-nums text-muted-foreground @2xl:hidden">{poCount} đơn PO, {titleCount} đầu sách</p>
                        </TableCell>
                        <TableCell className="hidden whitespace-normal py-3.5 align-top @3xl:table-cell">{contactLines}</TableCell>
                        <TableCell className="hidden py-3.5 text-right align-top @2xl:table-cell">
                          <p className="text-[15px] font-semibold tabular-nums text-foreground">{poCount}<span className="text-[12px] font-normal text-muted-foreground"> đơn PO</span></p>
                          <p className="text-[12px] tabular-nums text-muted-foreground">{titleCount} đầu sách</p>
                        </TableCell>
                        <TableCell className="py-3.5 pr-5 text-right align-top">
                          <div className="flex flex-col items-end gap-1.5">
                            <StatusBadge label={supplierStatusLabel(row.status)} variant={getStatusVariant('supplier', row.status, 'warning')} dot />
                            <span className="text-[12px] tabular-nums text-muted-foreground">Từ {formatShortDate(row.created_at)}</span>
                            {canManageSuppliers ? (
                              <div className="-mr-2 flex items-center gap-0.5">
                                <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-[13px] sm:h-8" onClick={() => openEdit(row)} aria-label={`Sửa ${row.name}`}>
                                  <Pencil className="h-3.5 w-3.5" />Sửa
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-9 px-2 text-[13px] text-muted-foreground hover:text-red-700 sm:h-8 dark:hover:text-red-400"
                                  onClick={() => setDeleteTarget(row)}
                                  disabled={deletingId === row.id}
                                  aria-label={`Xóa ${row.name}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />Xóa
                                </Button>
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
          </div>

          {!loading && filtered.length > 0 ? (
            <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>Hiển thị <span className="font-medium tabular-nums text-foreground">{(currentPage - 1) * PAGE_SIZE + 1}–{(currentPage - 1) * PAGE_SIZE + paginatedSuppliers.length}</span> trong {filtered.length} nhà cung cấp{canManageSuppliers ? '' : '. Bạn chỉ có quyền xem.'}</span>
              {totalPages > 1 && (
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((p) => Math.max(1, p - 1));
                        }}
                        className={cn("cursor-pointer", currentPage === 1 && "pointer-events-none opacity-50")}
                      />
                    </PaginationItem>
                    {getPaginationRange(currentPage, totalPages).map((item) => (
                      <PaginationItem key={item}>
                        {typeof item === "number" ? (
                          <PaginationLink
                            isActive={item === currentPage}
                            onClick={(event) => {
                              event.preventDefault();
                              setPage(item);
                            }}
                            className="cursor-pointer"
                          >
                            {item}
                          </PaginationLink>
                        ) : (
                          <PaginationEllipsis />
                        )}
                      </PaginationItem>
                    ))}
                    <PaginationItem>
                      <PaginationNext
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((p) => Math.min(totalPages, p + 1));
                        }}
                        className={cn("cursor-pointer", currentPage === totalPages && "pointer-events-none opacity-50")}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          ) : null}
        </section>
      </FadeItem>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="supplier-modal-title"
        >
          <motion.div
            ref={modalRef}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="mx-4 w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="supplier-modal-title" className="font-display text-[20px] font-semibold tracking-tight text-foreground">
                {editing ? 'Sửa nhà cung cấp' : 'Nhà cung cấp mới'}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[min(70vh,520px)] space-y-3 overflow-y-auto pr-1">
              {(
                [
                  { key: 'code', label: 'Mã', type: 'text' as const },
                  { key: 'name', label: 'Tên', type: 'text' as const, required: true },
                  { key: 'contact_name', label: 'Người liên hệ', type: 'text' as const },
                  { key: 'phone', label: 'Điện thoại', type: 'text' as const },
                  { key: 'email', label: 'Email', type: 'email' as const },
                  { key: 'tax_code', label: 'Mã số thuế', type: 'text' as const },
                ] as const
              ).map((field) => (
                <div key={field.key}>
                  <label htmlFor={`supplier-field-${field.key}`} className="mb-1 block text-[13px] font-medium text-foreground">
                    {field.label}
                    {'required' in field && field.required ? <span className="text-red-600 dark:text-red-400"> *</span> : null}
                  </label>
                  <input
                    id={`supplier-field-${field.key}`}
                    type={field.type}
                    value={form[field.key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className={fieldClass}
                  />
                </div>
              ))}
              <div>
                <label htmlFor="supplier-field-address" className="mb-1 block text-[13px] font-medium text-foreground">Địa chỉ</label>
                <textarea
                  id="supplier-field-address"
                  value={form.address}
                  onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                  rows={3}
                  className="min-h-[72px] w-full resize-y rounded-md border border-input bg-input-background px-3 py-2 text-[14px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-muted/40"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={closeModal} disabled={saving}>Hủy</Button>
              <Button type="button" onClick={() => void handleSubmit()} disabled={saving}>
                {saving ? 'Đang lưu...' : editing ? 'Cập nhật' : 'Tạo mới'}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Xóa nhà cung cấp?"
        description={deleteTarget ? `Xóa nhà cung cấp "${deleteTarget.name || deleteTarget.id}"? Thao tác này không thể hoàn tác.` : undefined}
        variant="destructive"
        confirmLabel="Xóa"
        onConfirm={handleConfirmDelete}
        loading={deletingId === deleteTarget?.id}
      />
    </PageWrapper>
  );
}
