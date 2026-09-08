import { supplierService, Supplier } from '@/services/supplier';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Truck, Plus, Edit, Trash2, RefreshCw, X } from 'lucide-react';
import { getApiErrorMessage } from '@/services/api';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { PageWrapper, FadeItem } from '../motion-utils';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
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

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
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

  const totalCount = suppliers.length;
  const activeCount = suppliers.filter((s) => isActiveStatus(s.status)).length;
  const totalPages = Math.max(1, Math.ceil(suppliers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedSuppliers = suppliers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard label="Tổng nhà cung cấp" value={totalCount} icon={Truck} variant="info" />
          <StatCard label="Đang hoạt động" value={activeCount} variant="success" />
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <div className="overflow-hidden rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {['Mã', 'Tên', 'Liên hệ', 'Điện thoại', 'Email', 'Trạng thái', 'Số PO', 'Thao tác'].map((h) => (
                    <TableHead key={h} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonTableRow columns={8} rows={5} />
                ) : suppliers.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={8} className="whitespace-normal">
                      <EmptyState
                        variant="no-data"
                        title="Chưa có nhà cung cấp"
                        description="Thêm nhà cung cấp mới để bắt đầu"
                        className="py-12"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedSuppliers.map((row) => {
                    const poCount = row._count?.purchase_orders ?? 0;
                    return (
                      <TableRow key={row.id} className="hover:bg-muted/30">
                        <TableCell className="text-[13px] font-semibold">{row.code || '—'}</TableCell>
                        <TableCell className="text-[13px]">{row.name}</TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{row.contact_name || '—'}</TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{row.phone || '—'}</TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{row.email || '—'}</TableCell>
                        <TableCell>
                          <StatusBadge label={row.status || '—'} variant={getStatusVariant('supplier', row.status, 'warning')} />
                        </TableCell>
                        <TableCell className="text-[13px] tabular-nums">{poCount}</TableCell>
                        <TableCell>
                          {canManageSuppliers ? <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(row)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1 text-[12px] hover:bg-muted"
                            >
                              <Edit className="h-3.5 w-3.5" />
                              Sửa
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(row)}
                              disabled={deletingId === row.id}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[12px] text-red-700 hover:bg-red-100 disabled:opacity-60 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/15"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {deletingId === row.id ? 'Đang xóa...' : 'Xóa'}
                            </button>
                          </div> : <span className="text-[12px] text-muted-foreground">Read only</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-col gap-3 px-5 py-3 border-t border-border text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Hiển thị {paginatedSuppliers.length} / {suppliers.length} nhà cung cấp</span>
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
