import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { ArrowLeft, Plus, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderService, type PurchaseOrderLinePayload, type VariantSearchItem } from "@/services/purchase-order";
import { supplierService, type Supplier } from "@/services/supplier";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import { getApiErrorMessage } from "@/services/api";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";

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
            toast.error("Only DRAFT or REJECTED purchase orders can be edited");
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
        toast.error(getApiErrorMessage(error, "Failed to load purchase order form"));
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
    try {
      const rows = await purchaseOrderService.searchVariants(query);
      setResults(rows);
      if (rows.length === 0) toast.info("No variants found");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Variant search failed"));
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
    if (!supplierId) return "Supplier is required";
    if (!warehouseId) return "Warehouse is required";
    if (lines.length === 0) return "At least one line is required";
    const seen = new Set<string>();
    for (const line of lines) {
      if (!line.variant_id && !line.isbn13) return "Each line needs a selected variant or ISBN";
      if (line.variant_id && seen.has(line.variant_id)) return "Duplicate variant in PO";
      if (line.variant_id) seen.add(line.variant_id);
      if (!Number.isInteger(Number(line.ordered_qty)) || Number(line.ordered_qty) <= 0) return "Ordered qty must be greater than 0";
      if (!Number.isFinite(Number(line.unit_cost)) || Number(line.unit_cost) < 0) return "Unit cost must be >= 0";
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
      toast.success(isEdit ? "Purchase order updated" : "Purchase order created");
      navigate(`/purchase-orders/${response.data.id}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to save purchase order"));
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
        Back
      </NavLink>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{isEdit ? "Edit Purchase Order" : "New Purchase Order"}</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Create an internal PO and submit it for approval before receiving stock.</p>
        </div>
        <Button onClick={() => void save()} disabled={saving}>
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving..." : "Save PO"}
        </Button>
      </div>

      <SectionCard title="Purchase Order Info">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-[13px]">
            <span className="font-medium">Supplier</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2">
              <option value="">Select supplier</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-[13px]">
            <span className="font-medium">Warehouse</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2">
              <option value="">Select warehouse</option>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-[13px]">
            <span className="font-medium">Expected Date</span>
            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2" />
          </label>
          <label className="space-y-1.5 text-[13px]">
            <span className="font-medium">Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" className="w-full rounded-lg border border-input bg-background px-3 py-2" />
          </label>
        </div>
      </SectionCard>

      <SectionCard title="Items" subtitle={`Estimated total: ${formatCurrency(totalAmount)}`}>
        <div className="mb-4 rounded-xl border border-dashed border-input bg-muted/20 p-3">
          <div className="flex flex-col gap-2 md:flex-row">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, SKU or ISBN..." className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-[13px]" />
            <Button type="button" variant="outline" onClick={() => void searchVariants()}>
              <Search className="h-3.5 w-3.5" />
              Search Variant
            </Button>
          </div>
          {results.length > 0 && (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {results.map((variant) => (
                <button key={variant.variant_id} type="button" onClick={() => selectVariant(variant)} className="rounded-lg border border-input bg-card p-3 text-left text-[13px] hover:border-indigo-200 hover:bg-indigo-50 dark:hover:border-indigo-500/30 dark:hover:bg-indigo-500/10">
                  <div className="font-medium">{variant.title}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{variant.isbn13 || variant.sku || variant.barcode || variant.variant_id}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {lines.length === 0 ? (
          <EmptyState variant="no-data" title="No lines" description="Add at least one item line" />
        ) : (
          <div className="space-y-3">
            {lines.map((line, index) => (
              <div key={line.key} className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-[1.5fr_110px_130px_1fr_40px]">
                <button type="button" onClick={() => setActiveLineKey(line.key)} className={`rounded-lg border px-3 py-2 text-left text-[13px] ${activeLineKey === line.key ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10" : "border-input bg-background"}`}>
                  <div className="font-medium">{line.title || `Line ${index + 1}: select variant`}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{line.isbn13 || line.sku || line.variant_id || "Click then search above"}</div>
                </button>
                <input type="number" min={1} value={line.ordered_qty} onChange={(e) => updateLine(line.key, { ordered_qty: Number(e.target.value) })} className="rounded-lg border border-input bg-background px-3 py-2 text-[13px]" placeholder="Qty" />
                <input type="number" min={0} value={line.unit_cost} onChange={(e) => updateLine(line.key, { unit_cost: Number(e.target.value) })} className="rounded-lg border border-input bg-background px-3 py-2 text-[13px]" placeholder="Unit cost" />
                <input value={line.note || ""} onChange={(e) => updateLine(line.key, { note: e.target.value })} className="rounded-lg border border-input bg-background px-3 py-2 text-[13px]" placeholder="Line note" />
                <button type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} className="inline-flex h-10 items-center justify-center rounded-lg border border-red-100 text-red-600 hover:bg-red-50 dark:border-red-500/20 dark:text-red-400 dark:hover:bg-red-500/10" aria-label="Remove line">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, newLine()])}>
            <Plus className="h-3.5 w-3.5" />
            Add line
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
