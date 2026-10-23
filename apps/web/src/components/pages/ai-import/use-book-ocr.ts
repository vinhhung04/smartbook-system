import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bookOcrService, type BookOcrCapabilities, type BookOcrScanResult, type OcrImageKind } from "@/services/book-ocr";
import { getApiErrorMessage } from "@/services/http-clients";
import { resizeImageFile } from "@/lib/resize-image";
import { decodeBarcodeFromFile } from "@/lib/decode-barcode-file";
import {
  fileDigest, fingerprintFiles, OCR_ACCEPTED_TYPES, OCR_UPLOAD_MAX_DIMENSION, validateOcrFile, type OcrAvailability,
} from "@/lib/book-ocr";

export interface OcrSlot {
  file: File;
  /** Content digest of `file` (see fileDigest): the slot's identity for result matching. */
  digest: string;
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

function slotsFingerprint(slots: OcrSlots): string {
  return fingerprintFiles(Object.fromEntries(Object.entries(slots).map(([kind, slot]) => [kind, slot!.digest])));
}

/** Upload slots, previews and the scan request for AI Import's multi-image OCR.
 *
 *  A result is bound to the exact photo set (content digests) that produced it:
 *  - a newer scan, cancel or reset aborts the older request and drops its late answer;
 *  - an answer for photos that changed while it was running is dropped;
 *  - a photo picked, replaced or removed after the scan makes the result `resultStale`
 *    (still readable, but the page must not apply it);
 *  - a photo still being prepared when the slot is replaced/removed/reset is discarded
 *    (per-slot generation counter), so a slow resize never resurrects an old photo. */
export function useBookOcr() {
  const [capabilities, setCapabilities] = useState<BookOcrCapabilities | null>(null);
  const [availability, setAvailability] = useState<OcrAvailability>("LOADING");
  const [slots, setSlots] = useState<OcrSlots>({});
  const [preparing, setPreparing] = useState<OcrImageKind | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ data: BookOcrScanResult; fingerprint: string } | null>(null);
  // Source of truth for async handlers (React state lags one render behind).
  const slotsRef = useRef<OcrSlots>({});
  const generation = useRef<Record<string, number>>({});
  const request = useRef<{ seq: number; controller: AbortController | null }>({ seq: 0, controller: null });
  const capabilitiesRequest = useRef(0);

  useEffect(() => {
    const held = slotsRef;
    return () => {
      request.current.controller?.abort();
      Object.values(held.current).forEach((slot) => slot && URL.revokeObjectURL(slot.url));
    };
  }, []);

  const loadCapabilities = useCallback(async () => {
    const seq = ++capabilitiesRequest.current;
    setAvailability("LOADING");
    try {
      const caps = await bookOcrService.capabilities();
      if (seq !== capabilitiesRequest.current) return;
      setCapabilities(caps);
      setAvailability(caps?.enabled ? "AVAILABLE" : "DISABLED");
    } catch {
      // The AI service is optional (compose profile `ai`); the rest of AI Import keeps working.
      if (seq !== capabilitiesRequest.current) return;
      setCapabilities(null);
      setAvailability("UNAVAILABLE");
    }
  }, []);

  useEffect(() => {
    void loadCapabilities();
    return () => { capabilitiesRequest.current += 1; };
  }, [loadCapabilities]);

  const bump = (kind: OcrImageKind) => {
    generation.current[kind] = (generation.current[kind] ?? 0) + 1;
    return generation.current[kind];
  };

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
    const gen = bump(kind);
    if (!OCR_ACCEPTED_TYPES.includes(file.type)) {
      setError("Chỉ nhận ảnh JPG, PNG hoặc WebP.");
      return;
    }
    setPreparing(kind);
    try {
      // Phone photos are resized in the browser: three originals can exceed the gateway's 8 MB cap.
      const resized = await resizeImageFile(file, { maxDimension: OCR_UPLOAD_MAX_DIMENSION, quality: 0.88, fileName: `${kind}.jpg` });
      const sizeError = validateOcrFile(resized, capabilities?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
      const digest = sizeError ? "" : await fileDigest(resized);
      if (generation.current[kind] !== gen) return; // replaced, removed or reset meanwhile
      if (sizeError) {
        setError(sizeError);
        return;
      }
      replaceSlot(kind, {
        file: resized,
        digest,
        url: URL.createObjectURL(resized),
        barcode: kind === "back_cover" ? decodeBarcodeFromFile(file) : null,
      });
    } catch (prepareError) {
      if (generation.current[kind] === gen) {
        setError(prepareError instanceof Error ? prepareError.message : "Không đọc được file ảnh.");
      }
    } finally {
      if (generation.current[kind] === gen) setPreparing((current) => (current === kind ? null : current));
    }
  }, [capabilities, replaceSlot]);

  const removeFile = useCallback((kind: OcrImageKind) => {
    bump(kind);
    setPreparing((current) => (current === kind ? null : current));
    replaceSlot(kind, null);
  }, [replaceSlot]);

  const cancel = useCallback(() => {
    request.current.controller?.abort();
    request.current = { seq: request.current.seq + 1, controller: null };
    setScanning(false);
  }, []);

  const scan = useCallback(async (): Promise<{ result: BookOcrScanResult; reused: boolean } | null> => {
    if (availability !== "AVAILABLE") return null;
    const current = slotsRef.current;
    const files = Object.fromEntries(Object.entries(current).map(([kind, slot]) => [kind, slot!.file])) as Partial<Record<OcrImageKind, File>>;
    if (!Object.keys(files).length) {
      setError("Chọn ít nhất một ảnh: bìa trước, bìa sau hoặc trang thông tin xuất bản.");
      return null;
    }
    const fingerprint = slotsFingerprint(current);
    if (result && fingerprint === result.fingerprint) return { result: result.data, reused: true };
    request.current.controller?.abort();
    const controller = new AbortController();
    const seq = request.current.seq + 1;
    request.current = { seq, controller };
    setScanning(true);
    setError(null);
    try {
      const barcode = current.back_cover?.barcode ? await current.back_cover.barcode : null;
      if (request.current.seq !== seq) return null;
      const scanned = await bookOcrService.scan(files, { barcode, signal: controller.signal });
      if (request.current.seq !== seq) return null;
      if (slotsFingerprint(slotsRef.current) !== fingerprint) {
        // The photos changed while the request ran: this answer describes the old set.
        setError("Ảnh đã thay đổi trong lúc quét — kết quả cũ đã bị bỏ qua. Hãy quét lại.");
        return null;
      }
      setResult({ data: scanned, fingerprint });
      return { result: scanned, reused: false };
    } catch (scanError) {
      if (request.current.seq === seq && !isCanceled(scanError)) {
        setError(getApiErrorMessage(scanError, "Không quét được ảnh. Vui lòng thử lại."));
      }
      return null;
    } finally {
      if (request.current.seq === seq) {
        request.current.controller = null;
        setScanning(false);
      }
    }
  }, [availability, result]);

  /** Drops the result but keeps the selected photos. */
  const clearResult = useCallback(() => setResult(null), []);

  const reset = useCallback(() => {
    cancel();
    for (const kind of Object.keys(generation.current)) generation.current[kind] += 1;
    Object.values(slotsRef.current).forEach((slot) => slot && URL.revokeObjectURL(slot.url));
    slotsRef.current = {};
    setSlots({});
    setPreparing(null);
    setResult(null);
    setError(null);
  }, [cancel]);

  const currentFingerprint = useMemo(() => slotsFingerprint(slots), [slots]);
  const resultStale = result !== null && result.fingerprint !== currentFingerprint;

  return {
    capabilities, availability, retryCapabilities: loadCapabilities, slots, preparing, scanning, error,
    result: result?.data ?? null, resultStale, selectFile, removeFile, scan, cancel, clearResult, reset,
  };
}
