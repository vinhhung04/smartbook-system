import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardList, PackageCheck, QrCode, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui";
import { FadeItem, PageWrapper } from "../motion-utils";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { PackingCameraPanel } from "@/components/packing-camera-panel";
import { getApiErrorMessage } from "@/services/api.ts";
import { packingService, type PackingTask } from "@/services/packing";
import { usePackingCamera } from "@/hooks/usePackingCamera";
import { usePackingRecordingSession } from "@/hooks/usePackingRecordingSession";

type ActivePackingTask = PackingTask & { id: string; task_number: string };

// Keyboard-wedge USB/Bluetooth barcode scanners "type" a code very fast (a few ms
// between keystrokes) and terminate with Enter — much faster than a human typing.
const SCANNER_KEY_GAP_MS = 100;
const SCANNER_MIN_CODE_LENGTH = 3;

// Configurable, not hardcoded — override per deployment via VITE_PACKING_RECORD_DELAY_SECONDS.
const RECORD_DELAY_SECONDS = Number(import.meta.env.VITE_PACKING_RECORD_DELAY_SECONDS) || 15;

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
  useEffect(() => {
    let buffer = "";
    let lastKeyTime = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

      const now = Date.now();
      if (now - lastKeyTime > SCANNER_KEY_GAP_MS) {
        buffer = "";
      }
      lastKeyTime = now;

      if (event.key === "Enter") {
        if (buffer.length >= SCANNER_MIN_CODE_LENGTH) {
          handleAnyScannedCode(buffer);
        }
        buffer = "";
        return;
      }

      if (event.key.length === 1) {
        buffer += event.key;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleAnyScannedCode]);

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
        <h1 className="tracking-[-0.02em]">Packing Station</h1>
        <p className="text-[12px] text-slate-500 mt-1">
          Camera luôn bật để giám sát và hỗ trợ quét — chọn một đơn bên phải để bắt đầu đóng gói.
        </p>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <WorkflowStepper steps={steps} />
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
                <div className="rounded-[16px] border border-white/80 bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03)] text-center">
                  <QrCode className="h-8 w-8 text-indigo-400 mx-auto mb-2" />
                  <p className="text-[13px] text-slate-600 mb-3">Quét hoá đơn / mã đơn xuất kho để bắt đầu đóng gói</p>
                  <button
                    disabled={loadingInvoice}
                    onClick={() => setIsManualScanOpen(true)}
                    className="rounded-[10px] bg-indigo-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {loadingInvoice ? "Đang tải..." : "Scan hoá đơn"}
                  </button>
                </div>
              </FadeItem>

              <FadeItem>
                <div className="overflow-hidden rounded-[16px] border border-white/80 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
                  <div className="border-b border-slate-100 px-5 py-3">
                    <p className="text-[13px] font-semibold text-slate-700">Đơn đang chờ đóng gói</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Đơn đã Picking xong, chưa hoàn tất Gói hàng</p>
                  </div>
                  {loadingQueue ? (
                    <p className="px-5 py-6 text-[13px] text-slate-500">Đang tải...</p>
                  ) : pendingTasks.length === 0 ? (
                    <p className="px-5 py-6 text-[13px] text-slate-500">Không có đơn nào đang chờ đóng gói.</p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {pendingTasks.map((entry) => (
                        <button
                          key={entry.id || entry.root_order_id}
                          onClick={() => void openPendingTask(entry)}
                          className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-slate-50"
                        >
                          <div>
                            <p className="text-[13px] font-medium text-slate-700">
                              {entry.outbound_orders?.outbound_number || entry.root_order_id}
                            </p>
                            <p className="text-[11px] text-slate-400">{entry.warehouses?.name}</p>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                              entry.status === "NOT_STARTED"
                                ? "bg-amber-50 text-amber-700"
                                : entry.id === activeSessionId
                                  ? "bg-red-50 text-red-600"
                                  : "bg-indigo-50 text-indigo-700"
                            }`}
                          >
                            {entry.status === "NOT_STARTED"
                              ? "Chờ bắt đầu"
                              : entry.id === activeSessionId
                                ? "Đang ghi hình"
                                : "Đang đóng gói"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </FadeItem>
            </>
          ) : (
            <>
              <FadeItem>
                <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <button
                        onClick={backToQueue}
                        className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-600 mb-1"
                      >
                        <ArrowLeft className="h-3 w-3" /> Quay lại danh sách
                      </button>
                      <p className="text-[13px] font-semibold text-slate-700">
                        Đơn {task.outbound_orders?.outbound_number} — Packing {task.task_number}
                      </p>
                      <p className="text-[11px] text-slate-500">Trạng thái: {task.status}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {task.status === "COMPLETED" ? (
                        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-500">
                          Đã đóng gói
                        </span>
                      ) : recordCountdown !== null && countdownTaskIdRef.current === task.id ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700">
                          Đang lưu video... {recordCountdown}s
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
                          <ScanLine className="h-3.5 w-3.5 animate-pulse" /> Sẵn sàng quét
                        </span>
                      )}
                      <button
                        disabled={allVerified || completingCurrentTask || task.status === "COMPLETED"}
                        onClick={() => setIsManualScanOpen(true)}
                        title="Nhập/paste barcode thủ công khi máy quét hoặc camera không đọc được"
                        className="rounded-[10px] border border-slate-200 px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Scan sách
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between py-2.5">
                        <div className="min-w-0">
                          <p className="text-[13px] text-slate-700 truncate">
                            {item.book_variants?.books.title || item.book_variants?.sku}
                          </p>
                          <p className="text-[11px] text-slate-400">SKU {item.book_variants?.sku}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-[12px] text-slate-500">
                            {item.scanned_qty}/{item.expected_qty}
                          </span>
                          {item.status === "VERIFIED" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  {lastScanFeedback && !lastScanFeedback.ok ? (
                    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
                      {lastScanFeedback.message}
                    </p>
                  ) : null}
                </div>
              </FadeItem>

              <FadeItem>
                <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] flex items-center justify-between">
                  <p className="text-[12px] text-slate-500">
                    {recordCountdown !== null && countdownTaskIdRef.current === task.id
                      ? `Đã scan đủ — camera ghi thêm ${recordCountdown}s trước khi hoàn tất.`
                      : allVerified
                        ? "Đã scan đủ tất cả sách."
                        : "Cần scan đủ số lượng từng đầu sách trước khi hoàn tất."}
                  </p>
                  <button
                    disabled={!allVerified || task.status === "COMPLETED" || (completingCurrentTask && recordCountdown === null)}
                    onClick={handleCompletePackingNow}
                    className="rounded-[10px] bg-emerald-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    {task.status === "COMPLETED"
                      ? "Đã hoàn tất"
                      : recordCountdown !== null && countdownTaskIdRef.current === task.id
                        ? `Hoàn tất ngay (bỏ qua ${recordCountdown}s)`
                        : completingCurrentTask
                          ? "Đang xử lý..."
                          : "Complete Packing"}
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
