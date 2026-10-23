import { useCallback, useEffect, useRef, useState } from "react";
import { bookOcrService, type BookOcrCapabilities, type BookOcrScanResult, type OcrImageKind } from "@/services/book-ocr";
import { getApiErrorMessage } from "@/services/http-clients";
import { resizeImageFile } from "@/lib/resize-image";
import { decodeBarcodeFromFile } from "@/lib/decode-barcode-file";
import { fingerprintFiles, OCR_ACCEPTED_TYPES, OCR_UPLOAD_MAX_DIMENSION, validateOcrFile } from "@/lib/book-ocr";

export interface OcrSlot {
  file: File;
  /** Object URL for the preview; revoked when the slot is replaced, removed or unmounted. */
  url: string;
  /** EAN decoded from the ORIGINAL back-cover photo (full resolution), if any. */
  barcode: Promise<string | null> | null;
}

export type OcrSlots = Partial<Record<OcrImageKind, OcrSlot>>;

const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;

function isCanceled(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ERR_CANCELED";
}

/** Upload slots, previews and the scan request for AI Import's multi-image OCR.
 *  Only the latest scan's answer is ever returned: a newer scan, cancel or reset
 *  aborts the older request and its late response is dropped. */
export function useBookOcr() {
  const [capabilities, setCapabilities] = useState<BookOcrCapabilities | null>(null);
  const [slots, setSlots] = useState<OcrSlots>({});
  const [preparing, setPreparing] = useState<OcrImageKind | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookOcrScanResult | null>(null);
  const slotsRef = useRef<OcrSlots>({});
  const request = useRef<{ seq: number; controller: AbortController | null; fingerprint: string | null }>({
    seq: 0, controller: null, fingerprint: null,
  });

  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  useEffect(() => {
    const held = slotsRef;
    return () => Object.values(held.current).forEach((slot) => slot && URL.revokeObjectURL(slot.url));
  }, []);

  useEffect(() => {
    let active = true;
    bookOcrService.capabilities().then((caps) => { if (active) setCapabilities(caps); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const replaceSlot = useCallback((kind: OcrImageKind, slot: OcrSlot | null) => {
    const previous = slotsRef.current[kind];
    if (previous) URL.revokeObjectURL(previous.url);
    const next = { ...slotsRef.current };
    if (slot) next[kind] = slot;
    else delete next[kind];
    slotsRef.current = next;
    setSlots(next);
  }, []);

  const selectFile = useCallback(async (kind: OcrImageKind, file: File) => {
    setError(null);
    if (!OCR_ACCEPTED_TYPES.includes(file.type)) {
      setError("Chỉ nhận ảnh JPG, PNG hoặc WebP.");
      return;
    }
    setPreparing(kind);
    try {
      // Phone photos are resized in the browser: three originals can exceed the gateway's 8 MB cap.
      const resized = await resizeImageFile(file, { maxDimension: OCR_UPLOAD_MAX_DIMENSION, quality: 0.88, fileName: `${kind}.jpg` });
      const sizeError = validateOcrFile(resized, capabilities?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
      if (sizeError) {
        setError(sizeError);
        return;
      }
      replaceSlot(kind, {
        file: resized,
        url: URL.createObjectURL(resized),
        barcode: kind === "back_cover" ? decodeBarcodeFromFile(file) : null,
      });
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : "Không đọc được file ảnh.");
    } finally {
      setPreparing(null);
    }
  }, [capabilities, replaceSlot]);

  const removeFile = useCallback((kind: OcrImageKind) => replaceSlot(kind, null), [replaceSlot]);

  const cancel = useCallback(() => {
    request.current.controller?.abort();
    request.current = { ...request.current, seq: request.current.seq + 1, controller: null };
    setScanning(false);
  }, []);

  const scan = useCallback(async (): Promise<{ result: BookOcrScanResult; reused: boolean } | null> => {
    const current = slotsRef.current;
    const files = Object.fromEntries(Object.entries(current).map(([kind, slot]) => [kind, slot!.file])) as Partial<Record<OcrImageKind, File>>;
    if (!Object.keys(files).length) {
      setError("Chọn ít nhất một ảnh: bìa trước, bìa sau hoặc trang thông tin xuất bản.");
      return null;
    }
    const fingerprint = fingerprintFiles(files);
    if (result && fingerprint === request.current.fingerprint) return { result, reused: true };
    request.current.controller?.abort();
    const controller = new AbortController();
    const seq = request.current.seq + 1;
    request.current = { seq, controller, fingerprint: request.current.fingerprint };
    setScanning(true);
    setError(null);
    try {
      const barcode = current.back_cover?.barcode ? await current.back_cover.barcode : null;
      const scanned = await bookOcrService.scan(files, { barcode, signal: controller.signal });
      if (request.current.seq !== seq) return null;
      request.current.fingerprint = fingerprint;
      setResult(scanned);
      return { result: scanned, reused: false };
    } catch (scanError) {
      if (request.current.seq === seq && !isCanceled(scanError)) {
        setError(getApiErrorMessage(scanError, "Không quét được ảnh. Vui lòng thử lại."));
      }
      return null;
    } finally {
      if (request.current.seq === seq) setScanning(false);
    }
  }, [result]);

  /** Drops the result (and its fingerprint) but keeps the selected photos. */
  const clearResult = useCallback(() => {
    request.current.fingerprint = null;
    setResult(null);
  }, []);

  const reset = useCallback(() => {
    cancel();
    Object.values(slotsRef.current).forEach((slot) => slot && URL.revokeObjectURL(slot.url));
    slotsRef.current = {};
    setSlots({});
    setResult(null);
    setError(null);
    request.current.fingerprint = null;
  }, [cancel]);

  return { capabilities, slots, preparing, scanning, error, result, selectFile, removeFile, scan, cancel, clearResult, reset };
}
