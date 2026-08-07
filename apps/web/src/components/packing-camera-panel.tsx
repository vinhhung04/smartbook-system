import type { RefObject } from "react";
import { Camera, ScanLine } from "lucide-react";

interface PackingCameraPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  isLive: boolean;
  cameraError: string;
  isRecording: boolean;
  autoScanSupported: boolean;
  savedCount: number;
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
}: PackingCameraPanelProps) {
  const ringClass = isRecording
    ? "ring-2 ring-offset-2 ring-offset-card ring-red-500/70"
    : isLive
      ? "ring-2 ring-offset-2 ring-offset-card ring-emerald-500/50"
      : "ring-1 ring-border";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-primary" />
          <h3 className="text-[13px] font-semibold text-foreground">Camera Packing Station</h3>
        </div>
        {savedCount > 0 ? (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">{savedCount} video đã lưu</span>
        ) : null}
      </div>

      <div className={`relative overflow-hidden rounded-md border border-border bg-slate-900 aspect-video transition-shadow duration-300 ${ringClass}`}>
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />

        <div className="absolute left-2.5 top-2.5 flex flex-wrap items-center gap-1.5">
          {isRecording ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-600/90 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Đang ghi hình
            </span>
          ) : null}
          {isLive && autoScanSupported ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/90 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
              <ScanLine className="h-3 w-3" /> Auto Scan
            </span>
          ) : null}
        </div>

        {!isLive && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[12px] text-slate-300">
            {cameraError || "Đang khởi động camera..."}
          </div>
        )}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Camera luôn bật khi ở màn hình Packing để giám sát và hỗ trợ quét — chỉ ghi hình khi có đơn đang xử lý,
        mỗi đơn một video riêng. Dùng nút "Chụp ảnh xác minh" để AI đếm số lượng sách trong ảnh và so khớp với đơn đóng gói.
      </p>
    </div>
  );
}
