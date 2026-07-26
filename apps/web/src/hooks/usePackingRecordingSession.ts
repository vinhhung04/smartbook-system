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

  const uploadSessionBlob = useCallback((sessionId: string, blob: Blob) => {
    if (blob.size === 0) return;
    void packingService
      .uploadVideoEvidence(sessionId, blob)
      .then(() => {
        if (mountedRef.current) {
          setSavedCount((count) => count + 1);
          toast.success("Đã lưu video đóng gói");
        }
      })
      .catch((error) => {
        if (mountedRef.current) {
          toast.error(getApiErrorMessage(error, "Không thể lưu video đóng gói"));
        }
      });
  }, []);

  /** Stop whatever is currently recording. `expectedSessionId`, if given, guards against a
   *  delayed caller (e.g. a 15s grace-period timer) stopping a DIFFERENT session that has since
   *  taken over — in that case this is a silent no-op and `onStopped` is not called. */
  const stopActiveSession = useCallback(
    (expectedSessionId?: string, onStopped?: () => void) => {
      if (expectedSessionId && activeSessionIdRef.current !== expectedSessionId) return;

      const recorder = recorderRef.current;
      const sessionId = activeSessionIdRef.current;
      recorderRef.current = null;
      activeSessionIdRef.current = null;
      setIsRecording(false);
      setActiveSessionId(null);

      if (!recorder || !sessionId) return;
      if (recorder.state !== "inactive") {
        recorder.stop(); // onstop (registered in startSession) uploads this session's own chunks
      }
      onStopped?.();
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
          uploadSessionBlob(sessionId, new Blob(chunks, { type: "video/webm" }));
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
