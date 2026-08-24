import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, Keyboard, Loader2, RefreshCw, X } from "lucide-react";

const SCANNER_ELEMENT_ID = "barcode-scanner-view";

interface CameraOption {
  id: string;
  label: string;
}

interface BarcodeScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  title?: string;
}

export function BarcodeScanModal({
  isOpen,
  onClose,
  onDetected,
  title = "Quet Barcode",
}: BarcodeScanModalProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const [manualCode, setManualCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");

  const stopScanner = useCallback(async () => {
    if (!scannerRef.current) return;
    try {
      await scannerRef.current.stop();
    } catch {
      // ignore stop errors
    }
    scannerRef.current = null;
  }, []);

  const closeModal = useCallback(async () => {
    await stopScanner();
    setManualCode("");
    setLoading(false);
    setCameraError("");
    setCameras([]);
    setSelectedCameraId("");
    onClose();
  }, [onClose, stopScanner]);

  const handleFoundCode = useCallback(
    async (code: string) => {
      const normalized = String(code || "").trim();
      if (!normalized) return;

      await stopScanner();
      onDetected(normalized);
      onClose();
    },
    [onClose, onDetected, stopScanner],
  );

  const startScanner = useCallback(
    async (deviceId: string) => {
      await stopScanner();
      setCameraError("");

      try {
        const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, { verbose: false });
        await scanner.start(
          deviceId,
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            void handleFoundCode(decodedText);
          },
          () => {
            // ignore decode errors
          },
        );
        scannerRef.current = scanner;
      } catch {
        setCameraError("Khong the mo camera. Vui long thu lai hoac nhap thu cong.");
      }
    },
    [handleFoundCode, stopScanner],
  );

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const initScanner = async () => {
      try {
        setLoading(true);
        setCameraError("");

        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const defaultDeviceId = stream.getVideoTracks()[0]?.getSettings()?.deviceId;
        stream.getTracks().forEach((track) => track.stop());

        if (cancelled) return;

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices
          .filter((device) => device.kind === "videoinput")
          .map((device, index) => ({
            id: device.deviceId,
            label: device.label || `Camera ${index + 1}`,
          }));

        if (cancelled) return;

        setCameras(videoDevices);

        if (!videoDevices.length) {
          setCameraError("Khong tim thay camera. Ban co the nhap barcode thu cong.");
          return;
        }

        const startId = defaultDeviceId || videoDevices[0].id;
        setSelectedCameraId(startId);
        await startScanner(startId);
      } catch {
        if (!cancelled) {
          setCameraError("Trinh duyet chua duoc cap quyen camera hoac camera khong san sang.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    const timer = setTimeout(() => {
      void initScanner();
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      void stopScanner();
    };
  }, [isOpen, startScanner, stopScanner]);

  useEffect(() => {
    if (!isOpen) return;
    manualInputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void closeModal();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, closeModal]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => void closeModal()} />

      <div
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-scan-title"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-primary" />
            <h2 id="barcode-scan-title" className="text-base font-semibold text-foreground">{title}</h2>
          </div>
          <button
            onClick={() => void closeModal()}
            aria-label="Đóng"
            className="text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3 px-4 pt-4">
          {cameras.length > 1 && (
            <div className="flex items-center gap-2">
              <select
                value={selectedCameraId}
                onChange={(event) => {
                  const cameraId = event.target.value;
                  setSelectedCameraId(cameraId);
                  void startScanner(cameraId);
                }}
                aria-label="Chọn camera"
                className="flex-1 rounded-lg border border-border bg-input-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {cameras.map((camera) => (
                  <option key={camera.id} value={camera.id}>
                    {camera.label}
                  </option>
                ))}
              </select>
              <button
                title="Thu lai"
                aria-label="Thử lại"
                className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary cursor-pointer"
                onClick={() => {
                  if (selectedCameraId) {
                    void startScanner(selectedCameraId);
                  }
                }}
              >
                <RefreshCw size={13} />
              </button>
            </div>
          )}

          <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-muted p-2">
            <div id={SCANNER_ELEMENT_ID} className="min-h-[240px] w-full overflow-hidden rounded-lg" />

            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-card/80">
                <Loader2 size={26} className="animate-spin text-primary" />
              </div>
            )}
          </div>

          {cameraError ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
              {cameraError}
            </p>
          ) : null}
        </div>

        <div className="border-t border-border px-4 py-4">
          <label htmlFor="barcode-manual-input" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
            <Keyboard size={12} className="mr-1 inline" />
            Nhap barcode thu cong
          </label>
          <div className="flex items-center gap-2">
            <input
              id="barcode-manual-input"
              ref={manualInputRef}
              value={manualCode}
              onChange={(event) => setManualCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleFoundCode(manualCode);
                }
              }}
              placeholder="Nhap ma barcode/ISBN..."
              className="flex-1 rounded-lg border border-border bg-input-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={() => void handleFoundCode(manualCode)}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer"
            >
              Xac nhan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
