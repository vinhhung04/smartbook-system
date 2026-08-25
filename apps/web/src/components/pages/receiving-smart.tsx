import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Image,
  Loader2,
  Search,
  Upload,
  X,
  AlertTriangle,
  Edit3,
} from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { warehouseService } from "@/services/warehouse";
import { aiService } from "@/services/ai";
import { authService } from "@/services/auth";
import { receivingSmartService, MatchResult, SmartReceivingDraft } from "@/services/receiving-smart";
import { getApiErrorMessage } from "@/services/api";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { PageHeader } from "../ui/page-header";
import { StatusBadge } from "@/components/status-badge";

interface WarehouseOption {
  id: string;
  code?: string;
  name: string;
}

type MatchStatus = "MATCHED" | "LOW_CONFIDENCE" | "UNMATCHED" | "MANUAL_CORRECTED";

const statusConfig: Record<MatchStatus, { label: string; color: string; bg: string }> = {
  MATCHED: { label: "Khớp", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
  LOW_CONFIDENCE: { label: "Khớp thấp", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-500/10" },
  UNMATCHED: { label: "Không khớp", color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-500/10" },
  MANUAL_CORRECTED: { label: "Đã sửa", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-500/10" },
};

function formatCurrency(value: number): string {
  return `${value.toLocaleString("vi-VN")} VND`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleDateString("vi-VN");
  } catch {
    return dateStr;
  }
}

export function SmartReceivingPage() {
  const [step, setStep] = useState<"upload" | "review" | "draft">("upload");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Extraction result
  const [extractedData, setExtractedData] = useState<{
    supplier_name?: string;
    invoice_number?: string;
    invoice_date?: string;
    line_items: Array<{
      title: string;
      isbn: string | null;
      quantity: number;
      unit_price: number;
    }>;
  } | null>(null);

  // Match results
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [matchSummary, setMatchSummary] = useState<{
    total: number;
    matched: number;
    low_confidence: number;
    unmatched: number;
  } | null>(null);

  // Draft
  const [createdDraft, setCreatedDraft] = useState<SmartReceivingDraft | null>(null);

  // Edit item modal
  const [editingItem, setEditingItem] = useState<{ index: number; result: MatchResult } | null>(null);
  const editingItemModalRef = useRef<HTMLDivElement>(null);
  const closeEditingItem = () => setEditingItem(null);
  useDialogA11y(Boolean(editingItem), closeEditingItem, editingItemModalRef);

  // Load warehouses on mount
  useEffect(() => {
    const loadWarehouses = async () => {
      try {
        setIsLoading(true);
        const data = await warehouseService.getAll();
        const rows = (Array.isArray(data) ? data : []).map((w: any) => ({
          id: w.id,
          code: w.code,
          name: w.name,
        }));
        setWarehouses(rows);
        if (rows.length > 0 && !selectedWarehouse) {
          setSelectedWarehouse(rows[0].id);
        }
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không tải được danh sách kho"));
      } finally {
        setIsLoading(false);
      }
    };
    void loadWarehouses();
  }, [selectedWarehouse]);

  // Handle file selection
  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast.error("Vui lòng chọn file hình ảnh (JPG, PNG, WebP) hoặc PDF");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File quá lớn. Vui lòng chọn file nhỏ hơn 10MB");
      return;
    }
    setSelectedFile(file);

    // Generate preview
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFilePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Scan receipt
  const handleScanReceipt = async () => {
    if (!selectedFile || !selectedWarehouse) {
      toast.error("Vui lòng chọn kho và file hình ảnh");
      return;
    }

    setIsExtracting(true);
    try {
      const result = await aiService.scanReceipt(selectedFile);

      if (!result.success) {
        toast.error(result.error || "Không thể trích xuất dữ liệu từ hình ảnh");
        return;
      }

      setExtractedData({
        supplier_name: result.supplier_name,
        invoice_number: result.invoice_number,
        invoice_date: result.invoice_date,
        line_items: result.line_items,
      });

      // Auto-match items
      setIsMatching(true);
      try {
        const matchResponse = await receivingSmartService.matchItems(result.line_items, selectedWarehouse);
        setMatchResults(matchResponse.results);
        setMatchSummary(matchResponse.summary);
        setStep("review");
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Lỗi khi khớp items với catalog"));
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Lỗi khi quét hóa đơn"));
    } finally {
      setIsExtracting(false);
      setIsMatching(false);
    }
  };

  // Create draft
  const handleCreateDraft = async () => {
    if (!selectedWarehouse || !extractedData || matchResults.length === 0) {
      toast.error("Thiếu thông tin để tạo phiếu");
      return;
    }

    setIsCreatingDraft(true);
    try {
      const user_id = authService.getCurrentUser()?.id;
      if (!user_id) {
        toast.error("Khong tim thay nguoi dung dang nhap");
        return;
      }

      const response = await receivingSmartService.createDraft({
        warehouse_id: selectedWarehouse,
        supplier_name: extractedData.supplier_name || undefined,
        invoice_number: extractedData.invoice_number || undefined,
        invoice_date: extractedData.invoice_date || undefined,
        raw_extraction: extractedData as any,
        source_file_name: selectedFile?.name,
        source_file_type: selectedFile?.type,
        items: matchResults.map((r) => ({
          title: r.title,
          isbn: r.isbn || undefined,
          quantity: r.quantity,
          unit_price: r.unit_price,
          matched_variant_id: r.matched_variant_id,
          match_strategy: r.match_strategy,
          match_confidence: r.match_confidence,
          match_status: r.match_status,
        })),
        user_id,
      });

      if (response.success) {
        setCreatedDraft(response.draft as any);
        setStep("draft");
        toast.success("Đã tạo phiếu nhập thông minh thành công!");
      } else {
        toast.error("Lỗi khi tạo phiếu");
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Lỗi khi tạo phiếu"));
    } finally {
      setIsCreatingDraft(false);
    }
  };

  // Handle item correction
  const handleEditItem = (index: number, result: MatchResult) => {
    setEditingItem({ index, result });
  };

  const handleSaveItemEdit = () => {
    if (!editingItem) return;

    if (!editingItem.result.matched_variant_id) {
      toast.error("Không thể xác nhận dòng chưa khớp với biến thể sách. Vui lòng tạo/sửa sách trong catalog trước.");
      return;
    }

    setMatchResults((prev) =>
      prev.map((r, i) =>
        i === editingItem.index
          ? {
              ...r,
              match_status: "MANUAL_CORRECTED" as const,
            }
          : r
      )
    );

    // Update summary
    setMatchSummary((prev) => {
      if (!prev) return prev;
      const oldStatus = matchResults[editingItem.index]?.match_status;
      const updated = { ...prev };
      if (oldStatus === "LOW_CONFIDENCE") {
        updated.low_confidence = Math.max(0, updated.low_confidence - 1);
        updated.matched += 1;
      } else if (oldStatus === "UNMATCHED") {
        updated.unmatched = Math.max(0, updated.unmatched - 1);
        updated.matched += 1;
      }

      return updated;
    });

    setEditingItem(null);
    toast.success("Đã cập nhật item");
  };

  // Render upload step
  const renderUploadStep = () => (
    <div className="space-y-6">
      {/* Warehouse selection */}
      <div className="bg-card rounded-lg border border-border p-4">
        <label className="block text-sm font-medium text-foreground mb-2">Kho nhập hàng</label>
        <select
          value={selectedWarehouse}
          onChange={(e) => setSelectedWarehouse(e.target.value)}
          className="w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={isLoading}
        >
          <option value="">-- Chọn kho --</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code ? `${w.code} - ` : ""}
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {/* Upload area */}
      <div
        className="border-2 border-dashed border-border rounded-xl p-8 text-center transition-colors hover:border-blue-400 dark:hover:border-blue-500 bg-muted/40"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {selectedFile ? (
          <div className="space-y-4">
            {filePreview ? (
              <img
                src={filePreview}
                alt="Preview"
                className="max-h-64 mx-auto rounded-lg shadow-md"
              />
            ) : (
              <div className="flex items-center justify-center w-16 h-16 mx-auto bg-blue-100 dark:bg-blue-500/15 rounded-full">
                <FileText className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
            )}
            <div>
              <p className="font-medium text-foreground">{selectedFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <button
              onClick={() => {
                setSelectedFile(null);
                setFilePreview(null);
              }}
              className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-400 text-sm"
            >
              Xóa file
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center w-16 h-16 mx-auto bg-blue-100 dark:bg-blue-500/15 rounded-full mb-4">
              <Upload className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            <p className="text-lg font-medium text-foreground mb-2">
              Tải lên hình ảnh hóa đơn / phiếu giao hàng
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              Hỗ trợ JPG, PNG, WebP, PDF (tối đa 10MB)
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Chọn file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />
          </>
        )}
      </div>

      {/* Scan button */}
      <button
        onClick={handleScanReceipt}
        disabled={!selectedFile || !selectedWarehouse || isExtracting}
        className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
      >
        {isExtracting ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            {isMatching ? "Đang quét và khớp dữ liệu..." : "Đang quét hình ảnh..."}
          </>
        ) : (
          <>
            <Camera className="w-5 h-5" />
            Quét hóa đơn bằng AI
          </>
        )}
      </button>
    </div>
  );

  // Render review step
  const renderReviewStep = () => (
    <div className="space-y-6">
      {/* Invoice info */}
      {extractedData && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="font-medium text-foreground mb-3">Thông tin hóa đơn</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Nhà cung cấp:</span>
              <p className="font-medium text-foreground">{extractedData.supplier_name || "-"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Số hóa đơn:</span>
              <p className="font-medium text-foreground">{extractedData.invoice_number || "-"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Ngày:</span>
              <p className="font-medium text-foreground">{formatDate(extractedData.invoice_date)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Summary badges */}
      {matchSummary && (
        <div className="flex gap-3 flex-wrap">
          <StatusBadge label={`${matchSummary.matched} khớp chính xác`} variant="success" />
          {matchSummary.low_confidence > 0 && (
            <StatusBadge label={`${matchSummary.low_confidence} khớp thấp`} variant="warning" />
          )}
          {matchSummary.unmatched > 0 && (
            <StatusBadge label={`${matchSummary.unmatched} không khớp`} variant="danger" />
          )}
        </div>
      )}

      {/* Items table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">#</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tên sách</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">ISBN</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">SL</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Đơn giá</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Trạng thái</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Khớp với</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {matchResults.map((result, index) => {
                const status = statusConfig[result.match_status as MatchStatus] || statusConfig.UNMATCHED;
                return (
                  <tr key={index} className="hover:bg-muted/50">
                    <td className="px-4 py-3 text-muted-foreground">{index + 1}</td>
                    <td className="px-4 py-3 font-medium text-foreground max-w-[200px] truncate">
                      {result.title || "-"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{result.isbn || "-"}</td>
                    <td className="px-4 py-3 text-right">{result.quantity}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {result.unit_price > 0 ? formatCurrency(result.unit_price) : "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.bg} ${status.color}`}
                      >
                        {result.match_status === "MATCHED" && <Check className="w-3 h-3" />}
                        {result.match_status === "LOW_CONFIDENCE" && <AlertTriangle className="w-3 h-3" />}
                        {result.match_status === "UNMATCHED" && <X className="w-3 h-3" />}
                        {result.match_status === "MANUAL_CORRECTED" && <Edit3 className="w-3 h-3" />}
                        {status.label}
                        {result.match_confidence > 0 && (
                          <span className="text-xs opacity-75">
                            ({Math.round(result.match_confidence * 100)}%)
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[150px] truncate">
                      {result.matched_variant ? result.matched_variant.book_title || result.matched_variant.sku : "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleEditItem(index, result)}
                        disabled={!result.matched_variant_id}
                        aria-label={result.matched_variant_id ? "Sửa" : "Chưa có biến thể khớp"}
                        className="p-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent"
                        title={result.matched_variant_id ? "Sửa" : "Chưa có biến thể khớp"}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => {
            setStep("upload");
            setMatchResults([]);
            setMatchSummary(null);
            setExtractedData(null);
          }}
          className="flex-1 py-3 px-4 border border-border text-foreground rounded-lg font-medium hover:bg-muted transition-colors flex items-center justify-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Quay lại
        </button>
        <button
          onClick={handleCreateDraft}
          disabled={isCreatingDraft || matchSummary?.matched === 0}
          className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
        >
          {isCreatingDraft ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Đang tạo phiếu...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5" />
              Tạo phiếu nhập ({matchSummary?.matched || 0} items)
            </>
          )}
        </button>
      </div>

      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-item-modal-title">
          <div ref={editingItemModalRef} className="w-full max-w-md rounded-xl bg-card border border-border p-5 shadow-xl">
            <h3 id="edit-item-modal-title" className="text-base font-semibold text-foreground">Xác nhận item đã sửa</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Đánh dấu dòng "{editingItem.result.title || "-"}" là đã được kiểm tra thủ công.
              Dòng này sẽ được tính là hợp lệ khi tạo phiếu nháp.
            </p>
            <div className="mt-4 rounded-lg bg-muted p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">ISBN</span>
                <span className="font-mono">{editingItem.result.isbn || "-"}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-muted-foreground">Số lượng</span>
                <span>{editingItem.result.quantity}</span>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveItemEdit}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Xác nhận đã sửa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Render draft step
  const renderDraftStep = () => (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-emerald-100 dark:bg-emerald-500/15 rounded-full flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">
          Đã tạo phiếu nhập thông minh!
        </h2>
        <p className="text-muted-foreground mb-4">
          Phiếu đang ở trạng thái <span className="font-medium text-blue-600 dark:text-blue-400">DRAFT</span>. Vui lòng
          xem lại và xác nhận để hoàn tất.
        </p>
        {createdDraft && (
          <div className="bg-muted rounded-lg p-4 text-left space-y-2 mb-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mã phiếu:</span>
              <span className="font-mono font-medium">{createdDraft.id.slice(0, 8)}...</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Số items:</span>
              <span className="font-medium">{createdDraft.smart_receiving_items?.length || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ngày tạo:</span>
              <span className="font-medium">{formatDate(createdDraft.created_at)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <NavLink
          to="/goods-receipt"
          className="flex-1 py-3 px-4 border border-border text-foreground rounded-lg font-medium hover:bg-muted transition-colors text-center"
        >
          Xem danh sách phiếu nhập
        </NavLink>
        <button
          onClick={() => {
            setStep("upload");
            setMatchResults([]);
            setMatchSummary(null);
            setExtractedData(null);
            setCreatedDraft(null);
            setSelectedFile(null);
            setFilePreview(null);
          }}
          className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 transition-all flex items-center justify-center gap-2"
        >
          <Image className="w-4 h-4" />
          Tạo phiếu mới
        </button>
      </div>
    </div>
  );

  return (
    <PageWrapper>
      <PageHeader
        title="Nhập hàng thông minh (AI)"
        description="Quét hóa đơn và tự động khớp với danh mục sách"
        breadcrumbs={[
          { label: "Kho", href: "/inventory" },
          { label: "Nhập hàng thông minh", href: "/receiving-smart" },
        ]}
      />

      {/* Step indicators */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {["upload", "review", "draft"].map((s, i) => (
          <div key={s} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                step === s
                  ? "bg-blue-600 text-white"
                  : ["upload", "review", "draft"].indexOf(step) > i
                    ? "bg-emerald-600 text-white"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {["upload", "review", "draft"].indexOf(step) > i ? (
                <Check className="w-4 h-4" />
              ) : (
                i + 1
              )}
            </div>
            {i < 2 && (
              <ChevronRight className="w-4 h-4 mx-2 text-muted-foreground" />
            )}
          </div>
        ))}
      </div>

      <FadeItem>
        {step === "upload" && renderUploadStep()}
        {step === "review" && renderReviewStep()}
        {step === "draft" && renderDraftStep()}
      </FadeItem>
    </PageWrapper>
  );
}
