import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Camera as CameraIcon, ClipboardList, PackageCheck, QrCode, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, LoadingSpinner, StatusBadge, WorkflowStepper, type WorkflowStep } from "@/components/ui";
import { PageHeader } from "@/components/ui/page-header";
import { FadeItem, PageWrapper } from "../motion-utils";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { PackingCameraPanel } from "@/components/packing-camera-panel";
import { getApiErrorMessage } from "@/services/api.ts";
import { packingService, type PackingEvidence, type PackingTask } from "@/services/packing";
import { usePackingCamera } from "@/hooks/usePackingCamera";
import { usePackingRecordingSession } from "@/hooks/usePackingRecordingSession";
import { useHardwareScanner } from "@/hooks/useHardwareScanner";

type ActivePackingTask = PackingTask & { id: string; task_number: string; packing_camera_evidence?: PackingEvidence[] };

// Configurable, not hardcoded — override per deployment via VITE_PACKING_RECORD_DELAY_SECONDS.
const RECORD_DELAY_SECONDS = Number(import.meta.env.VITE_PACKING_RECORD_DELAY_SECONDS) || 15;

function normalizeTitleForCompare(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Book titles the AI read off the evidence photo that don't match any item expected in this order — a possible sign of a mixed-up order. */
function findUnexpectedTitles(detectedTitles: string[], expectedTitles: string[]): string[] {
  const normalizedExpected = expectedTitles.map(normalizeTitleForCompare).filter(Boolean);
  return detectedTitles.filter((detected) => {
    const normalizedDetected = normalizeTitleForCompare(detected);
    if (normalizedDetected.length < 3) return false;
    return !normalizedExpected.some((exp) => exp.includes(normalizedDetected) || normalizedDetected.includes(exp));
  });
}

export function PackingPage() {
  // Camera is owned at the page level and persists for as long as /packing is open — it must
  // never mount/unmount per order. Recording is a separate, per-order "Packing Session".
  const camera = usePackingCamera();
  const getCameraStream = useCallback(() => camera.streamRef.current, [camera.streamRef]);
  const { isRecording, activeSessionId, savedCount, startSession, stopActiveSession } =
    usePackingRecordingSession(getCameraStream);

  const [task, setTask] = useState<ActivePackingTask | null>(null);
  const [pendingTasks, setPendingTasks] = useState<PackingTask[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  // Tracks which single order (if any) is between "grace-period countdown" and "finalize API
  // resolved" — scoped by id rather than a single global flag so finishing order A in the
  // background never blocks scanning for order B right after switching to it.
  const [finalizingTaskId, setFinalizingTaskId] = useState<string | null>(null);
  const [isManualScanOpen, setIsManualScanOpen] = useState(false);
  const [lastScanFeedback, setLastScanFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [recordCountdown, setRecordCountdown] = useState<number | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTaskIdRef = useRef<string | null>(null);
  const finalizingRef = useRef(false);

  const completingCurrentTask = task
    ? (recordCountdown !== null && countdownTaskIdRef.current === task.id) || finalizingTaskId === task.id
    : false;

  const items = useMemo(() => task?.packing_task_items || [], [task]);
  const allVerified = items.length > 0 && items.every((item) => item.status === "VERIFIED");
  const verifiedItemsCount = items.filter((item) => item.status === "VERIFIED").length;
  const expectedTitles = useMemo(
    () => items.map((item) => item.book_variants?.books?.title).filter((title): title is string => Boolean(title)),
    [items],
  );

  const [photoEvidence, setPhotoEvidence] = useState<PackingEvidence[]>([]);
  const [capturingPhoto, setCapturingPhoto] = useState(false);

  useEffect(() => {
    setPhotoEvidence((task?.packing_camera_evidence || []).filter((e) => e.evidence_type !== "VIDEO"));
    // Reset only when switching to a different task, not on every task detail refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const handleCapturePhotoEvidence = useCallback(async () => {
    if (!task?.id || !camera.videoRef.current || !camera.isLive) return;
    setCapturingPhoto(true);
    try {
      const video = camera.videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Không thể xử lý ảnh từ camera");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

      const { evidence } = await packingService.uploadEvidence(task.id, "PHOTO", dataUrl);
      setPhotoEvidence((current) => [...current, evidence]);

      if (evidence.ai_verification_status === "MISMATCH") {
        toast.warning(
          `AI phát hiện lệch số lượng: đếm được ${evidence.ai_verification_result?.item_count ?? "?"} / mong đợi ${evidence.ai_verification_result?.expected_count ?? "?"}`,
        );
      } else if (evidence.ai_verification_status === "MATCH") {
        toast.success("AI xác minh: số lượng khớp với đơn đóng gói.");
      } else {
        toast.info("Đã lưu ảnh xác minh (AI hiện không khả dụng).");
      }

      const unexpectedTitles = findUnexpectedTitles(
        evidence.ai_verification_result?.detected_titles || [],
        expectedTitles,
      );
      if (unexpectedTitles.length > 0) {
        toast.warning(
          `⚠️ AI phát hiện tên sách không có trong đơn này: ${unexpectedTitles.join(", ")} — kiểm tra có bị lẫn đơn khác không.`,
        );
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể chụp/tải ảnh xác minh"));
    } finally {
      setCapturingPhoto(false);
    }
  }, [task?.id, camera.videoRef, camera.isLive, expectedTitles]);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const { tasks } = await packingService.getTasks();
      setPendingTasks(tasks.filter((item) => item.status !== "COMPLETED" && item.status !== "CANCELLED"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách chờ đóng gói"));
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const clearRecordCountdown = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    countdownTaskIdRef.current = null;
    setRecordCountdown(null);
  }, []);

  useEffect(() => clearRecordCountdown, [clearRecordCountdown]);

  const finalizeComplete = useCallback(
    async (taskId: string) => {
      if (finalizingRef.current) return;
      finalizingRef.current = true;
      try {
        const result = await packingService.completeTask(taskId);
        setTask((current) => (current && current.id === taskId ? (result.task as ActivePackingTask) : current));
        toast.success(`Đã hoàn tất đóng gói đơn ${result.task.outbound_orders?.outbound_number || ""}.`);
        void loadQueue();
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không thể hoàn tất đóng gói"));
      } finally {
        finalizingRef.current = false;
        setFinalizingTaskId((current) => (current === taskId ? null : current));
      }
    },
    [loadQueue],
  );

  // All items scanned — camera keeps recording for a grace period so staff can finish boxing
  // (tape, final check) before the packing session is actually marked complete.
  const startRecordCountdown = useCallback(
    (taskId: string) => {
      if (countdownIntervalRef.current && countdownTaskIdRef.current === taskId) return;
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

      countdownTaskIdRef.current = taskId;
      setRecordCountdown(RECORD_DELAY_SECONDS);
      countdownIntervalRef.current = setInterval(() => {
        setRecordCountdown((seconds) => {
          if (seconds === null || seconds <= 1) {
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
            }
            countdownTaskIdRef.current = null;
            setFinalizingTaskId(taskId);
            stopActiveSession(taskId, () => void finalizeComplete(taskId));
            return null;
          }
          return seconds - 1;
        });
      }, 1000);
    },
    [stopActiveSession, finalizeComplete],
  );

  // A different order is about to become active — cut the previous order's recording session
  // over right now instead of leaving it running. If it had already finished scanning (grace
  // period pending), it's business-complete too — just with a shorter video than usual.
  const supersedeActiveSessionIfNeeded = useCallback(
    (newTaskId: string) => {
      const oldTaskId = activeSessionId;
      if (!oldTaskId || oldTaskId === newTaskId) return;

      const wasCountingDown = countdownTaskIdRef.current === oldTaskId;
      clearRecordCountdown();

      if (wasCountingDown) {
        setFinalizingTaskId(oldTaskId);
        stopActiveSession(oldTaskId, () => void finalizeComplete(oldTaskId));
      } else {
        stopActiveSession(oldTaskId);
      }
    },
    [activeSessionId, clearRecordCountdown, stopActiveSession, finalizeComplete],
  );

  const refreshTask = useCallback(
    async (taskId: string) => {
      supersedeActiveSessionIfNeeded(taskId);
      const { task: detail } = await packingService.getTaskDetail(taskId);
      setTask(detail as ActivePackingTask);
      if (detail.status !== "COMPLETED" && detail.id) {
        startSession(detail.id);
      }
    },
    [supersedeActiveSessionIfNeeded, startSession],
  );

  const handleScanInvoice = useCallback(
    async (code: string) => {
      setLoadingInvoice(true);
      try {
        const result = await packingService.scanInvoice(code);
        if (result.task.id) supersedeActiveSessionIfNeeded(result.task.id);
        setTask(result.task as ActivePackingTask);
        setLastScanFeedback(null);
        toast.success(`Đã tải đơn ${result.outbound_order.outbound_number}`);
        if (result.task.status !== "COMPLETED" && result.task.id) {
          startSession(result.task.id);
        }
        void loadQueue();
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không thể tải đơn từ mã quét"));
      } finally {
        setLoadingInvoice(false);
      }
    },
    [supersedeActiveSessionIfNeeded, startSession, loadQueue],
  );

  const openPendingTask = useCallback(
    async (entry: PackingTask) => {
      setLoadingInvoice(true);
      try {
        if (entry.id) {
          await refreshTask(entry.id);
        } else if (entry.outbound_orders?.outbound_number) {
          await handleScanInvoice(entry.outbound_orders.outbound_number);
        }
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Không thể mở đơn đóng gói"));
      } finally {
        setLoadingInvoice(false);
      }
    },
    [handleScanInvoice, refreshTask],
  );

  const backToQueue = useCallback(() => {
    setTask(null);
    setLastScanFeedback(null);
    void loadQueue();
  }, [loadQueue]);

  const lastProcessedScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const handleScannedBarcode = useCallback(
    async (rawCode: string) => {
      if (!task || task.status === "COMPLETED" || completingCurrentTask) return;
      const code = rawCode.trim();
      if (!code) return;

      // The hardware scanner and the camera can both "see" the same physical scan
      // within the same instant — collapse duplicates instead of double-submitting.
      const now = Date.now();
      const last = lastProcessedScanRef.current;
      if (code === last.code && now - last.at < 1500) return;
      lastProcessedScanRef.current = { code, at: now };

      try {
        const result = await packingService.scanItem(task.id, code);
        setLastScanFeedback({ ok: true, message: "Đúng sách" });
        toast.success("✓ Đúng sách");
        await refreshTask(task.id);
        if (result.all_items_verified) {
          startRecordCountdown(task.id);
        }
      } catch (error) {
        const message = getApiErrorMessage(error, "Sách không khớp với đơn đóng gói");
        setLastScanFeedback({ ok: false, message });
        toast.error(message);
      }
    },
    [task, completingCurrentTask, refreshTask, startRecordCountdown],
  );

  // Single dispatcher for EVERY scan source (hardware scanner, camera auto-scan, manual modal):
  // no order open → treat the code as an invoice/outbound number; order open → treat as a book.
  const handleAnyScannedCode = useCallback(
    (code: string) => {
      if (task) {
        void handleScannedBarcode(code);
      } else {
        void handleScanInvoice(code);
      }
    },
    [task, handleScannedBarcode, handleScanInvoice],
  );

  // Route camera auto-detected codes through the same dispatcher — swapping the handler never
  // restarts the camera or its scan loop (see hooks/use-packing-camera.ts).
  useEffect(() => {
    if (task?.status === "COMPLETED" || completingCurrentTask) {
      camera.setBarcodeHandler(null);
    } else {
      camera.setBarcodeHandler(handleAnyScannedCode);
    }
  }, [task?.status, completingCurrentTask, handleAnyScannedCode, camera.setBarcodeHandler]);

  // Hardware keyboard-wedge scanner — listens for the whole time the Packing page is open, not
  // just while an order is selected, so an invoice barcode scans exactly like a book barcode.
  useHardwareScanner(handleAnyScannedCode);

  // Manual override: skip whatever is left of the grace-period countdown and finish right away.
  const handleCompletePackingNow = useCallback(() => {
    if (!task || !allVerified) return;
    clearRecordCountdown();
    setFinalizingTaskId(task.id);
    stopActiveSession(task.id, () => void finalizeComplete(task.id));
  }, [task, allVerified, clearRecordCountdown, stopActiveSession, finalizeComplete]);

  const steps: WorkflowStep[] = useMemo(
    () => [
      { id: "scan-invoice", label: "Scan hoá đơn", icon: QrCode, status: task ? "completed" : "active" },
      {
        id: "verify-items",
        label: "Scan từng sách",
        icon: ScanLine,
        status: !task ? "pending" : allVerified ? "completed" : "active",
      },
      { id: "camera", label: "Camera giám sát", icon: ClipboardList, status: camera.isLive ? "completed" : "active" },
      { id: "complete", label: "Hoàn tất", icon: PackageCheck, status: task?.status === "COMPLETED" ? "completed" : "pending" },
    ],
    [task, allVerified, camera.isLive],
  );

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="rounded-xl border border-border bg-gradient-to-br from-primary/[0.06] to-transparent dark:from-primary/[0.09] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
          <PageHeader
            icon={PackageCheck}
            title="Packing Station"
            description="Camera luôn bật để giám sát và hỗ trợ quét — chọn một đơn bên phải để bắt đầu đóng gói."
            iconBg="bg-indigo-100 dark:bg-indigo-500/15"
            iconColor="text-indigo-700 dark:text-indigo-400"
          />
          <div className="mt-5 pt-5 border-t border-border/70">
            <WorkflowStepper steps={steps} />
          </div>
        </div>
      </FadeItem>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-5 items-start">
        <FadeItem>
          <PackingCameraPanel
            videoRef={camera.videoRef}
            isLive={camera.isLive}
            cameraError={camera.cameraError}
            isRecording={isRecording}
            autoScanSupported={camera.autoScanSupported}
            savedCount={savedCount}
          />
        </FadeItem>

        <div className="space-y-5">
          {!task ? (
            <>
              <FadeItem>
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
                  <div className="flex flex-col items-center gap-3 bg-gradient-to-br from-primary/[0.06] to-transparent dark:from-primary/[0.09] px-6 py-7 text-center border-b border-border">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <QrCode className="h-6 w-6" />
                    </div>
                    <p className="text-[13px] text-muted-foreground max-w-xs">Quét hoá đơn / mã đơn xuất kho để bắt đầu đóng gói</p>
                    <Button size="lg" loading={loadingInvoice} onClick={() => setIsManualScanOpen(true)}>
                      Scan hoá đơn
                    </Button>
                  </div>

                  <div className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">Đơn đang chờ đóng gói</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Đơn đã Picking xong, chưa hoàn tất Gói hàng</p>
                    </div>
                    {pendingTasks.length > 0 && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {pendingTasks.length}
                      </span>
                    )}
                  </div>

                  {loadingQueue ? (
                    <div className="px-5 py-8 flex justify-center border-t border-border">
                      <LoadingSpinner message="Đang tải..." />
                    </div>
                  ) : pendingTasks.length === 0 ? (
                    <div className="px-5 py-8 border-t border-border">
                      <EmptyState
                        icon={PackageCheck}
                        title="Không có đơn nào đang chờ"
                        description="Tất cả đơn đã Picking xong đều đã được đóng gói."
                      />
                    </div>
                  ) : (
                    <div className="divide-y divide-border border-t border-border">
                      {pendingTasks.map((entry) => {
                        const status =
                          entry.status === "NOT_STARTED"
                            ? { label: "Chờ bắt đầu", variant: "warning" as const }
                            : entry.id === activeSessionId
                              ? { label: "Đang ghi hình", variant: "danger" as const }
                              : { label: "Đang đóng gói", variant: "primary" as const };
                        return (
                          <button
                            key={entry.id || entry.root_order_id}
                            onClick={() => void openPendingTask(entry)}
                            className="group flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-muted/50 transition-colors cursor-pointer"
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                              <PackageCheck className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-medium text-foreground truncate">
                                {entry.outbound_orders?.outbound_number || entry.root_order_id}
                              </p>
                              <p className="text-[11px] text-muted-foreground truncate">{entry.warehouses?.name}</p>
                            </div>
                            <StatusBadge label={status.label} variant={status.variant} dot />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </FadeItem>
            </>
          ) : (
            <>
              <FadeItem>
                <div
                  className={`rounded-xl border bg-card p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none border-l-4 ${
                    task.status === "COMPLETED"
                      ? "border-l-muted-foreground/30"
                      : recordCountdown !== null && countdownTaskIdRef.current === task.id
                        ? "border-l-amber-500"
                        : "border-l-emerald-500"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <button
                        onClick={backToQueue}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary cursor-pointer mb-1.5"
                      >
                        <ArrowLeft className="h-3 w-3" /> Quay lại danh sách
                      </button>
                      <p className="text-[15px] font-semibold text-foreground">
                        Đơn {task.outbound_orders?.outbound_number}
                      </p>
                      <p className="text-[11px] text-muted-foreground">Packing {task.task_number}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {task.status === "COMPLETED" ? (
                        <span className="rounded-full bg-muted px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
                          Đã đóng gói
                        </span>
                      ) : recordCountdown !== null && countdownTaskIdRef.current === task.id ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                          Đang lưu video... {recordCountdown}s
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                          <ScanLine className="h-3.5 w-3.5 animate-pulse" /> Sẵn sàng quét
                        </span>
                      )}
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          loading={capturingPhoto}
                          disabled={!camera.isLive || task.status === "COMPLETED"}
                          onClick={() => void handleCapturePhotoEvidence()}
                          title="Chụp ảnh sách đã đóng gói để AI xác minh số lượng"
                        >
                          <CameraIcon className="h-3.5 w-3.5" />
                          Chụp ảnh xác minh
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={allVerified || completingCurrentTask || task.status === "COMPLETED"}
                          onClick={() => setIsManualScanOpen(true)}
                          title="Nhập/paste barcode thủ công khi máy quét hoặc camera không đọc được"
                        >
                          Scan sách
                        </Button>
                      </div>
                    </div>
                  </div>

                  {photoEvidence.length > 0 ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {photoEvidence.map((evidence) => {
                        const unexpectedTitles = findUnexpectedTitles(
                          evidence.ai_verification_result?.detected_titles || [],
                          expectedTitles,
                        );
                        return (
                          <span key={evidence.id} className="inline-flex flex-wrap items-center gap-1.5">
                            <span
                              title={
                                evidence.ai_verification_result
                                  ? `Đếm được ${evidence.ai_verification_result.item_count} / mong đợi ${evidence.ai_verification_result.expected_count}`
                                  : undefined
                              }
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                evidence.ai_verification_status === "MATCH"
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                                  : evidence.ai_verification_status === "MISMATCH"
                                    ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                                    : "bg-muted text-muted-foreground"
                              }`}
                            >
                              <CameraIcon className="h-3 w-3" />
                              {evidence.ai_verification_status === "MATCH"
                                ? "AI: Khớp"
                                : evidence.ai_verification_status === "MISMATCH"
                                  ? "AI: Lệch số lượng"
                                  : "AI: Chưa xác minh"}
                            </span>
                            {unexpectedTitles.length > 0 && (
                              <span
                                title={`AI phát hiện: ${unexpectedTitles.join(", ")}`}
                                className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 dark:bg-orange-500/10 dark:text-orange-400"
                              >
                                ⚠️ Nghi lẫn đơn
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}

                  {items.length > 0 && (
                    <div className="mb-3 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                          style={{ width: `${Math.round((verifiedItemsCount / items.length) * 100)}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                        {verifiedItemsCount}/{items.length} đầu sách
                      </span>
                    </div>
                  )}

                  <div className="divide-y divide-border">
                    {items.map((item) => (
                      <div key={item.id} className="py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[13px] text-foreground truncate">
                              {item.book_variants?.books.title || item.book_variants?.sku}
                            </p>
                            <p className="text-[11px] text-muted-foreground">SKU {item.book_variants?.sku}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-[12px] text-muted-foreground">
                              {item.scanned_qty}/{item.expected_qty}
                            </span>
                            {item.status === "VERIFIED" ? <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /> : null}
                          </div>
                        </div>
                        {item.expected_qty > 1 && (
                          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${item.status === "VERIFIED" ? "bg-emerald-500" : "bg-primary"}`}
                              style={{ width: `${Math.min(100, Math.round((item.scanned_qty / item.expected_qty) * 100))}%` }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {lastScanFeedback && !lastScanFeedback.ok ? (
                    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                      {lastScanFeedback.message}
                    </p>
                  ) : null}
                </div>
              </FadeItem>

              <FadeItem>
                <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none flex items-center justify-between gap-3">
                  <p className="text-[12px] text-muted-foreground">
                    {recordCountdown !== null && countdownTaskIdRef.current === task.id
                      ? `Đã scan đủ — camera ghi thêm ${recordCountdown}s trước khi hoàn tất.`
                      : allVerified
                        ? "Đã scan đủ tất cả sách."
                        : "Cần scan đủ số lượng từng đầu sách trước khi hoàn tất."}
                  </p>
                  <button
                    disabled={!allVerified || task.status === "COMPLETED" || (completingCurrentTask && recordCountdown === null)}
                    onClick={handleCompletePackingNow}
                    className="inline-flex shrink-0 items-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
                  >
                    {task.status !== "COMPLETED" && !completingCurrentTask && <CheckCircle2 className="h-4 w-4" />}
                    {task.status === "COMPLETED"
                      ? "Đã hoàn tất"
                      : recordCountdown !== null && countdownTaskIdRef.current === task.id
                        ? `Hoàn tất ngay (bỏ qua ${recordCountdown}s)`
                        : completingCurrentTask
                          ? "Đang xử lý..."
                          : "Hoàn tất đóng gói"}
                  </button>
                </div>
              </FadeItem>
            </>
          )}
        </div>
      </div>

      <BarcodeScanModal
        isOpen={isManualScanOpen}
        onClose={() => setIsManualScanOpen(false)}
        onDetected={(code) => {
          setIsManualScanOpen(false);
          handleAnyScannedCode(code);
        }}
        title={task ? "Scan sách (nhập tay)" : "Scan hoá đơn"}
      />
    </PageWrapper>
  );
}
