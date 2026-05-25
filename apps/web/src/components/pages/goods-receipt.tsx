import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { NavLink, useNavigate, useSearchParams } from "react-router";
import { AlertCircle, ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, Plus, ScanBarcode, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { warehouseService } from "@/services/warehouse";
import { bookService } from "@/services/book";
import { goodsReceiptService } from "@/services/goods-receipt";
import { supplierDeliveryService, type SupplierDeliveryDetail } from "@/services/supplier-delivery";
import { getApiErrorMessage } from "@/services/api.ts";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { authService } from "@/services/auth";

interface WarehouseOption {
  id: string;
  code?: string;
  name: string;
}

interface ReceiptItemForm {
  id: string;
  isbn13: string;
  variant_id?: string;
  title: string;
  qty: number;
  unit_cost: number;
  is_new_book?: boolean;
}

function normalizeIsbn13(value: string): string {
  return String(value || "").trim().replace(/[^0-9]/g, "");
}

function formatCurrency(value: number): string {
  return `${value.toLocaleString("vi-VN")} VND`;
}

function makeRowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function GoodsReceiptPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const supplierDeliveryInvoiceId = searchParams.get("supplier_delivery_invoice_id");
  const currentUser = authService.getCurrentUser();
  const currentUserRoles = (currentUser?.roles || []).map((role) => role.toUpperCase());
  const canManageReceiving = Boolean(currentUser?.is_superuser) || currentUserRoles.includes("ADMIN") || currentUserRoles.includes("MANAGER");
  const [receivingMode, setReceivingMode] = useState<"supplier" | "manual">(canManageReceiving ? "supplier" : "manual");
  const [step, setStep] = useState<"warehouse" | "scan" | "review">("warehouse");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [supplierDeliveries, setSupplierDeliveries] = useState<SupplierDeliveryDetail[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [isbn13Input, setIsbn13Input] = useState("");
  const [items, setItems] = useState<ReceiptItemForm[]>([]);
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [showNewBookModal, setShowNewBookModal] = useState(false);
  const [pendingIsbn13, setPendingIsbn13] = useState("");
  const [pendingTitle, setPendingTitle] = useState("");
  const [isCreatingNewBook, setIsCreatingNewBook] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successReceiptNumber, setSuccessReceiptNumber] = useState("");
  const [invoice, setInvoice] = useState<SupplierDeliveryDetail | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [countedQty, setCountedQty] = useState<Record<string, number>>({});

  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (supplierDeliveryInvoiceId) return;
    const loadReceivingContext = async () => {
      try {
        setIsLoading(true);
        if (!canManageReceiving) {
          setReceivingMode("manual");
        }
        const [warehouseRows, deliveryRows] = canManageReceiving
          ? await Promise.all([
              warehouseService.getAll(),
              supplierDeliveryService.getAll(),
            ])
          : await Promise.all([
              warehouseService.getReceivingWarehouses(),
              Promise.resolve({ data: [] }),
            ]);
        const rows = (Array.isArray(warehouseRows) ? warehouseRows : []).map((warehouse: any) => ({
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
        }));
        setWarehouses(rows);
        setSupplierDeliveries(Array.isArray(deliveryRows.data) ? deliveryRows.data : []);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc du lieu nhap kho"));
      } finally {
        setIsLoading(false);
      }
    };

    void loadReceivingContext();
  }, [canManageReceiving, supplierDeliveryInvoiceId]);

  useEffect(() => {
    if (!supplierDeliveryInvoiceId) return;
    const loadInvoice = async () => {
      try {
        setInvoiceLoading(true);
        const response = await supplierDeliveryService.getById(supplierDeliveryInvoiceId);
        setInvoice(response.data);
        const nextQty: Record<string, number> = {};
        response.data.items.forEach((item) => {
          nextQty[item.id] = Math.min(Number(item.invoiced_qty || 0), Number(item.remaining_qty || 0));
        });
        setCountedQty(nextQty);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc supplier invoice"));
      } finally {
        setInvoiceLoading(false);
      }
    };
    void loadInvoice();
  }, [supplierDeliveryInvoiceId]);

  const handleSelectWarehouse = async (warehouseId: string) => {
    setSelectedWarehouse(warehouseId);
    setStep("scan");
  };

  const upsertReceiptItem = (nextItem: Omit<ReceiptItemForm, "id" | "qty"> & { qty?: number }) => {
    const defaultQty = Number(nextItem.qty || 1);

    setItems((prev) => {
      const index = prev.findIndex((item) => item.isbn13 === nextItem.isbn13);
      if (index >= 0) {
        const clone = [...prev];
        clone[index] = {
          ...clone[index],
          qty: clone[index].qty + defaultQty,
          unit_cost: Number(nextItem.unit_cost || clone[index].unit_cost),
        };
        return clone;
      }

      return [
        ...prev,
        {
          id: makeRowId(),
          isbn13: nextItem.isbn13,
          variant_id: nextItem.variant_id,
          title: nextItem.title,
          qty: defaultQty,
          unit_cost: Number(nextItem.unit_cost || 0),
          is_new_book: Boolean(nextItem.is_new_book),
        },
      ];
    });
  };

  const handleCreateIncompleteBook = async () => {
    const isbn13 = normalizeIsbn13(pendingIsbn13);
    const title = pendingTitle.trim();

    if (!/^\d{13}$/.test(isbn13)) {
      toast.error("ISBN13 khong hop le");
      return;
    }

    if (!title) {
      toast.error("Vui long nhap ten sach");
      return;
    }

    try {
      setIsCreatingNewBook(true);
      const created = await bookService.createIncomplete({
        isbn13,
        title,
        price: 0,
        language: "vi",
      });

      const payload = created?.data;
      if (!payload?.variant_id) {
        toast.error("Khong tao duoc sach tam");
        return;
      }

      upsertReceiptItem({
        isbn13,
        variant_id: payload.variant_id,
        title: payload.title || title,
        unit_cost: Number(payload.unit_cost || 0),
        is_new_book: true,
      });

      setPendingIsbn13("");
      setPendingTitle("");
      setShowNewBookModal(false);
      setIsbn13Input("");
      scanInputRef.current?.focus();
      toast.success("Da tao sach tam va them vao phieu nhap");
    } catch (createError) {
      toast.error(getApiErrorMessage(createError, "Khong tao duoc sach tam"));
    } finally {
      setIsCreatingNewBook(false);
    }
  };

  const handleAddBarcode = async (input?: string) => {
    const isbn13 = normalizeIsbn13(input ?? isbn13Input);
    if (!isbn13) {
      toast.error("Vui long quet hoac nhap ISBN13");
      return;
    }

    if (!/^\d{13}$/.test(isbn13)) {
      toast.error("ISBN13 phai gom dung 13 chu so");
      return;
    }

    if (!selectedWarehouse) {
      toast.error("Vui long chon kho truoc khi nhap sach");
      return;
    }

    try {
      const found = await bookService.findByIsbn13(isbn13);
      upsertReceiptItem({
        isbn13,
        variant_id: found.variant_id,
        title: found.title,
        unit_cost: Number(found.unit_cost || 0),
      });
      toast.success(`Da them: ${found.title}`);
      setIsbn13Input("");
      scanInputRef.current?.focus();
      return;
    } catch (error) {
      const message = getApiErrorMessage(error, "Barcode lookup that bai");

      if (!/not found/i.test(message)) {
        toast.error(message);
        return;
      }

      setPendingIsbn13(isbn13);
      setPendingTitle(`Sach ${isbn13}`);
      setShowNewBookModal(true);
    }
  };

  const updateItem = (id: string, field: keyof ReceiptItemForm, value: string | number) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((row) => row.id !== id));
  };

  const totalQty = useMemo(() => items.reduce((sum, item) => sum + Number(item.qty || 0), 0), [items]);
  const totalValue = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unit_cost || 0), 0),
    [items],
  );

  const invoiceTotalQty = useMemo(() => {
    if (!invoice) return 0;
    return invoice.items.reduce((sum, item) => sum + Number(countedQty[item.id] || 0), 0);
  }, [countedQty, invoice]);

  const createFromInvoice = async () => {
    if (!invoice || !supplierDeliveryInvoiceId) return;
    const payloadItems = invoice.items
      .filter((item) => Number(countedQty[item.id] || 0) > 0)
      .map((item) => ({
        invoice_item_id: item.id,
        purchase_order_item_id: item.purchase_order_item_id,
        variant_id: item.variant_id,
        delivered_qty: Number(countedQty[item.id] || 0),
        unit_cost: item.unit_cost,
        location_id: null,
        note: Number(countedQty[item.id] || 0) < item.remaining_qty ? "Supplier delivered short" : null,
      }));
    if (payloadItems.length === 0) {
      toast.error("Nhap it nhat mot dong hang thuc nhan");
      return;
    }
    try {
      setInvoiceSaving(true);
      const response = await supplierDeliveryService.createGoodsReceiptFromInvoice(supplierDeliveryInvoiceId, {
        warehouse_id: invoice.warehouse_id || "",
        note: `Receive supplier invoice ${invoice.invoice_number}`,
        items: payloadItems,
      });
      toast.success(`Da tao GR ${response.data.receipt_number} o trang thai DRAFT`);
      navigate(`/orders/${response.data.id}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tao goods receipt tu invoice that bai"));
    } finally {
      setInvoiceSaving(false);
    }
  };
  const handleCreateDraftReceipt = async () => {
    if (!selectedWarehouse) {
      toast.error("Vui long chon kho");
      return;
    }
    if (!items.length) {
      toast.error("Phieu nhap chua co sach");
      return;
    }
    if (items.some((item) => !Number.isFinite(item.qty) || item.qty <= 0)) {
      toast.error("So luong phai lon hon 0");
      return;
    }

    try {
      setIsSaving(true);
      const created = await goodsReceiptService.create({
        warehouse_id: selectedWarehouse,
        note: note || undefined,
        items: items.map((item) => ({
          variant_id: item.variant_id,
          isbn13: item.isbn13,
          location_id: null,
          quantity: Number(item.qty),
          unit_cost: Number(item.unit_cost),
          is_new_book: item.is_new_book,
        })),
      });

      setSuccessReceiptNumber(created?.data?.receipt_number || "");
      setShowSuccess(true);
      setShowConfirmModal(false);
      toast.success("Da tao phieu nhap o trang thai DRAFT");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tao phieu nhap that bai"));
    } finally {
      setIsSaving(false);
    }
  };

  if (showSuccess) {
    return (
      <PageWrapper>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex min-h-[60vh] flex-col items-center justify-center gap-5"
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <div className="text-center">
            <h2 className="mb-1 text-[28px] font-bold tracking-[-0.02em]">Da tao phieu nhap thanh cong</h2>
            <p className="text-[14px] text-slate-500">
              Phieu {successReceiptNumber || "(chua co ma)"} dang o trang thai DRAFT va cho duyet.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <NavLink
              to={canManageReceiving ? "/orders" : "/my-warehouse-tasks"}
              className="rounded-[10px] bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-[13px] font-semibold text-white"
            >
              {canManageReceiving ? "Ve danh sach phieu" : "Ve task cua toi"}
            </NavLink>
            <button
              onClick={() => window.location.reload()}
              className="rounded-[10px] border border-slate-200 bg-white px-5 py-2.5 text-[13px] font-semibold text-slate-700"
            >
              Tao phieu moi
            </button>
          </div>
        </motion.div>
      </PageWrapper>
    );
  }

  if (supplierDeliveryInvoiceId) {
    if (invoiceLoading) {
      return <PageWrapper><div className="rounded-[12px] border border-slate-200 bg-white p-5 text-[13px] text-slate-500">Dang tai supplier invoice...</div></PageWrapper>;
    }

    if (!invoice) {
      return (
        <PageWrapper>
          <NavLink to="/purchase-orders" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-blue-600">
            <ArrowLeft className="h-3.5 w-3.5" /> Quay lai
          </NavLink>
          <div className="rounded-[12px] border border-slate-200 bg-white p-5 text-[13px] text-slate-500">Khong tim thay supplier invoice.</div>
        </PageWrapper>
      );
    }

    return (
      <PageWrapper className="space-y-5">
        <FadeItem>
          <NavLink to={`/purchase-orders/${invoice.purchase_order_id}`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-blue-600">
            <ArrowLeft className="h-3.5 w-3.5" /> Quay lai Purchase Order
          </NavLink>
        </FadeItem>

        <FadeItem>
          <div className="flex flex-col gap-1">
            <h1 className="tracking-[-0.02em]">Receive Supplier Delivery</h1>
            <p className="text-[13px] text-slate-500">
              {invoice.po_number || "-"} - {invoice.supplier_name || "-"} - Invoice {invoice.invoice_number}
            </p>
          </div>
        </FadeItem>

        <FadeItem>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-[12px] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Warehouse</p>
              <p className="mt-1 text-[13px] font-semibold">{invoice.warehouse_code || "-"} - {invoice.warehouse_name || ""}</p>
            </div>
            <div className="rounded-[12px] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Invoice status</p>
              <p className="mt-1 text-[13px] font-semibold">{invoice.status}</p>
            </div>
            <div className="rounded-[12px] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Counted qty</p>
              <p className="mt-1 text-[18px] font-bold">{invoiceTotalQty}</p>
            </div>
            <div className="rounded-[12px] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Expected delivery</p>
              <p className="mt-1 text-[13px] font-semibold">{invoice.expected_delivery_date ? new Date(invoice.expected_delivery_date).toLocaleDateString("vi-VN") : "-"}</p>
            </div>
          </div>
        </FadeItem>

        <FadeItem>
          <div className="overflow-hidden rounded-[12px] border border-slate-200 bg-white">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  {["Title", "ISBN/SKU", "Ordered", "Previously received", "Remaining", "Invoiced", "Staff counted", "Shortage", "Status"].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => {
                  const qty = Number(countedQty[item.id] || 0);
                  const shortage = Math.max(0, Number(item.remaining_qty || 0) - qty);
                  const over = qty > Number(item.remaining_qty || 0);
        const invoiceOver = qty > Number(item.invoiced_qty || 0);
        const status = over || invoiceOver ? "OVER_BLOCKED" : shortage > 0 ? "SHORTAGE" : "MATCHED";
                  return (
                    <tr key={item.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 text-[13px] font-semibold">{item.title || "-"}</td>
                      <td className="px-4 py-3 font-mono text-[12px] text-slate-500">{item.isbn13 || item.sku || item.variant_id}</td>
                      <td className="px-4 py-3 text-[13px]">{item.ordered_qty}</td>
                      <td className="px-4 py-3 text-[13px]">{item.previously_received_qty}</td>
                      <td className="px-4 py-3 text-[13px]">{item.remaining_qty}</td>
                      <td className="px-4 py-3 text-[13px]">{item.invoiced_qty}</td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min={0}
                          max={Math.min(item.remaining_qty, item.invoiced_qty)}
                          value={qty}
                          onChange={(event) => {
                            const max = Math.min(Number(item.remaining_qty || 0), Number(item.invoiced_qty || 0));
                            const next = Math.min(max, Math.max(0, Number(event.target.value) || 0));
                            setCountedQty((current) => ({ ...current, [item.id]: next }));
                          }}
                          className="w-24 rounded-[8px] border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-blue-400"
                        />
                      </td>
                      <td className="px-4 py-3 text-[13px]">{shortage}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${status === "MATCHED" ? "bg-emerald-50 text-emerald-700" : status === "SHORTAGE" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>
                          {status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </FadeItem>

        {invoice.items.some((item) => Number(countedQty[item.id] || 0) < item.remaining_qty) ? (
          <FadeItem>
            <div className="flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 text-amber-600" />
              <p className="text-[13px] text-amber-800">Shortage will be reported to supplier for lines counted below remaining quantity.</p>
            </div>
          </FadeItem>
        ) : null}

        <FadeItem>
          <div className="flex justify-end">
            <button
              onClick={() => void createFromInvoice()}
              disabled={invoiceSaving || invoiceTotalQty <= 0}
              className="rounded-[10px] bg-emerald-600 px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {invoiceSaving ? "Dang tao..." : "Create Goods Receipt Draft"}
            </button>
          </div>
        </FadeItem>
      </PageWrapper>
    );
  }

  const receivableDeliveries = supplierDeliveries.filter((delivery) =>
    ["SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(delivery.status),
  );

  if (canManageReceiving && receivingMode === "supplier") {
    return (
      <PageWrapper className="space-y-5">
        <FadeItem>
          <NavLink
            to="/orders"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 transition-colors hover:text-blue-600"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Quay lai danh sach phieu
          </NavLink>
        </FadeItem>

        <FadeItem>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="tracking-[-0.02em]">Receive Supplier Delivery</h1>
              <p className="mt-1 text-[13px] text-slate-500">Doi chieu PO, phieu giao hang/invoice va so luong nhan thuc te.</p>
            </div>
            <div className="inline-flex rounded-[10px] border border-slate-200 bg-white p-1">
              <button className="inline-flex items-center gap-1.5 rounded-[8px] bg-slate-900 px-3 py-2 text-[12px] font-semibold text-white">
                <Truck className="h-3.5 w-3.5" /> Supplier Delivery
              </button>
              <button
                onClick={() => setReceivingMode("manual")}
                className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                <ScanBarcode className="h-3.5 w-3.5" /> Manual ISBN
              </button>
            </div>
          </div>
        </FadeItem>

        <FadeItem>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[12px] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Ready documents</p>
              <p className="mt-1 text-[20px] font-bold">{receivableDeliveries.length}</p>
            </div>
            <div className="rounded-[12px] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Workflow</p>
              <p className="mt-1 text-[13px] font-semibold">Draft first, post later</p>
            </div>
            <div className="rounded-[12px] border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Validation</p>
              <p className="mt-1 text-[13px] font-semibold">Over-receive blocked</p>
            </div>
          </div>
        </FadeItem>

        <FadeItem>
          <div className="overflow-hidden rounded-[12px] border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
              <ClipboardCheck className="h-4 w-4 text-slate-500" />
              <h2 className="text-[14px] font-semibold">Supplier invoices / delivery notes</h2>
            </div>
            {isLoading ? (
              <div className="p-6 text-[13px] text-slate-500">Dang tai danh sach phieu giao hang...</div>
            ) : receivableDeliveries.length === 0 ? (
              <div className="p-6 text-[13px] text-slate-500">
                Chua co supplier invoice/delivery note nao san sang nhap. Hay gui PO cho supplier va de supplier confirm tao invoice truoc.
              </div>
            ) : (
              <table className="w-full min-w-[920px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {["Invoice", "PO", "Supplier", "Warehouse", "Expected", "Lines", "Status", "Action"].map((heading) => (
                      <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {receivableDeliveries.map((delivery) => (
                    <tr key={delivery.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3.5 text-[13px] font-semibold">{delivery.invoice_number}</td>
                      <td className="px-5 py-3.5 text-[13px]">{delivery.po_number || "-"}</td>
                      <td className="px-5 py-3.5 text-[13px]">{delivery.supplier_name || "-"}</td>
                      <td className="px-5 py-3.5 text-[13px]">{delivery.warehouse_code || delivery.warehouse_name || "-"}</td>
                      <td className="px-5 py-3.5 text-[12px] text-slate-500">
                        {delivery.expected_delivery_date ? new Date(delivery.expected_delivery_date).toLocaleDateString("vi-VN") : "-"}
                      </td>
                      <td className="px-5 py-3.5 text-[13px]">{delivery.items.length}</td>
                      <td className="px-5 py-3.5">
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">{delivery.status}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => navigate(`/supplier-deliveries/${delivery.id}`)}
                          className="inline-flex items-center gap-1.5 rounded-[8px] bg-emerald-600 px-3 py-2 text-[12px] font-semibold text-white"
                        >
                          <ClipboardCheck className="h-3.5 w-3.5" /> Doi chieu & nhap hang
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </FadeItem>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        {canManageReceiving ? (
          <NavLink
            to="/orders"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 transition-colors hover:text-blue-600"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Quay lai danh sach phieu
          </NavLink>
        ) : (
          <NavLink
            to="/my-warehouse-tasks"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 transition-colors hover:text-blue-600"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Quay lai task cua toi
          </NavLink>
        )}
      </FadeItem>

      <FadeItem>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="tracking-[-0.02em]">Nhap kho theo ISBN13</h1>
            <p className="mt-1 text-[13px] text-slate-500">Dung cho phieu nhap thu cong khong gan Purchase Order.</p>
          </div>
          {canManageReceiving ? (
            <div className="inline-flex rounded-[10px] border border-slate-200 bg-white p-1">
              <button
                onClick={() => setReceivingMode("supplier")}
                className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Truck className="h-3.5 w-3.5" /> Supplier Delivery
              </button>
              <button className="inline-flex items-center gap-1.5 rounded-[8px] bg-slate-900 px-3 py-2 text-[12px] font-semibold text-white">
                <ScanBarcode className="h-3.5 w-3.5" /> Manual ISBN
              </button>
            </div>
          ) : null}
        </div>
      </FadeItem>

      {step === "warehouse" ? (
        <FadeItem>
          {isLoading ? (
            <div className="rounded-[12px] border border-slate-200 bg-white p-5 text-[13px] text-slate-500">
              Dang tai danh sach kho...
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {warehouses.map((warehouse) => (
                <button
                  key={warehouse.id}
                  onClick={() => void handleSelectWarehouse(warehouse.id)}
                  className="rounded-[14px] border border-slate-200 bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-blue-300"
                >
                  <h3 className="text-[13px] font-semibold">{warehouse.name}</h3>
                  <p className="mt-1 text-[11px] text-slate-500">{warehouse.code || warehouse.id}</p>
                </button>
              ))}
            </div>
          )}
        </FadeItem>
      ) : null}

      {step === "scan" ? (
        <div className="space-y-5">
          <FadeItem>
            <div className="rounded-[16px] border border-white/80 bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <h3 className="mb-4 text-[14px] font-semibold">Quet ISBN13 hoac nhap thu cong</h3>
              <div className="mb-4 flex items-center gap-2">
                <div className="relative flex-1">
                  <ScanBarcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-500" />
                  <input
                    ref={scanInputRef}
                    value={isbn13Input}
                    onChange={(event) => setIsbn13Input(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleAddBarcode();
                      }
                    }}
                    placeholder="Nhap ISBN13..."
                    className="w-full rounded-[12px] border-2 border-blue-300/30 bg-gradient-to-r from-blue-50/40 to-indigo-50/30 py-3 pl-10 pr-4 text-[13px] outline-none transition-all focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                  />
                </div>
                <button
                  onClick={() => void handleAddBarcode()}
                  className="inline-flex items-center gap-2 rounded-[12px] bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-[13px] font-semibold text-white"
                >
                  <Plus className="h-3.5 w-3.5" /> Them
                </button>
                <button
                  onClick={() => setShowScannerModal(true)}
                  className="rounded-[12px] border border-indigo-200 bg-indigo-50 px-4 py-3 text-[13px] font-semibold text-indigo-700"
                >
                  Quet camera
                </button>
              </div>
              <p className="text-[11px] text-slate-500">Neu ISBN13 chua co, he thong se tao sach tam de bo sung sau.</p>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="overflow-hidden rounded-[16px] border border-white/80 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <div className="border-b border-slate-100 px-6 py-4">
                <h3 className="text-[14px] font-semibold">Danh sach nhap ({items.length})</h3>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {items.length === 0 ? (
                  <p className="px-6 py-8 text-[13px] text-slate-400">Chua co dong sach nao.</p>
                ) : null}

                {items.map((item) => (
                  <div key={item.id} className="border-b border-slate-50 p-4 last:border-0">
                    <div className="mb-3 flex items-start gap-4">
                      <div className="flex-1">
                        <p className="mb-0.5 font-mono text-[12px] text-slate-400">ISBN13: {item.isbn13}</p>
                        <p className="text-[13px] font-semibold">{item.title}</p>
                        {item.is_new_book ? (
                          <p className="mt-1 text-[11px] text-amber-600">Sach tam (INCOMPLETE) - can bo sung metadata sau.</p>
                        ) : null}
                      </div>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="rounded-[8px] p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500">So luong</label>
                        <input
                          value={item.qty}
                          onChange={(event) => updateItem(item.id, "qty", Number(event.target.value) || 0)}
                          type="number"
                          min={1}
                          className="w-full rounded-[6px] border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-blue-300 focus:ring-[2px] focus:ring-blue-500/15"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500">Gia nhap</label>
                        <input
                          value={item.unit_cost}
                          onChange={(event) => updateItem(item.id, "unit_cost", Number(event.target.value) || 0)}
                          type="number"
                          min={0}
                          className="w-full rounded-[6px] border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-blue-300 focus:ring-[2px] focus:ring-blue-500/15"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="rounded-[16px] border border-white/80 bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <label className="mb-1 block text-[12px] font-semibold text-slate-500">Ghi chu</label>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                className="w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px] outline-none transition-all focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                placeholder="Ghi chu them cho phieu nhap"
              />
            </div>
          </FadeItem>

          <FadeItem>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep("warehouse")}
                className="rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700"
              >
                Quay lai
              </button>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[11px] text-slate-400">Tong gia tri</p>
                  <p className="text-[16px] font-bold text-blue-700">{formatCurrency(totalValue)}</p>
                </div>
                <button
                  onClick={() => setStep("review")}
                  className="rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-[13px] font-semibold text-white"
                >
                  Review
                </button>
              </div>
            </div>
          </FadeItem>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="space-y-4">
          <FadeItem>
            <div className="flex items-start gap-3 rounded-[12px] border border-amber-200/60 bg-amber-50 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <p className="text-[12px] font-semibold text-amber-800">Thong bao</p>
                <p className="mt-0.5 text-[11px] text-amber-700">Vi tri kho se duoc phan bo tai buoc Putaway sau khi phieu duoc duyet.</p>
              </div>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="overflow-hidden rounded-[16px] border border-white/80 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-gradient-to-r from-blue-50/30 to-transparent">
                    {["Ten sach", "Vi tri", "So luong", "Gia nhap", "Thanh tien"].map((header) => (
                      <th key={header} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                    {items.map((item) => {
                    const subtotal = Number(item.qty) * Number(item.unit_cost);
                    return (
                      <tr key={item.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-3 text-[12px] font-semibold">{item.title}</td>
                        <td className="px-4 py-3 font-mono text-[12px] text-slate-500">Phan bo sau</td>
                        <td className="px-4 py-3 text-[12px] font-semibold">{item.qty}</td>
                        <td className="px-4 py-3 font-mono text-[12px] text-slate-500">{formatCurrency(item.unit_cost)}</td>
                        <td className="px-4 py-3 font-mono text-[12px] font-semibold">{formatCurrency(subtotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep("scan")}
                className="rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700"
              >
                Quay lai
              </button>
              <button
                onClick={() => setShowConfirmModal(true)}
                disabled={items.length === 0 || isSaving}
                className={`rounded-[10px] px-5 py-2.5 text-[13px] font-semibold text-white transition-all ${
                  items.length > 0
                    ? "bg-gradient-to-r from-emerald-600 to-teal-600"
                    : "cursor-not-allowed bg-slate-300"
                }`}
              >
                {isSaving ? "Dang tao..." : "Tao phieu nhap DRAFT"}
              </button>
            </div>
          </FadeItem>
        </div>
      ) : null}

      <FadeItem>
        <div className="text-[12px] text-slate-500">Tong SL: {totalQty} - Tong gia tri: {formatCurrency(totalValue)}</div>
      </FadeItem>

      {showConfirmModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full max-w-sm rounded-[16px] bg-white p-6 shadow-2xl"
          >
            <h3 className="mb-2 text-[16px] font-semibold">Xac nhan tao phieu nhap</h3>
            <p className="mb-6 text-[13px] text-slate-600">
              Tao phieu nhap DRAFT voi <span className="font-semibold">{items.length} dong</span> va tong gia tri{" "}
              <span className="font-semibold">{formatCurrency(totalValue)}</span>?
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700"
              >
                Huy
              </button>
              <button
                onClick={() => void handleCreateDraftReceipt()}
                disabled={isSaving}
                className="flex flex-1 items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSaving ? "Dang tao" : "Xac nhan"}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}

      {showNewBookModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full max-w-md rounded-[16px] bg-white p-6 shadow-2xl"
          >
            <h3 className="mb-2 text-[16px] font-semibold">Tao sach tam cho ISBN13 moi</h3>
            <p className="mb-4 text-[13px] text-slate-600">
              ISBN13 chua ton tai trong he thong. Vui long nhap ten sach de tao ban ghi INCOMPLETE.
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-slate-500">ISBN13</label>
                <input
                  value={pendingIsbn13}
                  onChange={(event) => setPendingIsbn13(event.target.value)}
                  className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] font-mono outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-slate-500">Ten sach</label>
                <input
                  value={pendingTitle}
                  onChange={(event) => setPendingTitle(event.target.value)}
                  placeholder="Nhap ten sach"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleCreateIncompleteBook();
                    }
                  }}
                  className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-blue-400/60 focus:ring-[3px] focus:ring-blue-500/10"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={() => {
                  setShowNewBookModal(false);
                  setPendingIsbn13("");
                  setPendingTitle("");
                }}
                className="flex-1 rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700"
              >
                Huy
              </button>
              <button
                onClick={() => void handleCreateIncompleteBook()}
                disabled={isCreatingNewBook}
                className="flex flex-1 items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
              >
                {isCreatingNewBook ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isCreatingNewBook ? "Dang tao" : "Tao sach tam"}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}

      <BarcodeScanModal
        isOpen={showScannerModal}
        onClose={() => setShowScannerModal(false)}
        onDetected={(code) => {
          void handleAddBarcode(code);
        }}
        title="Quet ISBN13 de nhap kho"
      />
    </PageWrapper>
  );
}
