import { supplierService, Supplier } from '@/services/supplier';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Truck, Plus, Pencil, Trash2, RefreshCw, X } from 'lucide-react';
import { getApiErrorMessage } from '@/services/api';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { PageWrapper, FadeItem } from '../motion-utils';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/ui/filter-bar';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonTableRow } from '@/components/ui/loading-state';
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
const ICON_BUTTON_CLASS = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60';

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

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={Truck}
          title="Nhà cung cấp"
          description="Quản lý danh sách và thông tin nhà cung cấp"
          iconBg="bg-gradient-to-br from-sky-500 to-cyan-600 shadow-lg shadow-sky-500/25"
          iconColor="text-white"
          actions={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadSuppliers()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
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
        <div className="space-y-3">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Tìm theo tên, mã, người liên hệ, điện thoại, email..."
            showSearchClear
          />
          <div className="max-w-full overflow-x-auto">
            <SegmentedControl
              layoutId="supplier-status-filter"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'ALL', label: `Tất cả (${suppliers.length})` },
                { value: 'ACTIVE', label: `Đang hoạt động (${activeCount})` },
                { value: 'OTHER', label: `Khác (${suppliers.length - activeCount})` },
              ]}
              gradientClassName="from-sky-600 to-cyan-600"
              className="w-max"
            />
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {[
                    { label: 'Nhà cung cấp', className: '' },
                    { label: 'Liên hệ', className: 'hidden w-[260px] md:table-cell' },
                    { label: 'Trạng thái', className: 'hidden w-[140px] sm:table-cell' },
                    { label: 'Số PO', className: 'hidden w-[80px] text-right lg:table-cell' },
                    { label: '', className: 'w-[96px]' },
                  ].map((h) => (
                    <TableHead key={h.label || 'actions'} className={cn('px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground', h.className)}>
                      {h.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonTableRow columns={5} rows={5} />
                ) : filtered.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="whitespace-normal">
                      <EmptyState
                        variant={suppliers.length === 0 ? 'no-data' : 'no-results'}
                        title={suppliers.length === 0 ? 'Chưa có nhà cung cấp' : 'Không tìm thấy nhà cung cấp phù hợp'}
                        description={suppliers.length === 0 ? 'Thêm nhà cung cấp mới để bắt đầu' : 'Thử đổi từ khóa hoặc bộ lọc.'}
                        className="py-12"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedSuppliers.map((row) => {
                    const poCount = row._count?.purchase_orders ?? 0;
                    const contact = [row.contact_name, row.phone].filter(Boolean).join(' · ');
                    return (
                      <TableRow key={row.id} className="hover:bg-muted/30">
                        <TableCell className="px-4 py-3 align-top">
                          <p className="truncate text-[13px] font-semibold" title={row.name}>{row.name}</p>
                          <p className="truncate text-[12px] text-muted-foreground">
                            {[row.code, row.tax_code ? `MST ${row.tax_code}` : null].filter(Boolean).join(' · ') || '—'}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                            <StatusBadge label={row.status || '—'} variant={getStatusVariant('supplier', row.status, 'warning')} />
                          </div>
                          <p className="mt-1 truncate text-[12px] text-muted-foreground md:hidden">{contact || row.email || '—'}</p>
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 align-top md:table-cell">
                          <p className="truncate text-[13px]" title={contact || undefined}>{contact || '—'}</p>
                          <p className="truncate text-[12px] text-muted-foreground" title={row.email || undefined}>{row.email || '—'}</p>
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 align-top sm:table-cell">
                          <StatusBadge label={row.status || '—'} variant={getStatusVariant('supplier', row.status, 'warning')} />
                        </TableCell>
                        <TableCell className="hidden px-4 py-3 text-right align-top text-[13px] tabular-nums lg:table-cell">{poCount}</TableCell>
                        <TableCell className="px-4 py-3 align-top">
                          {canManageSuppliers ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEdit(row)}
                                aria-label={`Sửa ${row.name}`}
                                title="Sửa"
                                className={cn(ICON_BUTTON_CLASS, 'border-input hover:bg-muted')}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(row)}
                                disabled={deletingId === row.id}
                                aria-label={`Xóa ${row.name}`}
                                title={deletingId === row.id ? 'Đang xóa...' : 'Xóa'}
                                className={cn(ICON_BUTTON_CLASS, 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/15')}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="block text-right text-[12px] text-muted-foreground">Chỉ xem</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-col gap-3 px-5 py-3 border-t border-border text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Hiển thị {paginatedSuppliers.length} / {filtered.length} nhà cung cấp</span>
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
        </SectionCard>
      </FadeItem>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="supplier-modal-title"
        >
          <motion.div
            ref={modalRef}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="mx-4 w-full max-w-lg rounded-2xl bg-card p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="supplier-modal-title" className="text-[16px] font-semibold text-foreground">
                {editing ? 'Sửa nhà cung cấp' : 'Nhà cung cấp mới'}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                  <label className="mb-1 block text-[12px] font-medium text-muted-foreground">
                    {field.label}
                    {'required' in field && field.required ? <span className="text-red-500"> *</span> : null}
                  </label>
                  <input
                    type={field.type}
                    value={form[field.key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="w-full h-9 px-3 rounded-lg border border-input bg-background text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                  />
                </div>
              ))}
              <div>
                <label className="mb-1 block text-[12px] font-medium text-muted-foreground">Địa chỉ</label>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                  rows={3}
                  className="w-full min-h-[72px] resize-y px-3 py-2 rounded-lg border border-input bg-background text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="h-9 rounded-lg border border-input px-4 text-[13px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={saving}
                className="h-9 rounded-lg bg-indigo-600 px-4 text-[13px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Đang lưu...' : editing ? 'Cập nhật' : 'Tạo mới'}
              </button>
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
