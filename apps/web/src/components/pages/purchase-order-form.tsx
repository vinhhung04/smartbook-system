import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router";
import { ArrowLeft, Plus, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderService, type PurchaseOrderLinePayload, type VariantSearchItem } from "@/services/purchase-order";
import { supplierService, type Supplier } from "@/services/supplier";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import { getApiErrorMessage } from "@/services/api";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { cn } from "@/components/ui/utils";
import { numberInputValue, zeroFieldProps } from "@/lib/number-input";

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

// Lines handed over by another page (e.g. reorder suggestions) via router state.
export interface PurchaseOrderPrefill {
  note?: string;
  lines: Array<{ variant_id: string; title: string; isbn13?: string | null; ordered_qty: number; unit_cost: number }>;
}

function formatCurrency(value: number) {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
}

export function PurchaseOrderFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as { prefill?: PurchaseOrderPrefill } | null)?.prefill;
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
        } else if (prefill?.lines.length) {
          setNote(prefill.note || "");
          setLines(prefill.lines.map((line) => ({
            ...newLine(),
            variant_id: line.variant_id,
            isbn13: line.isbn13 || "",
            ordered_qty: line.ordered_qty,
            unit_cost: line.unit_cost,
            title: line.title,
          })));
        }
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được biểu mẫu đơn mua hàng"));
      } finally {
        setLoading(false);
      }
    };
    void load();
    // The prefill is read once on mount; later state changes must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return <div className="mx-auto max-w-7xl p-5 sm:p-6 lg:p-8"><LoadingOverlay /></div>;
  }

  const totalQty = lines.reduce((sum, line) => sum + (Number(line.ordered_qty) || 0), 0);
  const pickedLines = lines.filter((line) => line.variant_id).length;
  const supplierName = suppliers.find((supplier) => supplier.id === supplierId)?.name;
  const warehouseName = warehouses.find((warehouse) => warehouse.id === warehouseId);
  const fieldLabel = "mb-1.5 block text-[13px] font-medium text-foreground";

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5 sm:p-6 lg:p-8">
      <div>
        <NavLink to={id ? `/purchase-orders/${id}` : "/purchase-orders"} className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {id ? "Chi tiết đơn" : "Đơn đặt hàng"}
        </NavLink>
        <h1 className="mt-2 font-display text-[28px] font-semibold leading-tight tracking-tight text-foreground sm:text-[32px]">
          {isEdit ? "Sửa đơn mua hàng" : "Tạo đơn mua hàng"}
        </h1>
        <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
          Chọn nhà cung cấp và kho nhận, thêm sách cần đặt. Lưu xong đơn ở trạng thái Nháp, gửi duyệt ở trang chi tiết.
        </p>
      </div>

      <div className="@container/page">
        <div className="grid grid-cols-1 items-start gap-5 @4xl/page:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-5">
            <section aria-labelledby="po-info-title" className="rounded-2xl border border-border bg-card p-5">
              <h2 id="po-info-title" className="font-display text-[18px] font-semibold tracking-tight">Thông tin đơn</h2>
              <div className="mt-4 grid gap-4 @2xl/page:grid-cols-2">
                <div>
                  <Label htmlFor="po-supplier" className={fieldLabel}>Nhà cung cấp</Label>
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger id="po-supplier" className="w-full">
                      <SelectValue placeholder="Chọn nhà cung cấp..." />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="po-warehouse" className={fieldLabel}>Kho nhận hàng</Label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger id="po-warehouse" className="w-full">
                      <SelectValue placeholder="Chọn kho..." />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((warehouse) => (
                        <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="po-expected-date" className={fieldLabel}>Ngày dự kiến nhận</Label>
                  <Input id="po-expected-date" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="po-note" className={fieldLabel}>Ghi chú</Label>
                  <Input id="po-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Không bắt buộc" />
                </div>
              </div>
            </section>

            <section aria-labelledby="po-lines-title" className="rounded-2xl border border-border bg-card p-5">
              <h2 id="po-lines-title" className="font-display text-[18px] font-semibold tracking-tight">Sách cần đặt</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Bấm vào một dòng để chọn nó, rồi tìm sách và bấm vào kết quả để gán sách cho dòng đó.</p>

              <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex flex-col gap-2 @2xl/page:flex-row">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void searchVariants(); }}
                    placeholder="Tìm theo tên sách, SKU hoặc ISBN..."
                    aria-label="Tìm sách để gán cho dòng đang chọn"
                    className="flex-1 bg-card"
                  />
                  <Button type="button" variant="outline" loading={searching} onClick={() => void searchVariants()} className="gap-2">
                    <Search className="h-3.5 w-3.5" />
                    Tìm sách
                  </Button>
                </div>
                {results.length > 0 && (
                  <div className="mt-3 grid gap-2 @2xl/page:grid-cols-2">
                    {results.map((variant) => (
                      <button
                        key={variant.variant_id}
                        type="button"
                        onClick={() => selectVariant(variant)}
                        disabled={!activeLineKey}
                        className="rounded-lg border border-border bg-card p-3 text-left text-[13px] transition-colors hover:border-primary/35 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="font-medium text-foreground">{variant.title}</div>
                        <div className="mt-0.5 font-mono text-[12px] text-muted-foreground">{variant.isbn13 || variant.sku || variant.barcode || variant.variant_id}</div>
                      </button>
                    ))}
                  </div>
                )}
                {results.length > 0 && !activeLineKey && (
                  <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">Chọn một dòng sách bên dưới trước khi gán.</p>
                )}
              </div>

              {lines.length === 0 ? (
                <EmptyState variant="no-data" title="Chưa có dòng sách nào" description="Thêm ít nhất một dòng sách" className="py-8" />
              ) : (
                <ol className="mt-4 space-y-3">
                  {lines.map((line, index) => {
                    const active = activeLineKey === line.key;
                    const lineTotal = (Number(line.ordered_qty) || 0) * (Number(line.unit_cost) || 0);
                    return (
                      <li key={line.key} className={cn("rounded-xl border p-3 transition-colors", active ? "border-primary/40 bg-primary/[0.04]" : "border-border")}>
                        <div className="flex items-start gap-3">
                          <span className="mt-2 w-5 shrink-0 text-[13px] font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                          <button
                            type="button"
                            onClick={() => setActiveLineKey(line.key)}
                            aria-pressed={active}
                            className="min-w-0 flex-1 rounded-lg px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          >
                            <span className={cn("block text-[14px] font-medium", line.title ? "text-foreground" : "text-muted-foreground")}>
                              {line.title || "Chưa chọn sách"}
                            </span>
                            <span className={cn("block text-[12px] text-muted-foreground", (line.isbn13 || line.sku || line.variant_id) && "font-mono")}>
                              {line.isbn13 || line.sku || line.variant_id || (active ? "Đang chọn dòng này, tìm sách ở trên" : "Bấm để chọn dòng này")}
                            </span>
                          </button>
                          <IconButton
                            variant="ghost"
                            size="sm-icon"
                            onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                            label={`Xóa dòng ${index + 1}`}
                            title="Xóa dòng"
                            className="text-muted-foreground hover:text-red-700 dark:hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-3 pl-8 @2xl/page:grid-cols-[110px_150px_minmax(0,1fr)]">
                          <div>
                            <label htmlFor={`po-qty-${line.key}`} className="mb-1 block text-[12px] text-muted-foreground">Số lượng, cuốn</label>
                            <Input id={`po-qty-${line.key}`} type="number" min={1} value={line.ordered_qty} onChange={(e) => updateLine(line.key, { ordered_qty: Number(e.target.value) })} className="tabular-nums" />
                          </div>
                          <div>
                            <label htmlFor={`po-cost-${line.key}`} className="mb-1 block text-[12px] text-muted-foreground">Đơn giá, VND</label>
                            <Input id={`po-cost-${line.key}`} type="number" min={0} {...zeroFieldProps} value={line.unit_cost} onChange={(e) => updateLine(line.key, { unit_cost: Number(numberInputValue(e)) })} className="tabular-nums" />
                          </div>
                          <div className="col-span-2 @2xl/page:col-span-1">
                            <label htmlFor={`po-line-note-${line.key}`} className="mb-1 block text-[12px] text-muted-foreground">Ghi chú dòng</label>
                            <Input id={`po-line-note-${line.key}`} value={line.note || ""} onChange={(e) => updateLine(line.key, { note: e.target.value })} placeholder="Không bắt buộc" />
                          </div>
                        </div>
                        <p className="mt-2 pl-8 text-[12px] tabular-nums text-muted-foreground">Thành tiền {formatCurrency(lineTotal)}</p>
                      </li>
                    );
                  })}
                </ol>
              )}

              <Button type="button" variant="outline" className="mt-4 gap-2" onClick={() => setLines((current) => [...current, newLine()])}>
                <Plus className="h-3.5 w-3.5" />
                Thêm dòng
              </Button>
            </section>
          </div>

          <aside aria-labelledby="po-summary-title" className="rounded-2xl border border-border bg-card p-5 @4xl/page:sticky @4xl/page:top-4">
            <h2 id="po-summary-title" className="font-display text-[18px] font-semibold tracking-tight">Tóm tắt đơn</h2>
            <dl className="mt-3 space-y-2.5 text-[13px]">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Nhà cung cấp</dt><dd className="text-right text-foreground">{supplierName || "Chưa chọn"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Kho nhận</dt><dd className="text-right text-foreground">{warehouseName ? warehouseName.code : "Chưa chọn"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Dòng đã chọn sách</dt><dd className="text-right tabular-nums text-foreground">{pickedLines} / {lines.length}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Tổng số cuốn</dt><dd className="text-right tabular-nums text-foreground">{totalQty.toLocaleString("vi-VN")}</dd></div>
            </dl>
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-[13px] text-muted-foreground">Tạm tính, VND</p>
              <p className="font-display text-[28px] font-semibold leading-tight tabular-nums text-foreground">{Number(totalAmount || 0).toLocaleString("vi-VN")}</p>
            </div>
            <Button onClick={() => void save()} loading={saving} className="mt-4 w-full gap-2">
              <Save className="h-3.5 w-3.5" />
              {saving ? "Đang lưu..." : isEdit ? "Lưu thay đổi" : "Lưu đơn mua hàng"}
            </Button>
          </aside>
        </div>
      </div>
    </div>
  );
}
