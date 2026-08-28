import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { ArrowLeft, ClipboardList, Plus, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderService, type PurchaseOrderLinePayload, type VariantSearchItem } from "@/services/purchase-order";
import { supplierService, type Supplier } from "@/services/supplier";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import { getApiErrorMessage } from "@/services/api";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/components/ui/utils";

interface FormLine extends PurchaseOrderLinePayload {
  key: string;
  title?: string;
  sku?: string | null;
}

const newLine = (): FormLine => ({
  key: crypto.randomUUID(),
  variant_id: "",
  isbn13: "",
  ordered_qty: 1,
  unit_cost: 0,
  note: "",
  title: "",
  sku: "",
});

function formatCurrency(value: number) {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
}

export function PurchaseOrderFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>([newLine()]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VariantSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeLineKey, setActiveLineKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [supplierRows, warehouseRows] = await Promise.all([
          supplierService.getAll(),
          warehouseService.getAll(),
        ]);
        setSuppliers(Array.isArray(supplierRows) ? supplierRows.filter((s) => s.status === "ACTIVE") : []);
        setWarehouses(Array.isArray(warehouseRows) ? warehouseRows.filter((w) => w.is_active !== false) : []);
        if (id) {
          const po = await purchaseOrderService.getById(id);
          if (!["DRAFT", "REJECTED"].includes(po.status)) {
            toast.error("Chỉ có thể sửa đơn mua hàng ở trạng thái Nháp hoặc Bị từ chối");
            navigate(`/purchase-orders/${id}`);
            return;
          }
          setSupplierId(po.supplier_id);
          setWarehouseId(po.warehouse_id);
          setExpectedDate(po.expected_date ? String(po.expected_date).slice(0, 10) : "");
          setNote(po.note || "");
          setLines(po.items.map((item) => ({
            key: item.id,
            variant_id: item.variant_id,
            isbn13: item.isbn13 || "",
            ordered_qty: item.ordered_qty,
            unit_cost: item.unit_cost,
            note: item.note || "",
            title: item.title,
            sku: item.sku,
          })));
        }
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được biểu mẫu đơn mua hàng"));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [id, navigate]);

  const totalAmount = useMemo(() => lines.reduce((sum, line) => sum + Number(line.ordered_qty || 0) * Number(line.unit_cost || 0), 0), [lines]);

  const updateLine = (key: string, patch: Partial<FormLine>) => {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  };

  const searchVariants = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const rows = await purchaseOrderService.searchVariants(query);
      setResults(rows);
      if (rows.length === 0) toast.info("Không tìm thấy biến thể sách nào");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tìm kiếm biến thể thất bại"));
    } finally {
      setSearching(false);
    }
  };

  const selectVariant = (variant: VariantSearchItem) => {
    if (!activeLineKey) return;
    updateLine(activeLineKey, {
      variant_id: variant.variant_id,
      isbn13: variant.isbn13 || "",
      title: variant.title,
      sku: variant.sku,
    });
    setResults([]);
    setQuery("");
  };

  const validate = () => {
    if (!supplierId) return "Vui lòng chọn nhà cung cấp";
    if (!warehouseId) return "Vui lòng chọn kho nhận hàng";
    if (lines.length === 0) return "Cần ít nhất một dòng sách";
    const seen = new Set<string>();
    for (const line of lines) {
      if (!line.variant_id && !line.isbn13) return "Mỗi dòng cần chọn biến thể sách hoặc nhập ISBN";
      if (line.variant_id && seen.has(line.variant_id)) return "Có biến thể sách bị trùng trong đơn";
      if (line.variant_id) seen.add(line.variant_id);
      if (!Number.isInteger(Number(line.ordered_qty)) || Number(line.ordered_qty) <= 0) return "Số lượng đặt phải lớn hơn 0";
      if (!Number.isFinite(Number(line.unit_cost)) || Number(line.unit_cost) < 0) return "Đơn giá phải lớn hơn hoặc bằng 0";
    }
    return null;
  };

  const save = async () => {
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    const payload = {
      supplier_id: supplierId,
      warehouse_id: warehouseId,
      expected_date: expectedDate || null,
      note: note || null,
      items: lines.map((line) => ({
        variant_id: line.variant_id,
        isbn13: line.isbn13 || undefined,
        ordered_qty: Number(line.ordered_qty),
        unit_cost: Number(line.unit_cost),
        note: line.note || null,
      })),
    };
    try {
      setSaving(true);
      const response = isEdit && id
        ? await purchaseOrderService.update(id, payload)
        : await purchaseOrderService.create(payload);
      toast.success(isEdit ? "Đã cập nhật đơn mua hàng" : "Đã tạo đơn mua hàng");
      navigate(`/purchase-orders/${response.data.id}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Lưu đơn mua hàng thất bại"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 lg:p-8 max-w-7xl mx-auto"><LoadingOverlay /></div>;
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <NavLink to={id ? `/purchase-orders/${id}` : "/purchase-orders"} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Quay lại
      </NavLink>

      <PageHeader
        icon={ClipboardList}
        title={isEdit ? "Sửa đơn mua hàng" : "Tạo đơn mua hàng"}
        description="Tạo đơn mua hàng nội bộ và gửi duyệt trước khi nhận hàng."
        iconBg="bg-indigo-100 dark:bg-indigo-500/15"
        iconColor="text-indigo-700 dark:text-indigo-400"
        actions={
          <Button onClick={() => void save()} loading={saving}>
            <Save className="h-3.5 w-3.5" />
            {saving ? "Đang lưu..." : "Lưu đơn mua hàng"}
          </Button>
        }
      />

      <SectionCard title="Thông tin đơn mua hàng">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Nhà cung cấp</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn nhà cung cấp..." />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Kho nhận hàng</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn kho..." />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Ngày dự kiến nhận</Label>
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Ghi chú</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú (không bắt buộc)" />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Danh sách sách" subtitle={`Tạm tính: ${formatCurrency(totalAmount)}`}>
        <div className="mb-4 rounded-xl border border-dashed border-input bg-muted/20 p-3">
          <div className="flex flex-col gap-2 md:flex-row">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void searchVariants(); }}
              placeholder="Tìm theo tên sách, SKU hoặc ISBN..."
              className="flex-1"
            />
            <Button type="button" variant="outline" loading={searching} onClick={() => void searchVariants()}>
              <Search className="h-3.5 w-3.5" />
              Tìm biến thể
            </Button>
          </div>
          {results.length > 0 && (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {results.map((variant) => (
                <button
                  key={variant.variant_id}
                  type="button"
                  onClick={() => selectVariant(variant)}
                  disabled={!activeLineKey}
                  className="rounded-lg border border-input bg-card p-3 text-left text-[13px] hover:border-indigo-200 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-indigo-500/30 dark:hover:bg-indigo-500/10"
                >
                  <div className="font-medium">{variant.title}</div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">{variant.isbn13 || variant.sku || variant.barcode || variant.variant_id}</div>
                </button>
              ))}
            </div>
          )}
          {results.length > 0 && !activeLineKey && (
            <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">Chọn một dòng sách bên dưới trước khi gán biến thể.</p>
          )}
        </div>

        {lines.length === 0 ? (
          <EmptyState variant="no-data" title="Chưa có dòng sách nào" description="Thêm ít nhất một dòng sách" />
        ) : (
          <div className="space-y-3">
            {lines.map((line, index) => (
              <div key={line.key} className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-[1.5fr_110px_130px_1fr_40px]">
                <button
                  type="button"
                  onClick={() => setActiveLineKey(line.key)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-[13px]",
                    activeLineKey === line.key ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10" : "border-input bg-background",
                  )}
                >
                  <div className="font-medium">{line.title || `Dòng ${index + 1}: chọn biến thể sách`}</div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">{line.isbn13 || line.sku || line.variant_id || "Bấm rồi tìm ở trên"}</div>
                </button>
                <Input type="number" min={1} value={line.ordered_qty} onChange={(e) => updateLine(line.key, { ordered_qty: Number(e.target.value) })} className="font-mono" placeholder="SL" />
                <Input type="number" min={0} value={line.unit_cost} onChange={(e) => updateLine(line.key, { unit_cost: Number(e.target.value) })} className="font-mono" placeholder="Đơn giá" />
                <Input value={line.note || ""} onChange={(e) => updateLine(line.key, { note: e.target.value })} placeholder="Ghi chú dòng" />
                <Button
                  type="button"
                  variant="danger-outline"
                  size="icon"
                  onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                  aria-label="Xóa dòng"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, newLine()])}>
            <Plus className="h-3.5 w-3.5" />
            Thêm dòng
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
