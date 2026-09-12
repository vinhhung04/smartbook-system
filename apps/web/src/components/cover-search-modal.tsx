import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Camera, ImageOff, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { coverSearchService, CoverSearchCandidate } from "@/services/cover-search";
import { getApiErrorMessage } from "@/services/api";
import { resizeImageFile } from "@/lib/resize-image";
import { ConfidenceMeter } from "./pages/ai-import/confidence-meter";
import { CatalogBookThumbnail } from "./pages/catalog-book-thumbnail";

interface CoverSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}

const SLOW_HINT_AFTER_MS = 12000;

/** Staff-facing version of the customer "scan cover" screen — same endpoint,
 * same ranked-candidates shape, but the destination on pick is the internal
 * book detail page (/book/:id) instead of a reserve action, since staff here
 * are looking a book up (circulation desk, stock audit follow-up), not
 * borrowing one. */
export function CoverSearchModal({ isOpen, onClose, title = "Tìm sách bằng ảnh bìa" }: CoverSearchModalProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<CoverSearchCandidate[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    setPreview(null);
    setSearching(false);
    setSearched(false);
    setCandidates([]);
    setElapsedMs(0);
  }, []);

  const closeModal = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, closeModal]);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Vui lòng chọn một file ảnh");
      return;
    }

    const previewReader = new FileReader();
    previewReader.onload = (e) => setPreview(e.target?.result as string);
    previewReader.readAsDataURL(file);

    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    setSearching(true);
    setSearched(false);
    setElapsedMs(0);
    const startedAt = Date.now();
    elapsedTimerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);

    try {
      const resized = await resizeImageFile(file);
      const result = await coverSearchService.findByCover(resized);
      setCandidates(result.candidates);
      setSearched(true);
      if (!result.match_found) {
        toast.info("Không tìm thấy sách khớp với ảnh này");
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không thể tìm sách từ ảnh này"));
    } finally {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      setSearching(false);
    }
  }, []);

  const handlePick = (candidate: CoverSearchCandidate) => {
    closeModal();
    navigate(`/book/${candidate.id}`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} />

      <div
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cover-search-title"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-primary" />
            <h2 id="cover-search-title" className="text-base font-semibold text-foreground">{title}</h2>
          </div>
          <button
            onClick={closeModal}
            aria-label="Đóng"
            className="text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4 space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelect(file);
              e.target.value = "";
            }}
          />

          <div className="flex flex-col items-center gap-3">
            {preview ? (
              <img src={preview} alt="Ảnh bìa đã chọn" className="max-h-48 rounded-xl border border-border object-contain" />
            ) : (
              <div className="flex h-32 w-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/30">
                <ImageOff className="h-7 w-7 text-muted-foreground" />
              </div>
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={searching}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {searching ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
              {searching ? "Đang tìm..." : preview ? "Chụp/chọn ảnh khác" : "Chụp hoặc chọn ảnh bìa sách"}
            </button>
            {searching && (
              <p className="text-[11px] text-muted-foreground">
                Đã chờ {Math.round(elapsedMs / 1000)}s
                {elapsedMs >= SLOW_HINT_AFTER_MS ? ' — đang đọc chữ trên bìa, có thể mất đến 1–2 phút' : ''}
              </p>
            )}
          </div>

          {searched && (
            candidates.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
                Không tìm thấy sách khớp. Thử chụp lại ở nơi đủ sáng, giữ bìa thẳng trong khung hình.
              </p>
            ) : (
              <ul className="space-y-2">
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      onClick={() => handlePick(candidate)}
                      className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                    >
                      <CatalogBookThumbnail category={candidate.category} title={candidate.title} imageUrl={candidate.cover_image_url} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">{candidate.title}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{candidate.author || "Không rõ tác giả"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <ConfidenceMeter value={candidate.confidence} tone="indigo" />
                        <span className="text-[11px] font-semibold text-foreground">{Math.round(candidate.confidence * 100)}%</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </div>
    </div>
  );
}
