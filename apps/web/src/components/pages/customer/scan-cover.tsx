import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Camera, CheckCircle, Loader2, ScanSearch, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { coverSearchService, CoverSearchCandidate } from '@/services/cover-search';
import { getApiErrorMessage } from '@/services/api';
import { resizeImageFile } from '@/lib/resize-image';
import { CoverSearchResultCard } from './_shared/cover-search-result-card';
import { ReserveModal } from './_shared/reserve-modal';

// Visual matching (CLIP) is fast in practice (~2s/image, measured against the
// real gallery) — this timer just gives that step a legible "done" moment.
// OCR (Ollama vision, CPU) is the real bottleneck and has no progress signal
// from the server, so its row stays "in progress" until the actual response
// arrives — never faked past that point.
const VISUAL_STEP_MS = 3000;
const SLOW_HINT_AFTER_MS = 12000;
const SCAN_LINE_TRAVEL_PX = 256; // matches the fixed h-64 preview container

function ChecklistRow({ label, done, hint }: { label: string; done: boolean; hint?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      {done ? (
        <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
      ) : (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-500" />
      )}
      <span className={done ? 'text-foreground' : 'text-muted-foreground'}>
        {label}
        {hint && <span className="text-slate-400 dark:text-slate-500"> — {hint}</span>}
      </span>
    </div>
  );
}

function ScanningState({ preview, elapsedMs, visualDone }: { preview: string | null; elapsedMs: number; visualDone: boolean }) {
  const reducedMotion = useReducedMotion();
  const showSlowHint = elapsedMs >= SLOW_HINT_AFTER_MS;

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative h-64 w-full max-w-sm overflow-hidden rounded-xl border border-indigo-200/60 bg-muted/30 dark:border-indigo-500/30">
        {preview && <img src={preview} alt="Ảnh bìa đang xử lý" className="h-full w-full object-contain" />}
        {/* The one authored moment: a scan-line sweeping the user's own photo —
            names the actual thing the AI is doing to it, not a generic spinner. */}
        {!reducedMotion && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-indigo-400/40 to-transparent"
            style={{ top: -40 }}
            animate={{ y: [0, SCAN_LINE_TRAVEL_PX + 40, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-3 py-2">
          <p className="text-[11px] text-white/90">Đã chờ {Math.round(elapsedMs / 1000)}s</p>
        </div>
      </div>

      <div className="w-full max-w-sm space-y-2 rounded-xl border border-border bg-muted/20 px-4 py-3">
        <ChecklistRow label="So khớp hình ảnh bìa" done={visualDone} />
        <ChecklistRow
          label="Đọc chữ trên bìa sách"
          done={false}
          hint={showSlowHint ? 'có thể mất đến 1–2 phút' : undefined}
        />
      </div>
    </div>
  );
}

export function CustomerScanCoverPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<CoverSearchCandidate[]>([]);
  const [ocrExtracted, setOcrExtracted] = useState<{ title: string | null; author: string | null } | null>(null);
  const [reserveTarget, setReserveTarget] = useState<CoverSearchCandidate | null>(null);
  const [visualStepDone, setVisualStepDone] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const visualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (visualTimerRef.current) clearTimeout(visualTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Vui lòng chọn một file ảnh');
      return;
    }

    const previewReader = new FileReader();
    previewReader.onload = (e) => setPreview(e.target?.result as string);
    previewReader.readAsDataURL(file);

    clearTimers();
    setSearching(true);
    setSearched(false);
    setVisualStepDone(false);
    setElapsedMs(0);
    const startedAt = Date.now();
    visualTimerRef.current = setTimeout(() => setVisualStepDone(true), VISUAL_STEP_MS);
    elapsedTimerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);

    try {
      const resized = await resizeImageFile(file);
      const result = await coverSearchService.findByCover(resized);
      setCandidates(result.candidates);
      setOcrExtracted(result.signals.ocr_extracted);
      setSearched(true);
      if (!result.match_found) {
        toast.info('Không tìm thấy sách khớp với ảnh này');
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Không thể tìm sách từ ảnh này'));
    } finally {
      clearTimers();
      setSearching(false);
    }
  }, [clearTimers]);

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-2xl border border-indigo-200/60 bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 p-6 shadow-xl shadow-indigo-500/15"
      >
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
            <ScanSearch className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-[20px] tracking-tight text-white" style={{ fontWeight: 700 }}>Tìm sách bằng ảnh bìa</h1>
            <p className="text-white/70 text-[13px] mt-0.5">Chụp hoặc chọn ảnh bìa sách — hệ thống sẽ tìm sách khớp trong thư viện.</p>
          </div>
        </div>
      </motion.div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFileSelect(file);
            e.target.value = '';
          }}
        />

        {searching ? (
          <ScanningState preview={preview} elapsedMs={elapsedMs} visualDone={visualStepDone} />
        ) : (
          <div className="flex flex-col items-center gap-4">
            {preview ? (
              <img src={preview} alt="Ảnh bìa đã chọn" className="max-h-64 rounded-xl border border-border object-contain" />
            ) : (
              <div className="flex h-40 w-full max-w-xs items-center justify-center rounded-xl border border-dashed border-border bg-muted/30">
                <Camera className="h-8 w-8 text-muted-foreground" />
              </div>
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-[13px] text-white hover:bg-indigo-700"
              style={{ fontWeight: 600 }}
            >
              <Camera className="h-4 w-4" />
              {preview ? 'Chụp/chọn ảnh khác' : 'Chụp hoặc chọn ảnh bìa sách'}
            </button>
          </div>
        )}
      </div>

      {searched && (
        <div className="space-y-4">
          {ocrExtracted?.title && (
            <p className="text-[12px] text-muted-foreground">
              Đọc được trên bìa: <span className="text-foreground" style={{ fontWeight: 600 }}>{ocrExtracted.title}</span>
              {ocrExtracted.author ? ` — ${ocrExtracted.author}` : ''}
            </p>
          )}

          {candidates.length === 0 ? (
            <div className="relative overflow-hidden rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
              <Sparkles className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
              <h3 className="text-[15px] font-semibold text-foreground">Không tìm thấy sách khớp</h3>
              <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted-foreground">
                Thử chụp lại ở nơi đủ sáng, giữ bìa sách thẳng và rõ trong khung hình.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {candidates.map((candidate) => (
                <CoverSearchResultCard
                  key={candidate.id}
                  candidate={candidate}
                  onReserve={setReserveTarget}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <ReserveModal
        book={reserveTarget}
        onClose={() => setReserveTarget(null)}
        onSuccess={() => setReserveTarget(null)}
      />
    </div>
  );
}
