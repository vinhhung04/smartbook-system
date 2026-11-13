import { useCallback, useEffect, useRef, useState } from 'react';
import {
  aiExperienceService,
  type BookRecognition,
  type IdentifyStage,
} from '@/services/ai-experience';

// One cover photo waiting to be sent, identified once, then forgotten: the
// File and its object-URL preview live in memory only (never localStorage),
// the server keeps only the recognised candidates (owner-bound, 30 min).

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const NOTICE_KEY = 'smartbook_ai_photo_notice_ack';

export type PhotoPhase = 'idle' | 'ready' | 'working' | 'error';

export interface PhotoAttachment {
  file: File | null;
  previewUrl: string | null;
  phase: PhotoPhase;
  stage: IdentifyStage | null;
  error: string | null;
  noticeAccepted: boolean;
  pick: (file: File | undefined, maxBytes: number) => void;
  clear: () => void;
  acceptNotice: () => void;
  /** Identifies the pending photo; resolves null when it failed (error is set). */
  identify: () => Promise<BookRecognition | null>;
}

function readNotice(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function usePhotoAttachment(): PhotoAttachment {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<PhotoPhase>('idle');
  const [stage, setStage] = useState<IdentifyStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noticeAccepted, setNoticeAccepted] = useState(readNotice);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setFile(null);
    setPreviewUrl(null);
    setPhase('idle');
    setStage(null);
    setError(null);
  }, []);

  const pick = useCallback((next: File | undefined, maxBytes: number) => {
    if (!next) return;
    if (!ACCEPTED.includes(next.type)) {
      setError('Chỉ nhận ảnh JPEG, PNG hoặc WebP.');
      setPhase('error');
      return;
    }
    if (next.size > maxBytes) {
      setError(`Ảnh lớn hơn ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
      setPhase('error');
      return;
    }
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setPhase('ready');
    setStage(null);
    setError(null);
  }, []);

  const acceptNotice = useCallback(() => {
    setNoticeAccepted(true);
    try {
      localStorage.setItem(NOTICE_KEY, '1');
    } catch {
      // private mode: the notice is shown again next time
    }
  }, []);

  const identify = useCallback(async () => {
    if (!file) return null;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('working');
    setError(null);
    try {
      const result = await aiExperienceService.identifyBook(file, (s) => setStage(s), controller.signal);
      return result;
    } catch (err) {
      if (controller.signal.aborted) return null;
      setError(err instanceof Error ? err.message : 'Không phân tích được ảnh.');
      setPhase('error');
      return null;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [file]);

  return { file, previewUrl, phase, stage, error, noticeAccepted, pick, clear, acceptNotice, identify };
}

export const STAGE_LABEL: Record<IdentifyStage, string> = {
  uploading: 'Đang tải ảnh lên…',
  received: 'Đã nhận ảnh, đang kiểm tra…',
  analyzing: 'Đang phân tích ảnh…',
  text_read: 'Đã đọc chữ trên bìa',
  visual_done: 'Đã so khớp hình ảnh bìa',
  catalog_loaded: 'Đã tải danh mục sách',
  matching_catalog: 'Đang đối chiếu với danh mục…',
};
