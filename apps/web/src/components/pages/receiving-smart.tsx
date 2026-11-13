import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  FileText,
  Image,
  Loader2,
  ScanText,
  Search,
  Upload,
  X,
  Edit3,
  FileCheck2,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui/workflow-stepper";
import { cn } from "@/components/ui/utils";
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

const MATCH_STATUS: Record<MatchStatus, { label: string; variant: string }> = {
  MATCHED: { label: "Khớp", variant: "success" },
  LOW_CONFIDENCE: { label: "Khớp thấp", variant: "warning" },
  UNMATCHED: { label: "Không khớp", variant: "danger" },
  MANUAL_CORRECTED: { label: "Đã kiểm tra", variant: "info" },
};

const STEP_ORDER = ["upload", "review", "draft"] as const;
const STEP_META: Record<(typeof STEP_ORDER)[number], { label: string; icon: WorkflowStep["icon"] }> = {
  upload: { label: "Tải hóa đơn", icon: Upload },
  review: { label: "Đối chiếu danh mục", icon: ListChecks },
  draft: { label: "Phiếu nháp", icon: FileCheck2 },
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
  const [isDragging, setIsDragging] = useState(false);

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
    // Load once: re-running on every warehouse pick refetched the whole list each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        toast.error(getApiErrorMessage(error, "Lỗi khi khớp với danh mục sách"));
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
        toast.error("Không tìm thấy người dùng đăng nhập");
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
    toast.success("Đã xác nhận dòng sách");
  };

  const resetToUpload = () => {
    setStep("upload");
    setMatchResults([]);
    setMatchSummary(null);
    setExtractedData(null);
  };

  const stepIndex = STEP_ORDER.indexOf(step);
  const workflowSteps: WorkflowStep[] = STEP_ORDER.map((id, i) => ({
    id,
    ...STEP_META[id],
    status: i < stepIndex || step === "draft" ? "completed" : i === stepIndex ? "active" : "pending",
  }));
  const selectedWarehouseLabel = (() => {
    const w = warehouses.find((item) => item.id === selectedWarehouse);
    return w ? `${w.code ? `${w.code} - ` : ""}${w.name}` : "-";
  })();

  // Render upload step
  const renderUploadStep = () => (
    <SectionCard
      title="Hóa đơn nhà cung cấp"
      subtitle="AI đọc tên sách, ISBN, số lượng và đơn giá, rồi khớp từng dòng với danh mục sách."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="smart-receiving-warehouse" className="text-[13px] font-medium text-foreground">
              Kho nhập hàng
            </label>
            <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse} disabled={isLoading}>
              <SelectTrigger id="smart-receiving-warehouse" className="w-full">
                <SelectValue placeholder={isLoading ? "Đang tải danh sách kho..." : "Chọn kho"} />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.code ? `${w.code} - ` : ""}
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Ảnh chụp thẳng, đủ sáng, thấy rõ cột tên sách và số lượng cho kết quả khớp tốt nhất. Phiếu chỉ được
            tạo ở trạng thái nháp, bạn vẫn kiểm đếm trước khi nhập kho.
          </p>
        </div>

        <div
          className={cn(
            "flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition-colors",
            isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/30",
          )}
          onDrop={(e) => {
            setIsDragging(false);
            handleDrop(e);
          }}
          onDragOver={(e) => {
            handleDragOver(e);
            if (!isDragging) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
        >
          {selectedFile ? (
            <div className="flex w-full flex-col items-center gap-4">
              {filePreview ? (
                <img src={filePreview} alt={`Xem trước ${selectedFile.name}`} className="max-h-56 rounded-lg border border-border object-contain" />
              ) : (
                <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                  <FileText className="size-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-foreground">{selectedFile.name}</p>
                <p className="text-[12px] text-muted-foreground tabular-nums">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  Đổi file
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    setSelectedFile(null);
                    setFilePreview(null);
                  }}
                >
                  <X /> Bỏ file
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Upload className="size-5 text-primary" />
              </div>
              <p className="text-[14px] font-medium text-foreground">Kéo thả ảnh hóa đơn hoặc phiếu giao hàng vào đây</p>
              <p className="mt-1 text-[12px] text-muted-foreground">JPG, PNG, WebP hoặc PDF, tối đa 10 MB</p>
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => fileInputRef.current?.click()}>
                <Image /> Chọn file
              </Button>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] text-muted-foreground" aria-live="polite">
          {!selectedWarehouse
            ? "Chọn kho nhập hàng để tiếp tục."
            : !selectedFile
              ? "Chưa có file hóa đơn."
              : isExtracting
                ? "AI đang đọc hóa đơn, thường mất 10 đến 30 giây."
                : "Sẵn sàng quét."}
        </p>
        <Button
          type="button"
          onClick={handleScanReceipt}
          disabled={!selectedFile || !selectedWarehouse || isExtracting}
        >
          {isExtracting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Camera />}
          {isExtracting ? (isMatching ? "Đang khớp với danh mục..." : "Đang quét hóa đơn...") : "Quét hóa đơn bằng AI"}
        </Button>
      </div>
    </SectionCard>
  );

  // Render review step
  const renderReviewStep = () => (
    <div className="space-y-4">
      <SectionCard
        title="Kết quả đối chiếu"
        subtitle="Kiểm tra các dòng khớp thấp hoặc không khớp trước khi tạo phiếu nháp."
        actions={
          matchSummary ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              <StatusBadge label={`${matchSummary.matched} khớp`} variant="success" />
              {matchSummary.low_confidence > 0 && (
                <StatusBadge label={`${matchSummary.low_confidence} khớp thấp`} variant="warning" />
              )}
              {matchSummary.unmatched > 0 && (
                <StatusBadge label={`${matchSummary.unmatched} không khớp`} variant="danger" />
              )}
            </div>
          ) : null
        }
        noPadding
      >
        {extractedData && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border bg-muted/30 px-5 py-3 text-[13px] lg:grid-cols-4">
            <div className="min-w-0">
              <dt className="text-[12px] text-muted-foreground">Nhà cung cấp</dt>
              <dd className="truncate font-medium text-foreground">{extractedData.supplier_name || "-"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[12px] text-muted-foreground">Số hóa đơn</dt>
              <dd className="truncate font-medium text-foreground">{extractedData.invoice_number || "-"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[12px] text-muted-foreground">Ngày hóa đơn</dt>
              <dd className="font-medium text-foreground tabular-nums">{formatDate(extractedData.invoice_date)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[12px] text-muted-foreground">Kho nhập</dt>
              <dd className="truncate font-medium text-foreground">{selectedWarehouseLabel}</dd>
            </div>
          </dl>
        )}

        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 px-5 text-[12px] text-muted-foreground">#</TableHead>
                <TableHead className="text-[12px] text-muted-foreground">Sách trên hóa đơn</TableHead>
                <TableHead className="text-right text-[12px] text-muted-foreground">Số lượng</TableHead>
                <TableHead className="text-right text-[12px] text-muted-foreground">Đơn giá</TableHead>
                <TableHead className="text-[12px] text-muted-foreground">Kết quả</TableHead>
                <TableHead className="text-[12px] text-muted-foreground">Khớp với</TableHead>
                <TableHead className="w-12 px-5"><span className="sr-only">Thao tác</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matchResults.map((result, index) => {
                const status = MATCH_STATUS[result.match_status as MatchStatus] || MATCH_STATUS.UNMATCHED;
                const confidence = result.match_confidence > 0 ? ` ${Math.round(result.match_confidence * 100)}%` : "";
                return (
                  <TableRow key={index}>
                    <TableCell className="px-5 text-[12px] text-muted-foreground tabular-nums">{index + 1}</TableCell>
                    <TableCell className="max-w-[260px]">
                      <p className="truncate text-[13px] font-medium text-foreground">{result.title || "-"}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{result.isbn || "Không có ISBN"}</p>
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">{result.quantity}</TableCell>
                    <TableCell className="text-right text-[13px] text-muted-foreground tabular-nums">
                      {result.unit_price > 0 ? formatCurrency(result.unit_price) : "-"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={`${status.label}${confidence}`} variant={status.variant} dot />
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-[13px] text-muted-foreground">
                      {result.matched_variant ? result.matched_variant.book_title || result.matched_variant.sku : "-"}
                    </TableCell>
                    <TableCell className="px-5 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm-icon"
                        onClick={() => handleEditItem(index, result)}
                        disabled={!result.matched_variant_id}
                        aria-label={result.matched_variant_id ? `Xác nhận dòng ${index + 1}` : "Chưa có biến thể khớp"}
                        title={result.matched_variant_id ? "Xác nhận đã kiểm tra" : "Chưa có biến thể khớp"}
                      >
                        <Edit3 />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={resetToUpload}>
            <ArrowLeft /> Quét lại
          </Button>
          <Button type="button" onClick={handleCreateDraft} disabled={isCreatingDraft || matchSummary?.matched === 0}>
            {isCreatingDraft ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <CheckCircle2 />}
            {isCreatingDraft ? "Đang tạo phiếu..." : `Tạo phiếu nháp (${matchSummary?.matched || 0} dòng khớp)`}
          </Button>
        </div>
      </SectionCard>

      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-item-modal-title">
          <div ref={editingItemModalRef} className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <h3 id="edit-item-modal-title" className="text-[15px] font-semibold text-foreground">Xác nhận dòng đã kiểm tra</h3>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Đánh dấu dòng "{editingItem.result.title || "-"}" là đã được kiểm tra thủ công. Dòng này sẽ được tính là
              hợp lệ khi tạo phiếu nháp.
            </p>
            <dl className="mt-4 space-y-1 rounded-lg bg-muted p-3 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">ISBN</dt>
                <dd className="font-mono">{editingItem.result.isbn || "-"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Số lượng</dt>
                <dd className="tabular-nums">{editingItem.result.quantity}</dd>
              </div>
            </dl>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingItem(null)}>
                Hủy
              </Button>
              <Button type="button" onClick={handleSaveItemEdit}>
                Xác nhận
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Render draft step
  const renderDraftStep = () => (
    <SectionCard>
      <div className="mx-auto max-w-md py-6 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/15">
          <CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-[18px] font-semibold text-foreground">Đã tạo phiếu nhập nháp</h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Phiếu đang ở trạng thái nháp. Kiểm đếm hàng thực nhận rồi xác nhận để hoàn tất nhập kho.
        </p>
        {createdDraft && (
          <dl className="mt-5 space-y-2 rounded-lg bg-muted/60 p-4 text-left text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Mã phiếu</dt>
              <dd className="font-mono font-medium">{createdDraft.id.slice(0, 8)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Số dòng sách</dt>
              <dd className="font-medium tabular-nums">{createdDraft.smart_receiving_items?.length || 0}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Ngày tạo</dt>
              <dd className="font-medium tabular-nums">{formatDate(createdDraft.created_at)}</dd>
            </div>
          </dl>
        )}
        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <NavLink to="/orders" className={buttonVariants({ variant: "outline" })}>
            Xem phiếu nhập kho
          </NavLink>
          <Button
            type="button"
            onClick={() => {
              resetToUpload();
              setCreatedDraft(null);
              setSelectedFile(null);
              setFilePreview(null);
            }}
          >
            <Image /> Quét hóa đơn khác
          </Button>
        </div>
      </div>
    </SectionCard>
  );

  return (
    <PageWrapper className="space-y-5">
      <PageHeader
        title="Nhập hàng thông minh (AI)"
        description="Quét hóa đơn nhà cung cấp và tự động khớp với danh mục sách"
        icon={ScanText}
      />

      <SectionCard className="px-2 py-4">
        <WorkflowStepper steps={workflowSteps} />
      </SectionCard>

      <FadeItem>
        {step === "upload" && renderUploadStep()}
        {step === "review" && renderReviewStep()}
        {step === "draft" && renderDraftStep()}
      </FadeItem>
    </PageWrapper>
  );
}
