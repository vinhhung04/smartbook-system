import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router";
import { AlertTriangle, ArrowLeft, ImagePlus, Info, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BlockError } from "@/components/pages/dashboard/panel";
import { ChoiceChips, Field, FormGroup, FormSheet, ListFooter, QueueTabs, RefCode, RowsSkeleton } from "@/components/ops/ops-kit";
import { fieldAria, formatDateTime, nativeSelectClass, timeAgo, darkFieldClass } from "@/components/ops/ops-utils";
import { cn } from "@/components/ui/utils";
import { getApiErrorMessage } from "@/services/api";
import { exceptionReportService, type ExceptionReport, type ExceptionReportCreateInput } from "@/services/exception-reports";
import { warehouseService } from "@/services/warehouse";
import { myWarehouseTaskService, type MyWarehouseTask } from "@/services/my-warehouse-tasks";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { getStatusVariant, getWarehouseTaskStatusLabel } from "@/lib/status-registry";

// The task types the exception-report API accepts (VALID_TASK_TYPES in the controller).
const TASK_TYPES = [
  { value: "RECEIVING", label: "Tiếp nhận hàng" },
  { value: "PUTAWAY", label: "Cất hàng vào kho" },
  { value: "PICKING", label: "Lấy hàng" },
  { value: "OUTBOUND", label: "Xuất kho" },
];

const EXCEPTION_TYPES = [
  { value: "SHORT", label: "Thiếu hàng" },
  { value: "OVERAGE", label: "Dư hàng" },
  { value: "DAMAGED", label: "Hư hỏng" },
  { value: "WRONG_ITEM", label: "Sai sản phẩm" },
  { value: "WRONG_QTY", label: "Sai số lượng" },
  { value: "OTHER", label: "Khác" },
];

const STATUS_FILTERS = ["ALL", "OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_LABELS: Record<string, string> = {
  ALL: "Tất cả",
  OPEN: "Đang mở",
  ACKNOWLEDGED: "Đã ghi nhận",
  RESOLVED: "Đã xử lý",
  DISMISSED: "Đã hủy",
};

const PAGE_SIZE = 10;
const PANEL_ID = "exception-report-list";

function taskTypeLabel(type: string) {
  return TASK_TYPES.find((t) => t.value === type)?.label || type;
}

function exceptionLabel(type: string) {
  return EXCEPTION_TYPES.find((t) => t.value === type)?.label || type;
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

interface Warehouse { id: string; code: string; name: string }

interface FormState {
  warehouse_id: string;
  task_type: string;
  task_id: string;
  exception_type: string;
  note: string;
  /** Kept as typed so an empty field stays "not given" and a typed 0 stays 0. */
  expected_qty: string;
  actual_qty: string;
  evidence_notes: string;
  evidence_photo_url?: string;
}

type FormErrors = Partial<Record<"task" | "warehouse" | "note" | "expected" | "actual", string>>;

const emptyForm: FormState = {
  warehouse_id: "",
  task_type: "",
  task_id: "",
  exception_type: "SHORT",
  note: "",
  expected_qty: "",
  actual_qty: "",
  evidence_notes: "",
  evidence_photo_url: undefined,
};

const MAX_EVIDENCE_PHOTO_BYTES = 4 * 1024 * 1024; // keep base64 payload comfortably under the gateway's JSON body limit
// Raster types only — matches the backend allowlist in exception-report.controller.js. SVG is
// excluded because it can carry executable script that would run when rendered via <img src>.
const ALLOWED_EVIDENCE_PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function quantityError(value: string) {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? undefined : "Nhập số nguyên từ 0 trở lên, hoặc để trống.";
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.task_id.trim()) errors.task = "Chọn task đang gặp sự cố.";
  else if (!TASK_TYPES.some((t) => t.value === form.task_type)) errors.task = "Loại công việc này chưa hỗ trợ báo cáo sự cố. Chọn một task tiếp nhận, cất hàng, lấy hàng hoặc xuất kho.";
  if (!form.warehouse_id) errors.warehouse = "Chọn kho xảy ra sự cố.";
  if (!form.note.trim()) errors.note = "Mô tả ngắn gọn điều bạn thấy.";
  errors.expected = quantityError(form.expected_qty);
  errors.actual = quantityError(form.actual_qty);
  return errors;
}

/** Expected → actual, with the signed gap; a dash where a figure was not given. */
function QuantityCell({ report }: { report: ExceptionReport }) {
  const { expected_qty: expected, actual_qty: actual } = report;
  if (expected == null && actual == null) return <span className="text-muted-foreground">—</span>;
  const gap = expected != null && actual != null ? actual - expected : null;
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="text-muted-foreground">{expected ?? "—"}</span>
      <span className="px-1 text-muted-foreground" aria-hidden="true">→</span>
      <span className="font-medium text-foreground">{actual ?? "—"}</span>
      {gap !== null && gap !== 0 ? <span className="ml-1.5 text-[12px] text-muted-foreground">({gap > 0 ? "+" : "−"}{Math.abs(gap)})</span> : null}
      <span className="sr-only"> (dự kiến {expected ?? "không ghi"}, thực tế {actual ?? "không ghi"})</span>
    </span>
  );
}

function ResolutionNote({ report }: { report: ExceptionReport }) {
  if (!report.resolution_notes) return null;
  return (
    <p className="mt-1.5 max-w-prose rounded-md bg-muted/60 px-2.5 py-1.5 text-[12px] leading-5 text-foreground">
      <span className="font-medium">Quản lý{report.resolved_at ? ` (${formatDateTime(report.resolved_at)})` : ""}:</span> {report.resolution_notes}
    </p>
  );
}

/** "17 ngày trước": an age as a phrase inside a sentence. */
function ageText(value: string | null | undefined) {
  return timeAgo(value) ?? "";
}

function bookTitle(report: ExceptionReport) {
  return report.book_variants?.books?.title ?? null;
}

type TrailStep = { key: string; label: string; at?: string | null; state: "done" | "current" | "stopped" };

/** Sent, (assigned), then where the manager has taken it. Built only from fields the API returns. */
function reportTrail(r: ExceptionReport, currentUserId: string | null): TrailStep[] {
  const steps: TrailStep[] = [{ key: "sent", label: "Bạn gửi báo cáo", at: r.created_at, state: "done" }];
  if (r.assigned_to_user_id) {
    steps.push({ key: "assigned", label: r.assigned_to_user_id === currentUserId ? "Quản lý giao bạn xử lý" : "Quản lý giao người xử lý", at: r.assigned_at, state: "done" });
  }
  if (r.status === "RESOLVED") steps.push({ key: "resolved", label: "Quản lý đã xử lý", at: r.resolved_at, state: "done" });
  else if (r.status === "DISMISSED") steps.push({ key: "dismissed", label: "Báo cáo đã hủy", at: r.updated_at, state: "stopped" });
  else if (r.status === "ACKNOWLEDGED") steps.push({ key: "ack", label: "Quản lý đã ghi nhận, đang xử lý", state: "current" });
  else steps.push({ key: "waiting", label: "Chờ quản lý xem", state: "current" });
  return steps;
}

function ReportDetail({ report: r, currentUserId, onBack, onPhoto }: {
  report: ExceptionReport;
  currentUserId: string | null;
  onBack: () => void;
  onPhoto: () => void;
}) {
  const book = r.book_variants;
  const gap = r.expected_qty != null && r.actual_qty != null ? r.actual_qty - r.expected_qty : null;
  const details: Array<{ label: string; value: ReactNode }> = [
    { label: "Kho", value: r.warehouses ? `${r.warehouses.name} (${r.warehouses.code})` : "Chưa rõ kho" },
    { label: "Công việc", value: <>{taskTypeLabel(r.task_type)} <span className="font-mono text-[12px] text-muted-foreground" title={r.task_id}>{r.task_id.slice(0, 8)}</span></> },
    ...(book ? [{ label: "Sách", value: <>{book.books?.title ?? "-"}<span className="block font-mono text-[12px] text-muted-foreground">{[book.isbn13, book.sku].filter(Boolean).join(", ")}</span></> }] : []),
    { label: "Gửi lúc", value: formatDateTime(r.created_at) ?? "-" },
  ];

  return (
    <div>
      <div className="border-b border-border p-5">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3 mb-2 text-muted-foreground @4xl/page:hidden">
          <ArrowLeft className="h-4 w-4" /> Danh sách báo cáo
        </Button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 id="my-exception-detail-title" className="text-[20px] font-semibold tracking-tight text-foreground">
            {exceptionLabel(r.exception_type)}{book?.books?.title ? `: ${book.books.title}` : ""}
          </h2>
          <StatusBadge label={statusLabel(r.status)} variant={getStatusVariant("exceptionReport", r.status)} dot />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[14px] text-muted-foreground">
          <RefCode value={r.report_number} /> <span>gửi {ageText(r.created_at)}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 @3xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-5 p-5">
          {r.expected_qty != null || r.actual_qty != null ? (
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <dt className="text-[13px] text-muted-foreground">Theo chứng từ</dt>
                <dd className="font-serif text-[24px] font-semibold leading-tight tabular-nums text-foreground">{r.expected_qty ?? "-"}<span className="font-sans text-[13px] font-normal text-muted-foreground"> cuốn</span></dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted-foreground">Bạn đếm được</dt>
                <dd className="font-serif text-[24px] font-semibold leading-tight tabular-nums text-foreground">{r.actual_qty ?? "-"}<span className="font-sans text-[13px] font-normal text-muted-foreground"> cuốn</span></dd>
              </div>
              {gap !== null ? (
                <div>
                  <dt className="text-[13px] text-muted-foreground">Chênh lệch</dt>
                  <dd className={cn("font-serif text-[24px] font-semibold leading-tight tabular-nums", gap < 0 ? "text-red-700 dark:text-red-400" : gap > 0 ? "text-amber-800 dark:text-amber-300" : "text-foreground")}>
                    {gap > 0 ? "+" : gap < 0 ? "−" : ""}{Math.abs(gap)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          <div>
            <h3 className="text-[13px] text-muted-foreground">Bạn mô tả</h3>
            <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-foreground">{r.note || "-"}</p>
          </div>
          {r.evidence_notes ? (
            <div>
              <h3 className="text-[13px] text-muted-foreground">Ghi chú bằng chứng</h3>
              <p className="mt-1 whitespace-pre-line text-[14px] text-foreground">{r.evidence_notes}</p>
            </div>
          ) : null}
          {r.evidence_photo_url ? (
            <div>
              <h3 className="text-[13px] text-muted-foreground">Ảnh bằng chứng</h3>
              <button
                type="button"
                onClick={onPhoto}
                className="mt-1.5 block overflow-hidden rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Xem ảnh bằng chứng của ${r.report_number}`}
              >
                <img src={r.evidence_photo_url} alt="" className="h-32 w-44 bg-muted object-cover" />
              </button>
            </div>
          ) : null}

          <div className="border-t border-border pt-5">
            <h3 className="text-[13px] text-muted-foreground">Tiến độ xử lý</h3>
            <ol className="mt-2 space-y-2.5">
              {reportTrail(r, currentUserId).map((step) => (
                <li key={step.key} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      step.state === "done" && "bg-primary",
                      step.state === "current" && "bg-primary/25 ring-2 ring-primary/40",
                      step.state === "stopped" && "bg-muted-foreground/50",
                    )}
                  />
                  <span className="text-[14px]">
                    <span className={cn(step.state === "current" ? "font-medium text-foreground" : "text-foreground")}>{step.label}</span>
                    {step.at ? <span className="ml-2 text-[12px] tabular-nums text-muted-foreground">{formatDateTime(step.at)}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
            <ResolutionNote report={r} />
          </div>
          <p className="text-[13px] text-muted-foreground">Báo cáo sự cố không tự điều chỉnh tồn kho. Quản lý xem xét và quyết định cách xử lý.</p>
        </div>

        <dl className="border-t border-border p-5 @3xl:border-l @3xl:border-t-0">
          {details.map((item) => (
            <div key={item.label} className="flex items-baseline justify-between gap-4 py-1.5 @3xl:block">
              <dt className="shrink-0 text-[13px] text-muted-foreground">{item.label}</dt>
              <dd className="min-w-0 text-right text-[14px] text-foreground @3xl:mt-0.5 @3xl:text-left">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function MyExceptionReportsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentUser = authService.getCurrentUser();
  const canOpenWarehouseTasks = canAccess(currentUser, ROUTE_ACCESS.staffTasks);
  const ids = useId();
  const fieldId = (name: string) => `${ids}-${name}`;

  const [composeOpen, setComposeOpen] = useState(false);
  const [reports, setReports] = useState<ExceptionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [taskList, setTaskList] = useState<MyWarehouseTask[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [photo, setPhoto] = useState<{ name: string; size: number } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [fromTask, setFromTask] = useState(false);
  const [photoReport, setPhotoReport] = useState<ExceptionReport | null>(null);
  const prefillApplied = useRef(false);
  const photoInput = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [page, setPage] = useState(1);

  const load = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "initial") setLoading(true); else setRefreshing(true);
    try {
      const [res, wRes, taskRes] = await Promise.all([
        exceptionReportService.getMyReports(),
        warehouseService.getReceivingWarehouses(),
        myWarehouseTaskService.getMyTasks(),
      ]);
      setReports(Array.isArray(res.data) ? res.data : []);
      const wList = Array.isArray(wRes) ? wRes : [];
      setWarehouses(wList);
      const opTasks = (taskRes.data || []).filter((t) => TASK_TYPES.some((type) => type.value === t.type));
      setTaskList(opTasks);
      setLoadError(null);

      // Apply URL query-param pre-fill once after first load
      if (!prefillApplied.current) {
        const preTaskId = searchParams.get("task_id");
        const preTaskType = searchParams.get("task_type");
        if (preTaskId && preTaskType) {
          prefillApplied.current = true;
          const preWarehouseId = searchParams.get("warehouse_id");
          const preWarehouseStr = searchParams.get("task_warehouse");
          const matchedWH = wList.find(
            (w) => w.id === preWarehouseId || w.code === preWarehouseStr || w.name === preWarehouseStr
          );
          setForm((f) => ({
            ...f,
            task_id: preTaskId,
            task_type: preTaskType,
            warehouse_id: matchedWH?.id ?? f.warehouse_id,
          }));
          setFromTask(true);
          setComposeOpen(true);
        }
      }
    } catch (err) {
      const message = getApiErrorMessage(err, "Không tải được báo cáo sự cố");
      setLoadError(message);
      if (mode === "refresh") toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchParams]);

  useEffect(() => { void load("initial"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { ALL: reports.length };
    for (const r of reports) map[r.status] = (map[r.status] ?? 0) + 1;
    return map;
  }, [reports]);

  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reports.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (query) {
        const haystack = `${r.report_number} ${r.note} ${r.warehouses?.code || ""} ${r.warehouses?.name || ""} ${exceptionLabel(r.exception_type)} ${taskTypeLabel(r.task_type)}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [reports, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredReports.length / PAGE_SIZE));
  const pagedReports = filteredReports.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);

  const selectedTask = taskList.find((t) => t.id === form.task_id) ?? null;
  const selectedWarehouse = warehouses.find((w) => w.id === form.warehouse_id) ?? null;
  // A deep link can name a task that has since left the user's feed.
  const prefillMissing = Boolean(form.task_id) && !loading && !selectedTask;

  const updateForm = (patch: Partial<FormState>, clears?: keyof FormErrors) => {
    setForm((f) => ({ ...f, ...patch }));
    if (clears) setErrors((e) => ({ ...e, [clears]: undefined }));
  };

  const handleTaskSelect = (taskId: string) => {
    setErrors((e) => ({ ...e, task: undefined }));
    if (!taskId) {
      setForm((f) => ({ ...f, task_id: "", task_type: "" }));
      return;
    }
    const task = taskList.find((t) => t.id === taskId);
    if (!task) return;
    const matched = warehouses.find(
      (w) => w.id === task.warehouse_id || w.code === task.warehouse || w.name === task.warehouse
    );
    setForm((f) => ({
      ...f,
      task_id: task.id,
      task_type: task.type,
      warehouse_id: matched?.id ?? f.warehouse_id,
    }));
    if (matched) setErrors((e) => ({ ...e, warehouse: undefined }));
  };

  const clearPhoto = () => {
    updateForm({ evidence_photo_url: undefined });
    setPhoto(null);
    setPhotoError(null);
    if (photoInput.current) photoInput.current.value = "";
  };

  const handlePhotoSelect = async (file: File | undefined) => {
    if (!file) return;
    if (!ALLOWED_EVIDENCE_PHOTO_TYPES.includes(file.type)) {
      // Reject SVG (and any other non-raster type) client-side: an inline SVG can carry
      // executable script and would run when later rendered via <img src>.
      setPhotoError(`“${file.name}” không phải ảnh PNG, JPEG, WEBP hoặc GIF.`);
      if (photoInput.current) photoInput.current.value = "";
      return;
    }
    if (file.size > MAX_EVIDENCE_PHOTO_BYTES) {
      setPhotoError(`Ảnh nặng ${formatBytes(file.size)}, vượt giới hạn 4 MB. Chọn ảnh nhỏ hơn hoặc nén ảnh trước.`);
      if (photoInput.current) photoInput.current.value = "";
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      updateForm({ evidence_photo_url: dataUrl });
      setPhoto({ name: file.name, size: file.size });
      setPhotoError(null);
    } catch {
      setPhotoError("Không đọc được tệp ảnh, hãy thử lại.");
    }
  };

  const resetForm = () => {
    setForm(emptyForm);
    setErrors({});
    setPhoto(null);
    setPhotoError(null);
    setFromTask(false);
    prefillApplied.current = true;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const found = validate(form);
    setErrors(found);
    const firstInvalid = (["task", "warehouse", "note", "expected", "actual"] as const).find((key) => found[key]);
    if (firstInvalid) {
      document.getElementById(fieldId(firstInvalid))?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const payload: ExceptionReportCreateInput = {
        warehouse_id: form.warehouse_id,
        task_type: form.task_type,
        task_id: form.task_id.trim(),
        exception_type: form.exception_type,
        note: form.note.trim(),
        expected_qty: form.expected_qty.trim() ? Number(form.expected_qty) : undefined,
        actual_qty: form.actual_qty.trim() ? Number(form.actual_qty) : undefined,
        evidence_notes: form.evidence_notes || undefined,
        evidence_photo_url: form.evidence_photo_url || undefined,
      };
      await exceptionReportService.createReport(payload);
      const cameFromTask = fromTask;
      toast.success("Đã gửi báo cáo sự cố", {
        description: "Báo cáo ở mục Đang mở cho đến khi quản lý ghi nhận.",
        action: cameFromTask && canOpenWarehouseTasks ? { label: "Quay lại công việc", onClick: () => { void navigate("/my-warehouse-tasks"); } } : undefined,
      });
      resetForm();
      setComposeOpen(false);
      setStatusFilter("ALL");
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Gửi báo cáo thất bại"));
    } finally {
      setSubmitting(false);
    }
  };

  const statusTabs = STATUS_FILTERS.map((key) => ({ key, label: STATUS_LABELS[key], count: counts[key] ?? 0 }));
  const expectedNumber = form.expected_qty.trim() && !quantityError(form.expected_qty) ? Number(form.expected_qty) : null;
  const actualNumber = form.actual_qty.trim() && !quantityError(form.actual_qty) ? Number(form.actual_qty) : null;
  const gap = expectedNumber !== null && actualNumber !== null ? actualNumber - expectedNumber : null;

  const emptyState = reports.length === 0 ? (
    <EmptyState
      icon={AlertTriangle}
      title="Chưa có báo cáo sự cố"
      description="Khi gặp hàng thiếu, dư, hư hỏng hay sai sản phẩm lúc làm việc, báo cáo để quản lý xử lý."
      action={<Button type="button" size="sm" onClick={() => setComposeOpen(true)}><Plus className="h-3.5 w-3.5" />Báo cáo sự cố</Button>}
      className="py-0"
    />
  ) : (
    <EmptyState icon={Search} variant="no-results" title="Không có báo cáo phù hợp" description="Thử trạng thái khác hoặc từ khóa khác." className="py-0" />
  );

  // Which report the right pane shows. On wide screens the first row opens by default;
  // on a phone the list shows alone until a row is chosen (one region at a time).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = filteredReports.find((r) => r.id === selectedId) ?? pagedReports[0] ?? null;

  // The finding first: what still waits on a manager, and since when.
  const waiting = reports.filter((r) => r.status === "OPEN" || r.status === "ACKNOWLEDGED");
  const oldestWaiting = waiting.reduce<string | null>((oldest, r) => (!oldest || r.created_at < oldest ? r.created_at : oldest), null);
  const ledeParts = [
    counts.OPEN ? `${counts.OPEN} chờ quản lý xem` : null,
    counts.ACKNOWLEDGED ? `${counts.ACKNOWLEDGED} đang được xử lý` : null,
    counts.RESOLVED ? `${counts.RESOLVED} đã xử lý` : null,
    counts.DISMISSED ? `${counts.DISMISSED} đã hủy` : null,
  ].filter(Boolean);
  const lede = loading
    ? "Báo thiếu, dư, hư hỏng hoặc sai hàng gặp khi làm việc và theo dõi quản lý xử lý."
    : reports.length === 0
      ? "Bạn chưa gửi báo cáo sự cố nào. Khi gặp hàng thiếu, dư, hư hỏng hay sai sản phẩm, báo cáo để quản lý xử lý."
      : `${reports.length} báo cáo: ${ledeParts.join(", ")}.${oldestWaiting ? ` Báo cáo chờ lâu nhất gửi ${ageText(oldestWaiting)}.` : ""}`;

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={AlertTriangle}
          title="Báo cáo sự cố của tôi"
          description={lede}
          actions={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading || refreshing}>
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin motion-reduce:animate-none")} />
                Làm mới
              </Button>
              <Button type="button" size="sm" onClick={() => setComposeOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Báo cáo sự cố
              </Button>
            </>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
            {/* The list */}
            <section
              aria-label="Báo cáo của tôi"
              className={cn("min-w-0 overflow-hidden rounded-2xl border border-border bg-card", selectedId ? "hidden @4xl/page:block" : "block")}
            >
              <QueueTabs label="Lọc theo trạng thái" tabs={statusTabs} value={statusFilter} onChange={setStatusFilter} panelId={PANEL_ID} loading={loading} />

              <div className="border-b border-border px-4 py-3">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm mã báo cáo, mô tả, kho…"
                    aria-label="Tìm báo cáo"
                    className="h-10 w-full rounded-md border border-input bg-input-background pl-9 pr-3 text-[14px] outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-border dark:bg-muted/40 sm:h-9"
                  />
                </div>
              </div>

              <div id={PANEL_ID} role="tabpanel" aria-labelledby={`${PANEL_ID}-tab-${statusFilter}`} aria-busy={loading || refreshing}>
                {loading ? (
                  <RowsSkeleton rows={4} />
                ) : loadError && reports.length === 0 ? (
                  <div className="p-4"><BlockError what="báo cáo sự cố của bạn" onRetry={() => void load("initial")} /></div>
                ) : pagedReports.length === 0 ? (
                  <div className="px-5 py-8">{emptyState}</div>
                ) : (
                  <ul>
                    {pagedReports.map((r) => {
                      const active = selected?.id === r.id;
                      const book = bookTitle(r);
                      return (
                        <li key={r.id} className="border-b border-border last:border-0">
                          <button
                            type="button"
                            onClick={() => setSelectedId(r.id)}
                            aria-current={active ? "true" : undefined}
                            className={cn(
                              "w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              // Until a row is chosen, the first row is "open" only where the detail pane shows beside the list.
                              active ? (selectedId ? "bg-primary/[0.07]" : "hover:bg-muted/50 @4xl/page:bg-primary/[0.07]") : "hover:bg-muted/50",
                            )}
                          >
                            <span className="flex items-start justify-between gap-3">
                              <span className="min-w-0 truncate text-[14px] font-semibold text-foreground">
                                {exceptionLabel(r.exception_type)}{book ? `: ${book}` : ""}
                              </span>
                              <StatusBadge label={statusLabel(r.status)} variant={getStatusVariant("exceptionReport", r.status)} dot />
                            </span>
                            {/* On the selected row's tint, muted grey drops under 4.5:1, so meta takes a darker ink there. */}
                            <span className={cn("mt-0.5 flex items-start gap-x-1 text-[13px]", active ? "text-foreground/75" : "text-muted-foreground")}>
                              <span className="min-w-0">
                                {r.warehouses?.code || "Chưa rõ kho"}, {taskTypeLabel(r.task_type)}
                                {r.expected_qty != null || r.actual_qty != null ? <>, <QuantityCell report={r} /></> : null}
                              </span>
                              <span className="ml-auto shrink-0 pl-2 text-[12px] tabular-nums" title={formatDateTime(r.created_at) ?? undefined}>{timeAgo(r.created_at)}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-[13px] text-foreground/80" title={r.note}>{r.note}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {!loading ? <ListFooter page={page} pageSize={PAGE_SIZE} total={filteredReports.length} noun="báo cáo" onPageChange={setPage} /> : null}
            </section>

            {/* The open report: read-only for staff, with how far the manager has taken it. */}
            <section
              aria-labelledby="my-exception-detail-title"
              className={cn("@container min-w-0 rounded-2xl border border-border bg-card @4xl/page:sticky @4xl/page:top-4", selectedId ? "block" : "hidden @4xl/page:block")}
            >
              {loading ? (
                <RowsSkeleton rows={3} />
              ) : !selected ? (
                <div className="p-5">
                  <h2 id="my-exception-detail-title" className="text-[16px] font-semibold text-foreground">Chưa có báo cáo để xem</h2>
                  <p className="mt-1 text-[14px] text-muted-foreground">Báo cáo bạn gửi sẽ hiện ở đây cùng tiến độ quản lý xử lý.</p>
                </div>
              ) : (
                <ReportDetail
                  report={selected}
                  currentUserId={currentUser?.id ?? null}
                  onBack={() => setSelectedId(null)}
                  onPhoto={() => setPhotoReport(selected)}
                />
              )}
            </section>
          </div>
        </div>
      </FadeItem>

      <FormSheet
        open={composeOpen}
        onOpenChange={setComposeOpen}
        title="Báo cáo sự cố"
        description={fromTask && canOpenWarehouseTasks ? (
          <NavLink to="/my-warehouse-tasks" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Quay lại công việc kho
          </NavLink>
        ) : "Ghi lại điều bạn thấy để quản lý xử lý. Nội dung đang nhập được giữ lại nếu bạn đóng bảng này."}
        onSubmit={(e) => void handleSubmit(e)}
        footer={(
          <>
            <Button type="button" variant="ghost" className="mr-auto px-2 sm:px-3" onClick={resetForm}>Xóa nội dung</Button>
            <Button type="button" variant="outline" onClick={() => setComposeOpen(false)}>Đóng</Button>
            <Button type="submit" loading={submitting}>{submitting ? "Đang gửi…" : "Gửi báo cáo"}</Button>
          </>
        )}
      >
        <FormGroup title="Công việc liên quan">
          <Field
            id={fieldId("task")}
            label="Task đang gặp sự cố"
            required
            error={errors.task}
            hint={prefillMissing ? undefined : taskList.length === 0 && !loading ? "Bạn chưa có task kho nào. Kiểm tra mục Công việc kho của tôi hoặc liên hệ quản lý." : undefined}
          >
            <select
              {...fieldAria(fieldId("task"), errors.task, taskList.length === 0)}
              className={nativeSelectClass}
              value={selectedTask ? form.task_id : ""}
              onChange={(e) => handleTaskSelect(e.target.value)}
              disabled={loading}
            >
              <option value="">{loading ? "Đang tải task…" : prefillMissing ? "Chọn lại task" : "Chọn task"}</option>
              {TASK_TYPES.map((type) => {
                const group = taskList.filter((t) => t.type === type.value);
                return group.length ? (
                  <optgroup key={type.value} label={type.label}>
                    {group.map((t) => <option key={t.id} value={t.id}>{t.title}{t.warehouse ? ` · ${t.warehouse}` : ""}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
            {prefillMissing && !errors.task ? (
              <p className="mt-1.5 text-[12px] text-amber-700 dark:text-amber-400">
                Task được chuyển từ trang công việc ({form.task_type ? taskTypeLabel(form.task_type) : "không rõ loại"}) không còn trong danh sách của bạn. Hãy chọn lại task.
              </p>
            ) : null}
          </Field>
          {selectedTask || form.task_type ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/60 px-3 py-2.5 text-[13px]">
              <dt className="text-muted-foreground">Loại nghiệp vụ</dt>
              <dd className="text-foreground">{taskTypeLabel(selectedTask?.type ?? form.task_type)}</dd>
              {selectedTask?.status ? (<><dt className="text-muted-foreground">Trạng thái task</dt><dd className="text-foreground">{getWarehouseTaskStatusLabel(selectedTask.status)}</dd></>) : null}
            </dl>
          ) : null}
          <Field id={fieldId("warehouse")} label="Kho" required error={errors.warehouse} hint={selectedTask && selectedWarehouse ? "Điền theo task đã chọn." : undefined}>
            <select
              {...fieldAria(fieldId("warehouse"), errors.warehouse, Boolean(selectedTask && selectedWarehouse))}
              className={nativeSelectClass}
              value={form.warehouse_id}
              onChange={(e) => updateForm({ warehouse_id: e.target.value }, "warehouse")}
            >
              <option value="">Chọn kho</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
              ))}
            </select>
          </Field>
        </FormGroup>

        <FormGroup title="Thông tin sự cố">
          <div>
            <p id={fieldId("type-label")} className="mb-1.5 text-[13px] font-medium text-foreground">
              Loại sự cố<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
            </p>
            <ChoiceChips labelledBy={fieldId("type-label")} options={EXCEPTION_TYPES} value={form.exception_type} onChange={(value) => updateForm({ exception_type: value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={fieldId("expected")} label="Số lượng dự kiến" error={errors.expected} hint="Theo chứng từ, đơn vị cuốn. Để trống nếu không áp dụng.">
              <Input
                {...fieldAria(fieldId("expected"), errors.expected, true)}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                className={cn("h-10", darkFieldClass)}
                value={form.expected_qty}
                onChange={(e) => updateForm({ expected_qty: e.target.value }, "expected")}
              />
            </Field>
            <Field id={fieldId("actual")} label="Số lượng thực tế" error={errors.actual} hint="Bạn đếm được, đơn vị cuốn. 0 nghĩa là không có cuốn nào.">
              <Input
                {...fieldAria(fieldId("actual"), errors.actual, true)}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                className={cn("h-10", darkFieldClass)}
                value={form.actual_qty}
                onChange={(e) => updateForm({ actual_qty: e.target.value }, "actual")}
              />
            </Field>
          </div>
          {gap !== null ? (
            <p className="text-[12px] text-muted-foreground" aria-live="polite">
              Chênh lệch tham khảo: <span className="font-medium tabular-nums text-foreground">{gap > 0 ? "+" : gap < 0 ? "−" : ""}{Math.abs(gap)} cuốn</span>
              {gap < 0 ? " (thực tế ít hơn dự kiến)" : gap > 0 ? " (thực tế nhiều hơn dự kiến)" : " (khớp)"}. Chỉ để quản lý tham khảo, không tự điều chỉnh tồn kho.
            </p>
          ) : null}
          <Field id={fieldId("note")} label="Mô tả sự cố" required error={errors.note} hint="Bạn thấy gì, ở đâu, ảnh hưởng tới cuốn nào.">
            <Textarea className={darkFieldClass}
              {...fieldAria(fieldId("note"), errors.note, true)}
              rows={3}
              placeholder="Ví dụ: thùng số 2 thiếu 3 cuốn Nhà Giả Kim, vỏ thùng bị rách"
              value={form.note}
              onChange={(e) => updateForm({ note: e.target.value }, "note")}
            />
          </Field>
        </FormGroup>

        <FormGroup title="Bằng chứng" description="Không bắt buộc, nhưng giúp quản lý xử lý nhanh hơn.">
          <div>
            <p id={fieldId("photo-label")} className="mb-1.5 text-[13px] font-medium text-foreground">Ảnh bằng chứng</p>
            <input
              ref={photoInput}
              id={fieldId("photo")}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="peer sr-only"
              aria-labelledby={fieldId("photo-label")}
              aria-describedby={fieldId(photoError ? "photo-error" : "photo-hint")}
              onChange={(e) => void handlePhotoSelect(e.target.files?.[0])}
            />
            {form.evidence_photo_url ? (
              <div className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                <img src={form.evidence_photo_url} alt="Ảnh bằng chứng đã chọn" className="h-20 w-20 shrink-0 rounded-md border border-border object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{photo?.name ?? "Ảnh đã chọn"}</p>
                  {photo ? <p className="text-[12px] tabular-nums text-muted-foreground">{formatBytes(photo.size)}</p> : null}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Button type="button" variant="outline" size="sm" className="h-9 sm:h-8" onClick={() => photoInput.current?.click()}>Đổi ảnh</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-9 text-muted-foreground sm:h-8" onClick={clearPhoto}><Trash2 className="h-3.5 w-3.5" />Xóa ảnh</Button>
                  </div>
                </div>
              </div>
            ) : (
              <label
                htmlFor={fieldId("photo")}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-5 text-center transition-colors hover:bg-muted/50",
                  "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
                  photoError ? "border-destructive/60" : "border-border",
                )}
              >
                <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                <span className="text-[13px] font-medium text-foreground">Chọn hoặc chụp ảnh</span>
              </label>
            )}
            {photoError ? (
              <p id={fieldId("photo-error")} role="alert" className="mt-1.5 text-[12px] text-red-600 dark:text-red-400">{photoError}</p>
            ) : (
              <p id={fieldId("photo-hint")} className="mt-1.5 text-[12px] text-muted-foreground">PNG, JPEG, WEBP hoặc GIF, tối đa 4 MB. Không nhận SVG.</p>
            )}
          </div>
          <Field id={fieldId("evidence")} label="Ghi chú bằng chứng" hint="Ví dụ: số serial, vị trí kệ, số thùng.">
            <Textarea className={darkFieldClass}
              {...fieldAria(fieldId("evidence"), null, true)}
              rows={2}
              value={form.evidence_notes}
              onChange={(e) => updateForm({ evidence_notes: e.target.value })}
            />
          </Field>
        </FormGroup>

        <p className="flex gap-2 rounded-md bg-muted/60 px-3 py-2.5 text-[12px] leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Báo cáo sự cố không tự động điều chỉnh tồn kho. Quản lý sẽ xem xét và quyết định cách xử lý.
        </p>
      </FormSheet>

      <Dialog open={Boolean(photoReport)} onOpenChange={(open) => { if (!open) setPhotoReport(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ảnh bằng chứng {photoReport?.report_number}</DialogTitle>
            <DialogDescription>{photoReport ? `${exceptionLabel(photoReport.exception_type)}, ${photoReport.warehouses?.code ?? ""}` : null}</DialogDescription>
          </DialogHeader>
          {photoReport?.evidence_photo_url ? (
            <img src={photoReport.evidence_photo_url} alt={`Ảnh bằng chứng của ${photoReport.report_number}`} className="max-h-[70vh] w-full rounded-md object-contain" />
          ) : null}
          {photoReport?.evidence_notes ? <p className="text-[13px] text-muted-foreground">{photoReport.evidence_notes}</p> : null}
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
