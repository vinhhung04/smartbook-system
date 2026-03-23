import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { NavLink } from "react-router";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Plus, ScanBarcode, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { warehouseService } from "@/services/warehouse";
import { bookService } from "@/services/book";
import { goodsReceiptService } from "@/services/goods-receipt";
import { getApiErrorMessage } from "@/services/api.ts";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";

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
  const [step, setStep] = useState<"warehouse" | "scan" | "review">("warehouse");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
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

  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadWarehouses = async () => {
      try {
        setIsLoading(true);
        const data = await warehouseService.getAll();
        const rows = (Array.isArray(data) ? data : []).map((warehouse: any) => ({
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
        }));
        setWarehouses(rows);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach kho"));
      } finally {
        setIsLoading(false);
      }
    };

    void loadWarehouses();
  }, []);

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
              to="/orders"
              className="rounded-[10px] bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-[13px] font-semibold text-white"
            >
              Ve danh sach phieu
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
        <h1 className="tracking-[-0.02em]">Nhap kho theo ISBN13</h1>
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
