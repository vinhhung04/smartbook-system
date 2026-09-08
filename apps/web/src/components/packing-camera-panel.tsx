import { useEffect, useState, type Ref } from "react";
import { Camera, ScanLine, CircleX, CircleCheck } from "lucide-react";

interface PackingCameraPanelProps {
  videoRef: Ref<HTMLVideoElement>;
  isLive: boolean;
  cameraError: string;
  isRecording: boolean;
  autoScanSupported: boolean;
  savedCount: number;
  /** Undefined when no order is open. "incomplete" until the last item is scanned, then "complete". */
  scanStatus?: "incomplete" | "complete";
  /** Outbound order number of the task currently on the bench — burned into the HUD like a camera ID. */
  orderNumber?: string;
}

/** Live wall-clock for the HUD overlay — purely cosmetic, ticks once a second. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Pure view for the Packing Station camera — live view + status badges only. Camera lifecycle
 * (hooks/use-packing-camera.ts) and recording lifecycle (hooks/use-packing-recording-session.ts)
 * both live one level up in PackingPage, since the camera now persists across the whole page
 * instead of mounting per order. Nothing in this component owns a MediaStream anymore.
 */
export function PackingCameraPanel({
  videoRef,
  isLive,
  cameraError,
  isRecording,
  autoScanSupported,
  savedCount,
  scanStatus,
  orderNumber,
}: PackingCameraPanelProps) {
  const now = useClock();
  const timestamp = now.toLocaleTimeString("vi-VN", { hour12: false });

  const ringClass = isRecording
    ? "ring-2 ring-offset-2 ring-offset-card ring-red-500/70"
    : isLive
      ? "ring-2 ring-offset-2 ring-offset-card ring-emerald-500/40"
      : "ring-1 ring-border";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Camera className="h-4 w-4" />
          </div>
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Camera giám sát
            </p>
            <h3 className="text-[15px] font-semibold leading-tight text-foreground">Trạm đóng gói</h3>
          </div>
        </div>
        {savedCount > 0 ? (
          <span className="font-mono text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {savedCount} video đã lưu
          </span>
        ) : null}
      </div>

      <div
        className={`relative aspect-video overflow-hidden rounded-lg border border-black/40 bg-[#101218] transition-shadow duration-300 ${ringClass}`}
      >
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />

        {/* Faint scanline texture — evokes a security-monitor feed without obscuring the picture. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-overlay"
          style={{
            background: "repeating-linear-gradient(180deg, #fff 0px, #fff 1px, transparent 1px, transparent 3px)",
          }}
        />
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_60px_18px_rgba(0,0,0,0.55)]" />

        {/* HUD — top: camera ID / REC on the left, live timestamp on the right, like burned-in CCTV overlay. */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {isRecording ? (
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-black/55 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-red-400 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                Rec
              </span>
            ) : null}
            {orderNumber ? (
              <span className="inline-flex items-center gap-1 rounded-sm bg-black/55 px-2 py-1 font-mono text-[10px] font-semibold text-emerald-300 backdrop-blur-sm">
                #{orderNumber}
              </span>
            ) : null}
          </div>
          <span className="shrink-0 rounded-sm bg-black/55 px-2 py-1 font-mono text-[10px] font-medium tabular-nums text-slate-300 backdrop-blur-sm">
            {timestamp}
          </span>
        </div>

        {/* HUD — bottom: scan/auto-scan readout. */}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-1.5 p-2.5">
          {scanStatus === "incomplete" ? (
            <span className="inline-flex animate-pulse items-center gap-1 rounded-sm bg-red-600/90 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
              <CircleX className="h-3 w-3" /> Chưa scan đủ
            </span>
          ) : null}
          {scanStatus === "complete" ? (
            <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-600/90 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
              <CircleCheck className="h-3 w-3" /> Đã scan đủ
            </span>
          ) : null}
          {isLive && autoScanSupported ? (
            <span className="inline-flex items-center gap-1 rounded-sm bg-black/55 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-300 backdrop-blur-sm">
              <ScanLine className="h-3 w-3" /> Auto scan
            </span>
          ) : null}
          {!isLive ? (
            <span className="inline-flex items-center gap-1 rounded-sm bg-black/55 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur-sm">
              Standby
            </span>
          ) : null}
        </div>

        {!isLive && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center font-mono text-[12px] text-slate-300">
            {cameraError || "Đang khởi động camera..."}
          </div>
        )}
      </div>

      <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
        Camera luôn bật khi ở màn hình Packing để giám sát và hỗ trợ quét — chỉ ghi hình khi có đơn đang xử lý,
        mỗi đơn một video riêng. Dùng nút "Chụp ảnh xác minh" để AI đếm số lượng sách trong ảnh và so khớp với đơn đóng gói.
      </p>
    </div>
  );
}
