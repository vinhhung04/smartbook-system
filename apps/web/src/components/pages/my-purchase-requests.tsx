import { useEffect, useMemo, useState } from "react";
import { ShoppingCart, Plus, RefreshCw } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterBar } from "@/components/ui/filter-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { getApiErrorMessage } from "@/services/api";
import { purchaseRequestService, type PurchaseRequest, type PurchaseRequestCreateInput } from "@/services/purchase-requests";
import { warehouseService } from "@/services/warehouse";
import { getStatusVariant } from "@/lib/status-registry";

type PageTab = "queue" | "compose";

const PAGE_SIZE = 10;

const REASONS = [
  { value: "LOW_STOCK", label: "Tồn kho thấp" },
  { value: "CUSTOMER_REQUEST", label: "Yêu cầu khách hàng" },
  { value: "DAMAGED", label: "Sách hư hỏng" },
  { value: "LOST", label: "Mất sách" },
  { value: "OTHER", label: "Lý do khác" },
];

function statusVariant(status: string) {
  return getStatusVariant("purchaseRequest", status);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ResponseCell({ req }: { req: PurchaseRequest }) {
  const s = req.status.toUpperCase();
  if (s === "REJECTED" && req.rejection_reason) {
    return (
      <span className="text-[11px] text-red-700 dark:text-red-400 italic block max-w-[160px] truncate" title={req.rejection_reason}>
        {req.rejection_reason}
      </span>
    );
  }
  if (s === "REJECTED") {
    return <span className="text-[11px] text-red-500 dark:text-red-400 italic">Đã từ chối</span>;
  }
  if (s === "CONVERTED" && req.purchase_order_id) {
    return (
      <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400" title={req.purchase_order_id}>
        PO #{req.purchase_order_id.slice(-8).toUpperCase()}
      </span>
    );
  }
  if (s === "CONVERTED") {
    return <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Đã chuyển PO</span>;
  }
  if (s === "APPROVED") {
    return <span className="text-[11px] text-sky-600 dark:text-sky-400">Đã duyệt, chờ tạo PO</span>;
  }
  return null;
}

interface Warehouse { id: string; code: string; name: string }

const emptyForm: PurchaseRequestCreateInput = {
  warehouse_id: "",
  book_variant_id: undefined,
  book_title_hint: "",
  quantity_requested: 1,
  reason: "OTHER",
  note: "",
};

export function MyPurchaseRequestsPage() {
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [form, setForm] = useState<PurchaseRequestCreateInput>(emptyForm);

  const [activeTab, setActiveTab] = useState<PageTab>("queue");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [res, wRes] = await Promise.all([
        purchaseRequestService.getMyRequests(),
        warehouseService.getReceivingWarehouses(),
      ]);
      setRequests(Array.isArray(res.data) ? res.data : []);
      setWarehouses(Array.isArray(wRes) ? wRes : []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được yêu cầu mua hàng"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return requests;
    return requests.filter((req) => {
      const reasonLabel = REASONS.find((r) => r.value === req.reason)?.label || req.reason;
      const haystack = [
        req.request_number,
        req.book_variants?.books?.title,
        req.book_title_hint,
        reasonLabel,
        req.status,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [requests, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));

  const pagedRequests = useMemo(
    () => filteredRequests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredRequests, page],
  );

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.warehouse_id) { toast.error("Vui lòng chọn kho"); return; }
    if (!form.quantity_requested || form.quantity_requested < 1) { toast.error("Số lượng phải lớn hơn 0"); return; }

    setSubmitting(true);
    try {
      const payload: PurchaseRequestCreateInput = {
        warehouse_id: form.warehouse_id,
        quantity_requested: Number(form.quantity_requested),
        reason: form.reason || "OTHER",
        note: form.note || undefined,
        book_title_hint: form.book_title_hint || undefined,
        book_variant_id: form.book_variant_id || undefined,
      };
      await purchaseRequestService.createRequest(payload);
      toast.success("Đã gửi yêu cầu mua hàng");
      setForm(emptyForm);
      await load();
      setActiveTab("queue");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Gửi yêu cầu thất bại"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ShoppingCart}
          title="Yêu cầu mua hàng của tôi"
          description="Gửi yêu cầu bổ sung hàng cho quản lý xem xét và điều phối"
          iconBg="bg-orange-100 dark:bg-orange-500/15"
          iconColor="text-orange-700 dark:text-orange-400"
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
              <Button type="button" size="sm" onClick={() => setActiveTab("compose")}>
                <Plus className="h-3.5 w-3.5" />
                Tạo yêu cầu
              </Button>
            </>
          )}
        />
      </FadeItem>

      <FadeItem>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          Yêu cầu mua hàng là để báo cáo nhu cầu bổ sung kho cho quản lý. Quản lý sẽ xem xét và tạo đơn đặt hàng chính thức (PO) nếu phê duyệt.
        </div>
      </FadeItem>

      <FadeItem>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PageTab)}>
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="queue">Yêu cầu của tôi</TabsTrigger>
            <TabsTrigger value="compose">Tạo yêu cầu mới</TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="mt-4">
            <SectionCard title="Danh sách yêu cầu" subtitle="Các yêu cầu mua hàng bạn đã gửi.">
              <FilterBar
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder="Tìm theo mã yêu cầu, tên sách hoặc trạng thái..."
                className="mb-4"
              />

              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Mã yêu cầu</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Kho</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Sách / Gợi ý</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Số lượng</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Lý do</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Trạng thái</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Phản hồi</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground">Tạo lúc</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <SkeletonTableRow columns={8} rows={4} />
                    ) : pagedRequests.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={8} className="whitespace-normal py-10 text-center">
                          <EmptyState
                            icon={ShoppingCart}
                            title={requests.length === 0 ? "Chưa có yêu cầu nào" : "Không tìm thấy yêu cầu phù hợp"}
                            description={
                              requests.length === 0
                                ? "Tạo yêu cầu mua hàng để báo cáo nhu cầu bổ sung kho cho quản lý."
                                : "Thử điều chỉnh từ khóa tìm kiếm."
                            }
                            action={requests.length === 0 ? (
                              <Button type="button" size="sm" onClick={() => setActiveTab("compose")}>
                                <Plus className="h-3.5 w-3.5" />
                                Tạo yêu cầu
                              </Button>
                            ) : undefined}
                            className="py-0"
                          />
                        </TableCell>
                      </TableRow>
                    ) : pagedRequests.map((req) => (
                      <TableRow key={req.id} className="hover:bg-muted/30">
                        <TableCell className="text-[12px] font-mono text-muted-foreground">{req.request_number}</TableCell>
                        <TableCell className="text-[13px]">{req.warehouses?.code || "-"}</TableCell>
                        <TableCell className="whitespace-normal text-[13px]">
                          {req.book_variants?.books?.title || req.book_title_hint || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="text-[13px]">{req.quantity_requested}</TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">
                          {REASONS.find((r) => r.value === req.reason)?.label || req.reason}
                        </TableCell>
                        <TableCell>
                          <StatusBadge label={req.status} variant={statusVariant(req.status)} dot />
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <ResponseCell req={req} />
                        </TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">{formatDate(req.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {filteredRequests.length > 0 && (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[12px] text-muted-foreground">
                    Hiển thị <span className="font-medium text-foreground">{pagedRequests.length}</span> / {filteredRequests.length} yêu cầu
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
            <SectionCard title="Tạo yêu cầu mua hàng mới" subtitle="Điền thông tin nhu cầu bổ sung kho để gửi cho quản lý." icon={Plus}>
              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-[12px] font-medium mb-1">Kho *</label>
                    <Select value={form.warehouse_id} onValueChange={(v) => setForm((f) => ({ ...f, warehouse_id: v }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="-- Chọn kho --" />
                      </SelectTrigger>
                      <SelectContent>
                        {warehouses.map((w) => (
                          <SelectItem key={w.id} value={w.id}>{w.code} - {w.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium mb-1">Lý do *</label>
                    <Select value={form.reason} onValueChange={(v) => setForm((f) => ({ ...f, reason: v }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium mb-1">Tên sách / gợi ý</label>
                    <Input
                      type="text"
                      placeholder="Nhập tên sách hoặc ISBN nếu có"
                      value={form.book_title_hint || ""}
                      onChange={(e) => setForm((f) => ({ ...f, book_title_hint: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium mb-1">Số lượng cần đặt *</label>
                    <Input
                      type="number"
                      min="1"
                      value={form.quantity_requested}
                      onChange={(e) => setForm((f) => ({ ...f, quantity_requested: Number(e.target.value) }))}
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-medium mb-1">Ghi chú</label>
                  <Textarea
                    rows={3}
                    placeholder="Mô tả thêm về nhu cầu hoặc bối cảnh..."
                    value={form.note || ""}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setForm(emptyForm)}>
                    Đặt lại
                  </Button>
                  <Button type="submit" size="sm" disabled={submitting} loading={submitting}>
                    Gửi yêu cầu
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
