import { useCallback, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Camera, ScanSearch, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { coverSearchService, CoverSearchCandidate } from '@/services/cover-search';
import { getApiErrorMessage } from '@/services/api';
import { resizeImageFile } from '@/lib/resize-image';
import { CoverSearchResultCard } from './_shared/cover-search-result-card';
import { ReserveModal } from './_shared/reserve-modal';

export function CustomerScanCoverPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<CoverSearchCandidate[]>([]);
  const [ocrExtracted, setOcrExtracted] = useState<{ title: string | null; author: string | null } | null>(null);
  const [reserveTarget, setReserveTarget] = useState<CoverSearchCandidate | null>(null);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Vui lòng chọn một file ảnh');
      return;
    }

    const previewReader = new FileReader();
    previewReader.onload = (e) => setPreview(e.target?.result as string);
    previewReader.readAsDataURL(file);

    setSearching(true);
    setSearched(false);
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
      setSearching(false);
    }
  }, []);

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
            disabled={searching}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-[13px] text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            style={{ fontWeight: 600 }}
          >
            <Camera className="h-4 w-4" />
            {searching ? 'Đang tìm...' : preview ? 'Chụp/chọn ảnh khác' : 'Chụp hoặc chọn ảnh bìa sách'}
          </button>
        </div>
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
