import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { packingService } from "@/services/packing";
import { getApiErrorMessage } from "@/services/api.ts";

/**
 * "Recording Manager" for the Packing Station: one MediaRecorder session per order (Packing
 * Session), independent from the camera's own lifecycle (see use-packing-camera.ts) — the same
 * MediaStream is reused across sessions, only the recorder instance changes. Starting a session
 * for a different order immediately stops and uploads whatever was recording before; it never
 * waits, so one video never spans two orders.
 */
export function usePackingRecordingSession(getStream: () => MediaStream | null) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  // Whichever stopActiveSession() call is currently waiting on this session's upload — set
  // right before recorder.stop(), consumed by the recorder's onstop handler once the upload
  // (started there) settles. Needed because recorder.onstop is registered once in startSession,
  // long before the eventual stopActiveSession() call supplies its own callbacks.
  const pendingStopRef = useRef<{ onStopped?: () => void; onUploadFailed?: () => void } | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      recorderRef.current = null;
    };
  }, []);

  // Only runs the pending callbacks once the video has actually finished uploading — calling
  // the "stopped" callback (e.g. finalizeComplete, which calls the complete API) right after
  // recorder.stop() raced ahead of this upload, so a slow network could complete the packing
  // task before its own required evidence was saved (inventory-service now rejects that, but
  // the race existed regardless and only surfaced as a confusing failure).
  const uploadSessionBlob = useCallback(async (sessionId: string, blob: Blob) => {
    const pending = pendingStopRef.current;
    pendingStopRef.current = null;

    if (blob.size === 0) {
      if (mountedRef.current) {
        toast.error("Không ghi được video cho phiên đóng gói này. Vui lòng quay lại danh sách và mở lại đơn để quay video lại từ đầu.");
      }
      pending?.onUploadFailed?.();
      return;
    }

    try {
      await packingService.uploadVideoEvidence(sessionId, blob);
      if (mountedRef.current) {
        setSavedCount((count) => count + 1);
        toast.success("Đã lưu video đóng gói");
      }
      pending?.onStopped?.();
    } catch (error) {
      if (mountedRef.current) {
        toast.error(
          getApiErrorMessage(error, "Không thể lưu video đóng gói. Đơn chưa được hoàn tất — vui lòng quay lại danh sách và mở lại đơn để quay video lại từ đầu."),
        );
      }
      // Do NOT call onStopped(): completing without the video actually saved would just hit
      // inventory-service's own evidence check and fail there anyway, less clearly.
      pending?.onUploadFailed?.();
    }
  }, []);

  /** Stop whatever is currently recording. `expectedSessionId`, if given, guards against a
   *  delayed caller (e.g. a 15s grace-period timer) stopping a DIFFERENT session that has since
   *  taken over — in that case this is a silent no-op and neither callback is called.
   *  `onStopped` fires only after the video finishes uploading successfully; `onUploadFailed`
   *  fires instead if the upload fails (or nothing was actually recorded), so callers can reset
   *  their own "finalizing" UI state and let staff retry. */
  const stopActiveSession = useCallback(
    (expectedSessionId?: string, onStopped?: () => void, onUploadFailed?: () => void) => {
      if (expectedSessionId && activeSessionIdRef.current !== expectedSessionId) return;

      const recorder = recorderRef.current;
      const sessionId = activeSessionIdRef.current;
      recorderRef.current = null;
      activeSessionIdRef.current = null;
      setIsRecording(false);
      setActiveSessionId(null);

      if (!recorder || !sessionId) {
        onStopped?.(); // nothing was recording — nothing to wait for
        return;
      }

      if (recorder.state !== "inactive") {
        pendingStopRef.current = { onStopped, onUploadFailed };
        recorder.stop(); // onstop (registered in startSession) uploads this session's chunks, then runs the pending callback above
      } else {
        // Already inactive (e.g. the underlying track ended on its own) — onstop already ran
        // once and won't fire again, so there is nothing left to wait on for this session.
        onStopped?.();
      }
    },
    [],
  );

  const startSession = useCallback(
    (sessionId: string) => {
      if (activeSessionIdRef.current === sessionId && recorderRef.current) {
        return; // already the active order's session — keep recording, don't restart
      }
      if (activeSessionIdRef.current && activeSessionIdRef.current !== sessionId) {
        stopActiveSession(); // a different order was recording — cut it over now, don't wait
      }

      const stream = getStream();
      if (!stream) return;

      const chunks: Blob[] = []; // per-session, never shared — avoids a race with the next session
      try {
        const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => {
          void uploadSessionBlob(sessionId, new Blob(chunks, { type: "video/webm" }));
        };
        recorder.start();
        recorderRef.current = recorder;
        activeSessionIdRef.current = sessionId;
        if (mountedRef.current) {
          setIsRecording(true);
          setActiveSessionId(sessionId);
        }
      } catch {
        toast.error("Không thể bắt đầu ghi hình cho đơn này.");
      }
    },
    [getStream, stopActiveSession, uploadSessionBlob],
  );

  return { isRecording, activeSessionId, savedCount, startSession, stopActiveSession };
}
