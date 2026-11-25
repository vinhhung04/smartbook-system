import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Video } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button, LoadingSpinner } from "@/components/ui";
import { formatDateTime } from "@/components/ops/ops-utils";
import { cn } from "@/components/ui/utils";
import { getApiErrorMessage } from "@/services/api.ts";
import { packingService, type PackingEvidenceReview, type PackingEvidenceSession } from "@/services/packing";

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** MediaRecorder webm files carry no duration, so the player shows Infinity and cannot seek.
 *  Seeking far past the end once makes the browser scan the file and learn the real duration. */
function fixWebmDuration(video: HTMLVideoElement) {
  if (Number.isFinite(video.duration)) return;
  const onTimeUpdate = () => {
    video.removeEventListener("timeupdate", onTimeUpdate);
    video.currentTime = 0;
  };
  video.addEventListener("timeupdate", onTimeUpdate);
  video.currentTime = 1e101;
}

export function PackingEvidenceDialog({
  taskId,
  staffName,
  onClose,
}: {
  taskId: string | null;
  staffName: (userId: string | null | undefined) => string;
  onClose: () => void;
}) {
  const [review, setReview] = useState<PackingEvidenceReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PackingEvidenceSession | null>(null);
  // keyed by session id, so switching sessions shows "loading" without resetting state in an effect
  const [video, setVideo] = useState<{ id: string; url?: string; error?: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const current = video && selected && video.id === selected.id ? video : null;
  const videoUrl = current?.url || null;
  const videoError = current?.error || null;
  const loadingVideo = Boolean(selected && selected.storage_status === "AVAILABLE" && !current);

  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    packingService
      .getEvidenceVideos(taskId)
      .then((data) => {
        if (!alive) return;
        setReview(data);
        setSelected(data.sessions.find((s) => s.storage_status === "AVAILABLE") || data.sessions[0] || null);
      })
      .catch((err) => alive && setError(getApiErrorMessage(err, "Không tải được bằng chứng đóng gói")));
    return () => {
      alive = false;
    };
  }, [taskId]);

  useEffect(() => {
    if (!taskId || !selected || selected.storage_status !== "AVAILABLE") return;
    const sessionId = selected.id;
    let alive = true;
    let url: string | null = null;
    packingService
      .getEvidenceVideoBlob(taskId, selected.id)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setVideo({ id: sessionId, url });
      })
      .catch(async (err) => {
        // responseType blob: the JSON error body arrives as a Blob too
        const body = (err as { response?: { data?: unknown } }).response?.data;
        let message = getApiErrorMessage(err, "Không tải được video");
        if (body instanceof Blob) {
          try {
            message = JSON.parse(await body.text()).message || message;
          } catch {
            /* keep the generic message */
          }
        }
        if (alive) setVideo({ id: sessionId, error: message });
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [taskId, selected]);

  const task = review?.task;

  return (
    <Dialog open={Boolean(taskId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bằng chứng đóng gói {task?.outbound_order?.outbound_number ? `#${task.outbound_order.outbound_number}` : ""}</DialogTitle>
          <DialogDescription>
            {task
              ? `${task.task_number} · ${task.warehouse?.name || ""} · Người đóng gói: ${staffName(task.assigned_packer_id)}${task.completed_at ? ` · Hoàn tất ${formatDateTime(task.completed_at)}` : ""}`
              : "Video ghi lại quá trình đóng gói của đơn này."}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-[13px] text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : !review ? (
          <div className="flex justify-center py-10"><LoadingSpinner message="Đang tải bằng chứng..." /></div>
        ) : review.sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
            Đơn này chưa có video bằng chứng nào được lưu.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
              {selected?.storage_status === "MISSING" ? (
                <p className="px-6 text-center text-[13px] text-white/80">Tệp video của phiên này không còn trên máy chủ (đã bị xóa hoặc mất khi lưu trữ).</p>
              ) : videoError ? (
                <p role="alert" className="px-6 text-center text-[13px] text-white/80">{videoError}</p>
              ) : loadingVideo || !videoUrl ? (
                <p className="text-[13px] text-white/70">Đang tải video...</p>
              ) : (
                <video
                  ref={videoRef}
                  key={videoUrl}
                  src={videoUrl}
                  controls
                  playsInline
                  className="h-full w-full"
                  onLoadedMetadata={(e) => fixWebmDuration(e.currentTarget)}
                  onError={() => selected && setVideo({ id: selected.id, error: "Trình duyệt không phát được tệp video này." })}
                />
              )}
            </div>

            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">
                {review.sessions.length > 1 ? `${review.sessions.length} phiên ghi hình (đơn bị gián đoạn hoặc mở lại)` : "1 phiên ghi hình"}
              </p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {review.sessions.map((session, index) => (
                  <li key={session.id}>
                    <Button
                      variant="ghost"
                      onClick={() => setSelected(session)}
                      aria-pressed={selected?.id === session.id}
                      className={cn("h-auto w-full justify-start gap-3 rounded-none px-3 py-2.5 text-left", selected?.id === session.id && "bg-muted")}
                    >
                      <Video className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-foreground">
                          Phiên {index + 1}: {session.started_at ? `${formatDateTime(session.started_at)} → ` : ""}{formatDateTime(session.ended_at)}
                        </span>
                        <span className="block text-[12px] text-muted-foreground">
                          {staffName(session.captured_by_user_id)}{session.size ? ` · ${formatSize(session.size)}` : ""}
                        </span>
                      </span>
                      <span className={cn("text-[12px]", session.storage_status === "AVAILABLE" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                        {session.storage_status === "AVAILABLE" ? "Đã lưu" : "Mất tệp"}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
