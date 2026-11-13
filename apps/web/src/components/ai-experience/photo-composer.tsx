import { useRef, useState, type Ref } from 'react';
import { ImagePlus, Loader2, RefreshCw, RotateCcw, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/components/ui/utils';
import { STAGE_LABEL, type PhotoAttachment } from './use-photo-attachment';

// Attach button + external-processing notice + pending-photo preview, shared
// by the floating chatbot and the Decision Assistant composer. On phones the
// native picker offers both the camera and the gallery.

interface AttachProps {
  photo: PhotoAttachment;
  maxBytes: number;
  notice: string;
  disabled?: boolean;
  className?: string;
  /** Lets "Chọn ảnh khác" in the preview reopen the picker. */
  buttonRef?: Ref<HTMLButtonElement>;
}

export function PhotoAttachButton({ photo, maxBytes, notice, disabled, className, buttonRef }: AttachProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [askNotice, setAskNotice] = useState(false);
  const open = () => (photo.noticeAccepted ? inputRef.current?.click() : setAskNotice(true));
  return (
    <>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => { photo.pick(event.target.files?.[0], maxBytes); event.target.value = ''; }} />
      <button ref={buttonRef} type="button" onClick={open} disabled={disabled}
        aria-label={photo.file ? 'Thay ảnh bìa sách' : 'Đính kèm ảnh bìa sách'}
        title="Đính kèm ảnh bìa sách (JPEG, PNG, WebP)"
        className={cn('grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40', className)}>
        <ImagePlus className="h-4 w-4" aria-hidden="true" />
      </button>
      <AlertDialog open={askNotice} onOpenChange={setAskNotice}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trước khi gửi ảnh bìa sách</AlertDialogTitle>
            <AlertDialogDescription className="text-left leading-relaxed">{notice}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-[12.5px] text-muted-foreground">
            Định dạng: JPEG, PNG, WebP · tối đa {Math.floor(maxBytes / (1024 * 1024))} MB. Kết quả nhận diện chỉ là gợi ý,
            không ghi vào danh mục sách.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Để sau</AlertDialogCancel>
            <AlertDialogAction onClick={() => { photo.acceptNotice(); setTimeout(() => inputRef.current?.click(), 0); }}>
              Tôi đồng ý, chọn ảnh
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface PreviewProps {
  photo: PhotoAttachment;
  onReplace: () => void;
  onRetry?: () => void;
  compact?: boolean;
}

/** The photo about to be sent, with its real processing stage. */
export function PhotoPreview({ photo, onReplace, onRetry, compact }: PreviewProps) {
  if (photo.phase === 'idle' && !photo.error) return null;
  const working = photo.phase === 'working';
  return (
    <div className={cn('flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 p-2', compact ? 'mx-0' : 'mx-3 mt-3')}>
      {photo.previewUrl ? (
        <img src={photo.previewUrl} alt="Ảnh bìa sách sắp gửi" className="h-12 w-9 shrink-0 rounded object-cover" />
      ) : null}
      <div className="min-w-0 flex-1" aria-live="polite">
        {photo.error ? (
          <p role="alert" className="text-[12px] font-medium text-destructive">{photo.error}</p>
        ) : working ? (
          <p className="flex items-center gap-1.5 text-[12px] text-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {photo.stage ? STAGE_LABEL[photo.stage] : 'Đang chuẩn bị…'}
          </p>
        ) : (
          <p className="truncate text-[12px] text-foreground">
            {photo.file?.name || 'Ảnh bìa'} · {photo.file ? `${Math.max(1, Math.round(photo.file.size / 1024))} KB` : ''}
          </p>
        )}
        {!working && !photo.error && (
          <p className="text-[11px] text-muted-foreground">Gửi kèm câu hỏi, hoặc bấm gửi để nhận diện sách.</p>
        )}
      </div>
      {photo.error && onRetry && photo.file ? (
        <button type="button" onClick={onRetry} aria-label="Thử lại với ảnh này"
          className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
      {!working && (
        <button type="button" onClick={onReplace} aria-label="Chọn ảnh khác"
          className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      <button type="button" onClick={photo.clear} aria-label={working ? 'Hủy gửi ảnh' : 'Bỏ ảnh'}
        className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
