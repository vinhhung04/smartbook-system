import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AlertTriangle, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { getApiErrorMessage } from "@/services/api";
import { exceptionReportService, type ExceptionReport, type ExceptionReportCreateInput } from "@/services/exception-reports";
import { warehouseService } from "@/services/warehouse";
import { myWarehouseTaskService, type MyWarehouseTask } from "@/services/my-warehouse-tasks";
import { getStatusVariant } from "@/lib/status-registry";

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

const STATUS_FILTERS = [
  { value: "all", label: "Mọi trạng thái" },
  { value: "OPEN", label: "Mở" },
  { value: "ACKNOWLEDGED", label: "Đã ghi nhận" },
  { value: "RESOLVED", label: "Đã xử lý" },
  { value: "DISMISSED", label: "Đã hủy" },
];

const PAGE_SIZE = 10;

type PageTab = "queue" | "compose";

function statusVariant(status: string) {
  return getStatusVariant("exceptionReport", status);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface Warehouse { id: string; code: string; name: string }

const emptyForm: ExceptionReportCreateInput = {
  warehouse_id: "",
  task_type: "RECEIVING",
  task_id: "",
  exception_type: "SHORT",
  note: "",
  expected_qty: undefined,
  actual_qty: undefined,
  evidence_notes: "",
  goods_receipt_id: undefined,
};

export function MyExceptionReportsPage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<PageTab>("queue");
  const [reports, setReports] = useState<ExceptionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [taskList, setTaskList] = useState<MyWarehouseTask[]>([]);
  const [form, setForm] = useState<ExceptionReportCreateInput>(emptyForm);
  const prefillApplied = useRef(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [res, wRes, taskRes] = await Promise.all([
        exceptionReportService.getMyReports(),
        warehouseService.getReceivingWarehouses(),
        myWarehouseTaskService.getMyTasks(),
      ]);
      setReports(Array.isArray(res.data) ? res.data : []);
      const wList = Array.isArray(wRes) ? wRes : [];
      setWarehouses(wList);
      const opTasks = (taskRes.data || []).filter((t) =>
        ["RECEIVING", "PUTAWAY", "PICKING", "OUTBOUND"].includes(t.type)
      );
      setTaskList(opTasks);

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
          setActiveTab("compose");
        }
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được báo cáo sự cố"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reports.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (query) {
        const exceptionLabel = EXCEPTION_TYPES.find((t) => t.value === r.exception_type)?.label || r.exception_type;
        const taskLabel = TASK_TYPES.find((t) => t.value === r.task_type)?.label || r.task_type;
        const haystack = `${r.report_number} ${r.note} ${r.warehouses?.code || ""} ${r.warehouses?.name || ""} ${exceptionLabel} ${taskLabel}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [reports, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredReports.length / PAGE_SIZE));

  const pagedReports = useMemo(
    () => filteredReports.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredReports, page],
  );

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const handleTaskSelect = (taskId: string) => {
    if (!taskId) {
      setForm((f) => ({ ...f, task_id: "", task_type: "RECEIVING" }));
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
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.warehouse_id) { toast.error("Vui lòng chọn kho"); return; }
    if (!form.task_id.trim()) { toast.error("Vui lòng chọn task liên quan"); return; }
    if (!form.note.trim()) { toast.error("Vui lòng nhập mô tả sự cố"); return; }

    setSubmitting(true);
    try {
      const payload: ExceptionReportCreateInput = {
        warehouse_id: form.warehouse_id,
        task_type: form.task_type,
        task_id: form.task_id.trim(),
        exception_type: form.exception_type,
        note: form.note.trim(),
        expected_qty: form.expected_qty !== undefined && form.expected_qty !== null ? Number(form.expected_qty) : undefined,
        actual_qty: form.actual_qty !== undefined && form.actual_qty !== null ? Number(form.actual_qty) : undefined,
        evidence_notes: form.evidence_notes || undefined,
        goods_receipt_id: form.goods_receipt_id || undefined,
      };
      await exceptionReportService.createReport(payload);
      toast.success("Đã gửi báo cáo sự cố");
      setForm(emptyForm);
      prefillApplied.current = true;
      await load();
      setActiveTab("queue");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Gửi báo cáo thất bại"));
    } finally {
      setSubmitting(false);
    }
  };

  const closeForm = () => {
    setForm(emptyForm);
    prefillApplied.current = true;
    setActiveTab("queue");
  };

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={AlertTriangle}
          title="Báo cáo sự cố của tôi"
          description="Ghi nhận sự cố thiếu/dư/hư hỏng trong quá trình làm việc để quản lý xử lý"
          iconBg="bg-red-100 dark:bg-red-500/15"
          iconColor="text-red-700 dark:text-red-400"
          actions={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
              <Button type="button" size="sm" onClick={() => setActiveTab("compose")} disabled={activeTab === "compose"}>
                <Plus className="h-3.5 w-3.5" />
                Báo cáo sự cố
              </Button>
            </>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          Báo cáo sự cố không tự động điều chỉnh tồn kho. Quản lý sẽ xem xét và quyết định xử lý phù hợp.
        </div>
      </FadeItem>

      <FadeItem>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PageTab)}>
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="queue">Báo cáo của tôi</TabsTrigger>
            <TabsTrigger value="compose">Tạo báo cáo mới</TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="mt-4">
            <SectionCard title="Danh sách báo cáo sự cố">
              <FilterBar
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder="Tìm theo mã báo cáo, mô tả hoặc kho..."
                className="mb-4"
                filters={(
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[160px]" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_FILTERS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />

              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Mã báo cáo</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Kho</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Task</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Loại sự cố</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">SL dự kiến</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">SL thực tế</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Trạng thái</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Tạo lúc</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedReports.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={8} className="whitespace-normal py-10 text-center">
                          <EmptyState
                            icon={AlertTriangle}
                            variant={reports.length === 0 ? "no-data" : "no-results"}
                            title={reports.length === 0 ? "Chưa có báo cáo sự cố" : "Không tìm thấy báo cáo phù hợp"}
                            description={
                              reports.length === 0
                                ? "Khi phát hiện sự cố trong quá trình làm việc, hãy báo cáo để quản lý xử lý kịp thời."
                                : "Thử điều chỉnh từ khóa tìm kiếm hoặc bộ lọc."
                            }
                            action={reports.length === 0 ? (
                              <Button type="button" size="sm" onClick={() => setActiveTab("compose")}>
                                <Plus className="h-3.5 w-3.5" />
                                Báo cáo sự cố
                              </Button>
                            ) : undefined}
                            className="py-0"
                          />
                        </TableCell>
                      </TableRow>
                    ) : pagedReports.map((r) => (
                      <TableRow key={r.id} className="hover:bg-muted/30">
                        <TableCell className="font-mono text-[12px] text-muted-foreground">{r.report_number}</TableCell>
                        <TableCell className="text-[13px]">{r.warehouses?.code || "-"}</TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">
                          {TASK_TYPES.find((t) => t.value === r.task_type)?.label || r.task_type}
                        </TableCell>
                        <TableCell className="text-[13px]">
                          {EXCEPTION_TYPES.find((t) => t.value === r.exception_type)?.label || r.exception_type}
                        </TableCell>
                        <TableCell className="text-[13px]">{r.expected_qty ?? "-"}</TableCell>
                        <TableCell className="text-[13px]">{r.actual_qty ?? "-"}</TableCell>
                        <TableCell>
                          <StatusBadge label={r.status} variant={statusVariant(r.status)} dot />
                        </TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {filteredReports.length > 0 && (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[12px] text-muted-foreground">
                    Hiển thị <span className="font-medium text-foreground">{pagedReports.length}</span> / {filteredReports.length} báo cáo
                  </p>
                  {totalPages > 1 && (
                    <Pagination className="mx-0 w-auto justify-end">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={(event) => {
                              event.preventDefault();
                              setPage((current) => Math.max(1, current - 1));
                            }}
                            className={cn("cursor-pointer", page === 1 && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                        {getPaginationRange(page, totalPages).map((item) => (
                          <PaginationItem key={item}>
                            {typeof item === "number" ? (
                              <PaginationLink
                                isActive={item === page}
                                onClick={(event) => {
                                  event.preventDefault();
                                  setPage(item);
                                }}
                                className="cursor-pointer"
                              >
                                {item}
                              </PaginationLink>
                            ) : (
                              <PaginationEllipsis />
                            )}
                          </PaginationItem>
                        ))}
                        <PaginationItem>
                          <PaginationNext
                            onClick={(event) => {
                              event.preventDefault();
                              setPage((current) => Math.min(totalPages, current + 1));
                            }}
                            className={cn("cursor-pointer", page === totalPages && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  )}
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="compose" className="mt-4">
            <SectionCard>
              <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
                <h2 className="text-[14px] font-semibold">Báo cáo sự cố mới</h2>
                <button type="button" onClick={closeForm} aria-label="Đóng biểu mẫu" className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Task dropdown */}
                  <div className="sm:col-span-2">
                    <label className="block text-[12px] font-medium mb-1">Task liên quan *</label>
                    {taskList.length > 0 ? (
                      <select
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                        value={form.task_id}
                        onChange={(e) => handleTaskSelect(e.target.value)}
                        required
                      >
                        <option value="">-- Chọn task liên quan --</option>
                        {taskList.map((t) => (
                          <option key={t.id} value={t.id}>
                            [{t.type}] {t.title}{t.warehouse ? ` — ${t.warehouse}` : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                        Không tìm thấy task đang hoạt động. Kiểm tra lại "Công việc kho của tôi" hoặc liên hệ quản lý.
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[12px] font-medium mb-1">Kho *</label>
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                      value={form.warehouse_id}
                      onChange={(e) => setForm((f) => ({ ...f, warehouse_id: e.target.value }))}
                      required
                    >
                      <option value="">-- Chọn kho --</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium mb-1">Loại task</label>
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                      value={form.task_type}
                      onChange={(e) => setForm((f) => ({ ...f, task_type: e.target.value }))}
                    >
                      {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium mb-1">Loại sự cố *</label>
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                      value={form.exception_type}
                      onChange={(e) => setForm((f) => ({ ...f, exception_type: e.target.value }))}
                    >
                      {EXCEPTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium mb-1">Số lượng dự kiến</label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="Số lượng theo chứng từ"
                      value={form.expected_qty ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, expected_qty: e.target.value ? Number(e.target.value) : undefined }))}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium mb-1">Số lượng thực tế</label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="Số lượng thực nhận/kiểm"
                      value={form.actual_qty ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, actual_qty: e.target.value ? Number(e.target.value) : undefined }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-medium mb-1">Mô tả sự cố *</label>
                  <Textarea
                    rows={3}
                    placeholder="Mô tả chi tiết sự cố phát hiện..."
                    value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium mb-1">Ghi chú bằng chứng</label>
                  <Textarea
                    rows={2}
                    placeholder="Ghi chú số serial, vị trí, hình ảnh (nếu có)..."
                    value={form.evidence_notes || ""}
                    onChange={(e) => setForm((f) => ({ ...f, evidence_notes: e.target.value }))}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={closeForm}>Hủy</Button>
                  <Button type="submit" size="sm" disabled={submitting}>
                    {submitting ? "Đang gửi..." : "Gửi báo cáo"}
                  </Button>
                </div>
              </form>
            </SectionCard>
          </TabsContent>
        </Tabs>
      </FadeItem>
    </PageWrapper>
  );
}
