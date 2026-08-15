import { useCallback, useEffect, useRef, useState } from "react";
import { detectBarcodeFromVideoFrame, isBarcodeDetectionSupported } from "@/lib/barcode-detector";

const AUTO_SCAN_POLL_MS = 400;
const AUTO_SCAN_REPEAT_COOLDOWN_MS = 2500;

/**
 * "CameraManager" for the Packing Station: opens the camera exactly once for the lifetime of
 * the component using this hook (the Packing page itself, not any single order) and keeps it
 * live regardless of which order is currently open. Recording is a separate concern — see
 * use-packing-recording-session.ts — this hook only owns live view + continuous barcode/QR scan.
 */
export function usePackingCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barcodeHandlerRef = useRef<((code: string) => void) | null>(null);
  const lastAutoScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const mountedRef = useRef(true);

  const [isLive, setIsLive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const autoScanSupported = isBarcodeDetectionSupported();

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (mountedRef.current) {
          setIsLive(true);
          setCameraError("");
        }
      } catch {
        if (mountedRef.current) {
          setCameraError("Không thể mở camera — máy quét barcode và nút Scan sách vẫn hoạt động bình thường.");
        }
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    // Intentionally mount-once: this hook's lifetime IS the Packing page's lifetime, by design —
    // it must never re-run just because the selected order changed.
  }, []);

  useEffect(() => {
    if (!isLive || !autoScanSupported) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled || !videoRef.current) return;
      const code = await detectBarcodeFromVideoFrame(videoRef.current);
      if (!code) return;

      const now = Date.now();
      const last = lastAutoScanRef.current;
      if (code === last.code && now - last.at < AUTO_SCAN_REPEAT_COOLDOWN_MS) return;
      lastAutoScanRef.current = { code, at: now };

      barcodeHandlerRef.current?.(code);
    };

    const interval = setInterval(() => void tick(), AUTO_SCAN_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLive, autoScanSupported]);

  /** Swap which callback receives auto-detected codes without restarting the scan loop or camera. */
  const setBarcodeHandler = useCallback((handler: ((code: string) => void) | null) => {
    barcodeHandlerRef.current = handler;
  }, []);

  return { videoRef, streamRef, isLive, cameraError, autoScanSupported, setBarcodeHandler };
}
