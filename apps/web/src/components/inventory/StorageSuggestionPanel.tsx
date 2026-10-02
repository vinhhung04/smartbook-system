import { useState, useCallback, useEffect } from "react";
import { MapPin, Search, AlertTriangle, CheckCircle2, Package } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSpinner } from "@/components/ui/loading-state";
import { StatusBadge } from "@/components/status-badge";
import { AIRecommendationNotice, DecisionSection, EvidenceList } from "@/components/ai/decision-card";
import { hasPermission } from "@/services/http-clients";
import {
  storageSuggestionService,
  type StorageSuggestion,
  type SuggestionResponse,
} from "@/services/storage-suggestion";
import { getApiErrorMessage } from "@/services/api";
import { storageSuitability } from "@/lib/ai-decision";

interface StorageSuggestionPanelProps {
  warehouseId: string;
  bookId?: string;
  variantId?: string;
  quantity?: number;
  onSelectLocation?: (location: {
    locationId: string;
    locationCode: string;
    zone: string | null;
    shelf: string | null;
    bin: string | null;
  }) => void;
  disabled?: boolean;
  /** Fetch automatically (debounced) whenever warehouse / variant / quantity change. */
  autoRequest?: boolean;
  /** Locations the parent has already put into its allocation lines. */
  selectedLocationIds?: string[];
}

const AUTO_REQUEST_DEBOUNCE_MS = 400;

// Rule-based location ranking (inventory-service storage-suggestion.service.js).
// `confidence` from the API is only a threshold on that rule score, so it is
// shown as "Mức phù hợp" of the location — never as AI certainty.

export function StorageSuggestionPanel({
  warehouseId,
  bookId,
  variantId,
  quantity = 1,
  onSelectLocation,
  disabled = false,
  autoRequest = false,
  selectedLocationIds = [],
}: StorageSuggestionPanelProps) {
  const [suggestions, setSuggestions] = useState<StorageSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [requested, setRequested] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState<string | undefined>();

  const canRead = hasPermission("inventory.stock.read");
  const canWrite = hasPermission("inventory.operation.decide");
  const canTaskProgress = hasPermission("inventory.task.progress");
  const canViewSuggestions = canRead || canWrite || canTaskProgress;
  const canSelectSuggestion = canWrite || canTaskProgress;

  const formatCapacity = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "Chưa cấu hình";
    if (!Number.isFinite(value)) return "Không giới hạn";
    return value.toString();
  };

  const handleGetSuggestions = useCallback(async () => {
    if (!warehouseId) {
      toast.error("Vui lòng chọn kho trước");
      return;
    }
    if (!variantId) {
      toast.error("Vui lòng chọn biến thể sách (variant) cụ thể trước khi lấy gợi ý");
      return;
    }

    try {
      setIsLoading(true);
      setRequested(true);
      setSuggestions([]);
      setFallback(false);
      setMessage(undefined);
      setError(null);

      const response: SuggestionResponse = await storageSuggestionService.getSuggestions({
        warehouse_id: warehouseId,
        variant_id: variantId,
        book_id: bookId,
        quantity,
        mode: "RECEIVING",
      });

      if (response.success) {
        setSuggestions(response.suggestions || []);
        setFallback(response.fallback || false);
        setMessage(response.message);
        setBookTitle(response.bookTitle);
      } else {
        setError(response.error || "Không thể lấy gợi ý vị trí");
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "Lỗi khi lấy gợi ý vị trí"));
    } finally {
      setIsLoading(false);
    }
  }, [warehouseId, bookId, variantId, quantity]);

  useEffect(() => {
    if (!autoRequest || disabled || !warehouseId || !variantId || !canViewSuggestions) return;
    const timer = setTimeout(() => { void handleGetSuggestions(); }, AUTO_REQUEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [autoRequest, disabled, warehouseId, variantId, canViewSuggestions, handleGetSuggestions]);

  const handleSelectLocation = useCallback(
    (suggestion: StorageSuggestion) => {
      if (!canSelectSuggestion) return;
      // The parent owns the result (allocation lines) and reports it; no toast here.
      onSelectLocation?.({
        locationId: suggestion.locationId,
        locationCode: suggestion.locationCode,
        zone: suggestion.zone,
        shelf: suggestion.shelf,
        bin: suggestion.bin,
      });
    },
    [canSelectSuggestion, onSelectLocation],
  );

  const getLocationPath = (suggestion: StorageSuggestion): string | null => {
    const parts = [suggestion.zone, suggestion.shelf, suggestion.bin].filter(Boolean);
    return parts.length > 0 ? parts.join(" / ") : null;
  };

  if (!canViewSuggestions) {
    return (
      <Card className="w-full">
        <CardContent className="py-2">
          <EmptyState
            variant="no-permission"
            title="Không có quyền xem gợi ý vị trí"
            description="Cần quyền inventory.stock.read hoặc inventory.operation.decide. Vui lòng liên hệ quản lý."
            className="py-6"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Gợi ý vị trí lưu trữ
          </CardTitle>
          <Button
            variant="default-outline"
            size="sm"
            onClick={() => void handleGetSuggestions()}
            disabled={isLoading || disabled || !warehouseId || !variantId}
            loading={isLoading}
            loadingLabel="Đang tìm vị trí…"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            {requested ? "Gợi ý lại" : "Gợi ý vị trí"}
          </Button>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {bookTitle ? <>Sách: <span className="font-medium text-foreground">{bookTitle}</span> · </> : null}
          {disabled && requested
            ? <span className="font-medium text-foreground">Đã đủ số lượng — tạm dừng gợi ý</span>
            : <>Số lượng cần xếp: <span className="font-medium text-foreground">{quantity}</span></>}
        </p>
        <AIRecommendationNotice className="mt-1" />
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner message="Đang xếp hạng các vị trí trong kho…" />
          </div>
        ) : error ? (
          <EmptyState
            variant="error"
            title="Không lấy được gợi ý vị trí"
            description={error}
            action={<Button variant="outline" size="sm" onClick={() => void handleGetSuggestions()}>Thử lại</Button>}
            className="py-6"
          />
        ) : !requested ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Package className="mb-3 h-9 w-9 text-muted-foreground/50" aria-hidden="true" />
            <p className="max-w-sm text-[13px] text-muted-foreground">
              Bấm “Gợi ý vị trí” để hệ thống xếp hạng các vị trí phù hợp dựa trên tồn kho hiện có, sức chứa và thể loại.
            </p>
          </div>
        ) : fallback || suggestions.length === 0 ? (
          <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-medium text-amber-800 dark:text-amber-300">Không có vị trí phù hợp</p>
              <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-400">
                {message || "Vui lòng tạo vị trí mới hoặc chọn vị trí thủ công trong kho."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">
              {suggestions.length} vị trí được xếp hạng theo mức phù hợp. Bạn chọn vị trí cuối cùng.
            </p>

            {suggestions.map((suggestion) => {
              const suitability = storageSuitability(suggestion.confidence);
              const isSelected = selectedLocationIds.includes(suggestion.locationId);
              const path = getLocationPath(suggestion);

              return (
                <article
                  key={suggestion.locationId}
                  aria-label={`Vị trí hạng ${suggestion.rank}: ${suggestion.locationCode}`}
                  className={`rounded-lg border p-4 transition-colors ${
                    isSelected ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-muted-foreground">#{suggestion.rank}</span>
                        <span className="font-mono text-[15px] font-semibold text-foreground">{suggestion.locationCode}</span>
                      </p>
                      {path && <p className="text-[12px] text-muted-foreground">{path}</p>}
                      <p className="flex items-center gap-2 text-[13px]">
                        <span className="text-muted-foreground">Mức phù hợp:</span>
                        <StatusBadge label={suitability.label} variant={suitability.tone} />
                      </p>
                      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                        <div className="flex gap-1"><dt className="text-muted-foreground">Sức chứa khả dụng:</dt><dd className="font-medium text-foreground">{formatCapacity(suggestion.availableCapacity)}</dd></div>
                        <div className="flex gap-1"><dt className="text-muted-foreground">Đang chứa:</dt><dd className="font-medium text-foreground">{suggestion.currentOnHand ?? "—"}</dd></div>
                      </dl>
                    </div>

                    <Button
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleSelectLocation(suggestion)}
                      disabled={!canSelectSuggestion}
                      aria-pressed={isSelected}
                      className="w-full shrink-0 sm:w-auto"
                    >
                      {isSelected ? (
                        <><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Đã chọn</>
                      ) : "Chọn vị trí"}
                    </Button>
                  </div>

                  {suggestion.warnings.length > 0 && (
                    <div className="mt-3">
                      <EvidenceList items={suggestion.warnings.map((text) => ({ text, tone: "warning" as const }))} />
                    </div>
                  )}

                  {(suggestion.reasons.length > 0 || suggestion.aiExplanation) && (
                    <div className="mt-3">
                      <DecisionSection title="Lý do" collapsible defaultOpen={suggestion.rank === 1} meta={`${suggestion.reasons.length} tiêu chí`}>
                        <EvidenceList items={suggestion.reasons.map((text) => ({ text, tone: "success" as const }))} />
                        {suggestion.aiExplanation && (
                          <p className="mt-2 text-[12px] text-muted-foreground">
                            <span className="font-medium">Diễn giải bằng AI (tóm tắt các lý do trên): </span>
                            {suggestion.aiExplanation}
                          </p>
                        )}
                      </DecisionSection>
                    </div>
                  )}
                </article>
              );
            })}

            {!canSelectSuggestion && (
              <div role="note" className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p className="text-[12px] text-muted-foreground">
                  Bạn chỉ có quyền xem gợi ý. Để chọn vị trí, cần quyền{" "}
                  <code className="rounded bg-muted px-1 text-[11px]">inventory.operation.decide</code>.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
