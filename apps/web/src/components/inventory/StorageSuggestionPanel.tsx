import { useState, useCallback } from "react";
import {
  MapPin,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/services/http-clients";
import {
  storageSuggestionService,
  type StorageSuggestion,
  type SuggestionResponse,
  type ConfidenceLevel,
} from "@/services/storage-suggestion";
import { getApiErrorMessage } from "@/services/api";

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
}

const confidenceConfig: Record<
  ConfidenceLevel,
  { label: string; color: string; bgColor: string }
> = {
  HIGH: {
    label: "Cao",
    color: "text-emerald-700",
    bgColor: "bg-emerald-50 border-emerald-200",
  },
  MEDIUM: {
    label: "Trung bình",
    color: "text-amber-700",
    bgColor: "bg-amber-50 border-amber-200",
  },
  LOW: {
    label: "Thấp",
    color: "text-slate-700",
    bgColor: "bg-slate-50 border-slate-200",
  },
};

export function StorageSuggestionPanel({
  warehouseId,
  bookId,
  variantId,
  quantity = 1,
  onSelectLocation,
  disabled = false,
}: StorageSuggestionPanelProps) {
  const [suggestions, setSuggestions] = useState<StorageSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasPermissionToRead, setHasPermissionToRead] = useState<boolean | null>(null);
  const [fallback, setFallback] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [bookTitle, setBookTitle] = useState<string | undefined>();
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  const canRead = hasPermission("inventory.stock.read");
  const canWrite = hasPermission("inventory.stock.write");

  const handleGetSuggestions = useCallback(async () => {
    if (!warehouseId) {
      toast.error("Vui lòng chọn kho trước");
      return;
    }

    if (!bookId && !variantId) {
      toast.error("Vui lòng chọn sách hoặc biến thể sách");
      return;
    }

    setHasPermissionToRead(canRead);

    if (!canRead) {
      toast.error("Bạn không có quyền xem gợi ý vị trí");
      return;
    }

    try {
      setIsLoading(true);
      setSuggestions([]);
      setFallback(false);
      setMessage(undefined);
      setSelectedLocationId(null);

      const response: SuggestionResponse =
        await storageSuggestionService.getSuggestions({
          warehouse_id: warehouseId,
          book_id: bookId,
          variant_id: variantId,
          quantity: quantity,
          mode: "RECEIVING",
        });

      if (response.success) {
        setSuggestions(response.suggestions || []);
        setFallback(response.fallback || false);
        setMessage(response.message);
        setBookTitle(response.bookTitle);

        if (response.fallback && response.message) {
          toast.info(response.message);
        }
      } else {
        toast.error(response.error || "Không thể lấy gợi ý vị trí");
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Lỗi khi lấy gợi ý vị trí"));
    } finally {
      setIsLoading(false);
    }
  }, [warehouseId, bookId, variantId, quantity, canRead]);

  const handleSelectLocation = useCallback(
    (suggestion: StorageSuggestion) => {
      if (!canWrite) {
        toast.warning("Bạn không có quyền thao tác vị trí. Vui lòng liên hệ quản lý.");
        return;
      }

      setSelectedLocationId(suggestion.locationId);

      onSelectLocation?.({
        locationId: suggestion.locationId,
        locationCode: suggestion.locationCode,
        zone: suggestion.zone,
        shelf: suggestion.shelf,
        bin: suggestion.bin,
      });

      toast.success(`Đã chọn vị trí: ${suggestion.locationCode}`);
    },
    [canWrite, onSelectLocation]
  );

  const getLocationPath = (suggestion: StorageSuggestion): string => {
    const parts = [
      suggestion.zone,
      suggestion.shelf,
      suggestion.bin,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" / ") : suggestion.locationCode;
  };

  if (hasPermissionToRead === false) {
    return null;
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <MapPin className="h-4 w-4 text-blue-600" />
            Gợi ý vị trí lưu trữ
          </CardTitle>
          <Button
            variant="default-outline"
            size="sm"
            onClick={() => void handleGetSuggestions()}
            disabled={isLoading || disabled || !warehouseId || (!bookId && !variantId)}
            loading={isLoading}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Gợi ý ngay
          </Button>
        </div>

        {bookTitle && (
          <p className="mt-1 text-sm text-slate-500">
            Sách: <span className="font-medium text-slate-700">{bookTitle}</span>
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            <span className="ml-2 text-sm text-slate-500">
              Đang phân tích kho và tìm vị trí phù hợp...
            </span>
          </div>
        )}

        {!isLoading && suggestions.length === 0 && !fallback && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Package className="mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-500">
              Bấm "Gợi ý ngay" để hệ thống phân tích và đề xuất vị trí lưu trữ tối ưu
            </p>
          </div>
        )}

        {fallback && !isLoading && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                Không có vị trí phù hợp
              </p>
              <p className="mt-1 text-xs text-amber-700">
                {message ||
                  "Vui lòng tạo vị trí mới hoặc chọn vị trí thủ công trong kho."}
              </p>
            </div>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>Tìm thấy {suggestions.length} vị trí phù hợp nhất</span>
            </div>

            {suggestions.map((suggestion) => {
              const confidence = confidenceConfig[suggestion.confidence];
              const isSelected = selectedLocationId === suggestion.locationId;

              return (
                <div
                  key={suggestion.locationId}
                  className={`group relative rounded-lg border p-4 transition-all ${
                    isSelected
                      ? "border-blue-400 bg-blue-50"
                      : "border-slate-200 hover:border-blue-300 hover:bg-blue-50/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-100 text-xs font-bold text-blue-700">
                          {suggestion.rank}
                        </span>
                        <span className="font-mono text-sm font-semibold text-slate-800">
                          {suggestion.locationCode}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${confidence.color} ${confidence.bgColor}`}
                        >
                          {confidence.label}
                        </span>
                        <span className="text-xs text-slate-400">
                          ({suggestion.score} điểm)
                        </span>
                      </div>

                      <p className="mt-1 text-xs text-slate-500">
                        {getLocationPath(suggestion)}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                          Sức chứa: {suggestion.availableCapacity}
                        </span>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                          Hiện tại: {suggestion.currentOnHand}
                        </span>
                      </div>
                    </div>

                    <Button
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleSelectLocation(suggestion)}
                      disabled={!canWrite}
                      className="shrink-0"
                    >
                      {isSelected ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Đã chọn
                        </>
                      ) : (
                        "Chọn"
                      )}
                    </Button>
                  </div>

                  {suggestion.warnings.length > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <div className="space-y-0.5">
                        {suggestion.warnings.map((warning, idx) => (
                          <p key={idx} className="text-[10px] text-amber-700">
                            {warning}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {suggestion.reasons.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {suggestion.reasons.map((reason, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-1.5 text-[11px] text-slate-600"
                        >
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                          {reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {!canWrite && (
              <div className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <p className="text-xs text-slate-600">
                  Bạn không có quyền thao tác vị trí. Vui lòng liên hệ quản lý để được phân quyền{" "}
                  <code className="rounded bg-slate-200 px-1 text-[10px]">
                    inventory.stock.write
                  </code>
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
