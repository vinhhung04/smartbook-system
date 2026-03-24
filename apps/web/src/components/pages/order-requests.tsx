import { useEffect, useMemo, useState } from "react";
import { Check, ListOrdered, Plus, Search, Send, X } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { getApiErrorMessage } from "@/services/api.ts";
import { authService } from "@/services/auth";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import {
  orderRequestService,
  type OrderRequestSummary,
  type OrderRequestVariant,
  type RequestTaskType,
} from "@/services/order-requests";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-state";
import { StatusBadge } from "@/components/status-badge";

type RequestType = "outbound" | "transfer";

type DraftLine = {
  isbn13: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  quantity: number;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function canApproveRequests(): boolean {
  const user = authService.getCurrentUser();
  if (user?.is_superuser) return true;

  const permissions = Array.isArray(user?.permissions)
    ? user.permissions.map((permission) => String(permission || "").trim())
    : [];
  if (permissions.includes("inventory.purchase.approve")) {
    return true;
  }

  const roles = Array.isArray(user?.roles) ? user.roles.map((role) => String(role || "").toUpperCase()) : [];
  return roles.includes("ADMIN") || roles.includes("MANAGER");
}

function getTransferInsufficientStockDescription(error: unknown): string | null {
  const maybe = error as {
    response?: {
      data?: {
        details?: {
          shortages?: Array<{
            isbn13?: string | null;
            sku?: string | null;
            variant_id?: string;
            shortage_qty?: number;
            required_qty?: number;
            available_qty?: number;
          }>;
        };
      };
    };
  };

  const shortages = maybe?.response?.data?.details?.shortages;
  if (!Array.isArray(shortages) || shortages.length === 0) {
    return null;
  }

  return shortages
    .slice(0, 3)
    .map((item) => `${item.isbn13 || item.sku || item.variant_id || "N/A"}: can ${item.available_qty || 0}, yeu cau ${item.required_qty || 0}, thieu ${item.shortage_qty || 0}`)
    .join(" | ");
}

function statusBadgeVariant(status: string): "success" | "warning" | "danger" | "info" | "neutral" | "cyan" {
  const upper = String(status || "").toUpperCase();
  if (upper.includes("APPROVED") || upper.includes("COMPLETED") || upper.includes("READY")) return "success";
  if (upper.includes("REJECT") || upper.includes("CANCEL")) return "danger";
  if (upper.includes("PENDING") || upper.includes("REQUESTED")) return "warning";
  if (upper.includes("PICK")) return "info";
  return "neutral";
}

export function OrderRequestsPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processingActionKey, setProcessingActionKey] = useState("");

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [targetWarehouseId, setTargetWarehouseId] = useState("");

  const [requestType, setRequestType] = useState<RequestType>("outbound");
  const [requestNote, setRequestNote] = useState("");
  const [externalReference, setExternalReference] = useState("");

  const [variantQuery, setVariantQuery] = useState("");
  const [searchingVariant, setSearchingVariant] = useState(false);
  const [variantResults, setVariantResults] = useState<OrderRequestVariant[]>([]);

  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);

  const [listView, setListView] = useState<"my" | "approval">("my");
  const [requests, setRequests] = useState<OrderRequestSummary[]>([]);

  const canApprove = canApproveRequests();

  const filteredWarehouses = useMemo(() => {
    if (!selectedWarehouseId || requestType !== "transfer") return warehouses;
    return warehouses.filter((warehouse) => warehouse.id !== selectedWarehouseId);
  }, [warehouses, requestType, selectedWarehouseId]);

  const loadRequests = async (view: "my" | "approval", warehouseId?: string) => {
    const response = await orderRequestService.listRequests(view, warehouseId);
    setRequests(response.data || []);
  };

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const warehouseRows = await warehouseService.getAll();
        const rows = Array.isArray(warehouseRows) ? warehouseRows : [];

        setWarehouses(rows);

        const currentUser = authService.getCurrentUser() as { primary_warehouse_id?: string } | null;
        const preferredWarehouse = rows.find((row) => row.id === currentUser?.primary_warehouse_id)?.id || rows[0]?.id || "";

        setSelectedWarehouseId(preferredWarehouse);
        setTargetWarehouseId(rows.find((row) => row.id !== preferredWarehouse)?.id || "");

        await loadRequests("my", preferredWarehouse || undefined);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc du lieu order requests"));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    if (!selectedWarehouseId) return;

    const warehouseFilter = listView === "approval" ? undefined : selectedWarehouseId;

    void loadRequests(listView, warehouseFilter).catch((error) => {
      toast.error(getApiErrorMessage(error, "Khong tai duoc danh sach request"));
    });
  }, [listView, selectedWarehouseId]);

  const handleSearchVariant = async () => {
    const q = variantQuery.trim();
    if (q.length < 2) {
      toast.error("Nhap it nhat 2 ky tu de tim variant");
      return;
    }

    try {
      setSearchingVariant(true);
      const response = await orderRequestService.searchVariants(q);
      setVariantResults(response.data || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong tim duoc variant"));
    } finally {
      setSearchingVariant(false);
    }
  };

  const handleAddLine = (variant: OrderRequestVariant) => {
    const isbn13 = String(variant.isbn13 || "").trim();
    if (!isbn13 || !/^\d{13}$/.test(isbn13)) {
      toast.error("Chi duoc them sach co ISBN13 hop le");
      return;
    }

    setDraftLines((prev) => {
      const found = prev.find((line) => line.isbn13 === isbn13);
      if (found) {
        return prev.map((line) => (
          line.isbn13 === isbn13
            ? { ...line, quantity: line.quantity + 1 }
            : line
        ));
      }

      return [
        ...prev,
        {
          isbn13,
          title: variant.title,
          sku: variant.sku,
          barcode: variant.isbn13 || variant.barcode,
          quantity: 1,
        },
      ];
    });
  };

  const handleQuantityChange = (isbn13: string, value: number) => {
    setDraftLines((prev) => prev.map((line) => (
      line.isbn13 === isbn13
        ? { ...line, quantity: Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1 }
        : line
    )));
  };

  const handleRemoveLine = (isbn13: string) => {
    setDraftLines((prev) => prev.filter((line) => line.isbn13 !== isbn13));
  };

  const resetForm = () => {
    setRequestNote("");
    setExternalReference("");
    setVariantQuery("");
    setVariantResults([]);
    setDraftLines([]);
  };

  const handleSubmitRequest = async () => {
    if (!selectedWarehouseId) {
      toast.error("Chon warehouse nguon truoc");
      return;
    }

    if (draftLines.length === 0) {
      toast.error("Can it nhat 1 line trong request");
      return;
    }

    try {
      setSubmitting(true);

      if (requestType === "outbound") {
        await orderRequestService.createOutboundRequest({
          warehouse_id: selectedWarehouseId,
          outbound_type: "MANUAL",
          external_reference: externalReference.trim() || null,
          note: requestNote.trim() || null,
          lines: draftLines.map((line) => ({
            isbn13: line.isbn13,
            quantity: Math.max(1, Math.trunc(line.quantity || 0)),
          })),
        });
      } else {
        if (!targetWarehouseId) {
          toast.error("Chon warehouse dich cho transfer");
          return;
        }

        await orderRequestService.createTransferRequest({
          from_warehouse_id: selectedWarehouseId,
          to_warehouse_id: targetWarehouseId,
          note: requestNote.trim() || null,
          lines: draftLines.map((line) => ({
            isbn13: line.isbn13,
            quantity: Math.max(1, Math.trunc(line.quantity || 0)),
          })),
        });
      }

      toast.success("Tao request thanh cong");
      resetForm();
      setListView("my");
      await loadRequests("my", selectedWarehouseId || undefined);
    } catch (error) {
      const message = getApiErrorMessage(error, "Tao request that bai");
      const shortageDescription = getTransferInsufficientStockDescription(error);

      if (shortageDescription) {
        toast.error(message, { description: shortageDescription });
      } else {
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveOrReject = async (
    taskType: RequestTaskType,
    taskId: string,
    mode: "approve" | "reject",
  ) => {
    try {
      const key = `${mode}:${taskType}:${taskId}`;
      setProcessingActionKey(key);

      if (mode === "approve") {
        await orderRequestService.approveRequest(taskType, taskId);
        toast.success("Da duyet request");
      } else {
        await orderRequestService.rejectRequest(taskType, taskId);
        toast.success("Da tu choi request");
      }

      const warehouseFilter = listView === "approval" ? undefined : (selectedWarehouseId || undefined);
      await loadRequests(listView, warehouseFilter);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Cap nhat request that bai"));
    } finally {
      setProcessingActionKey("");
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <div className="flex min-h-[40vh] items-center justify-center">
          <LoadingSpinner message="Dang tai du lieu order requests..." className="flex-col gap-3 text-[13px]" />
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-5 lg:space-y-6">
      <FadeItem>
        <PageHeader
          icon={ListOrdered}
          title="Order Requests"
          description="Tao don yeu cau va duyet truoc khi vao Picking"
          iconBg="bg-gradient-to-br from-cyan-100 to-sky-50 border-cyan-200/50"
          iconColor="text-cyan-700"
        />
      </FadeItem>

      <FadeItem>
        <SectionCard
          title="Thong tin request"
          subtitle="Chon loai, kho nguon va ghi chu truoc khi them dong hang."
          icon={Send}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Loai request</p>
              <select
                value={requestType}
                onChange={(event) => setRequestType(event.target.value as RequestType)}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="outbound">Outbound Request</option>
                <option value="transfer">Warehouse Transfer Request</option>
              </select>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Warehouse nguon</p>
              <select
                value={selectedWarehouseId}
                onChange={(event) => setSelectedWarehouseId(event.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="">Chon warehouse</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>
                ))}
              </select>
            </div>

            {requestType === "transfer" ? (
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Warehouse dich</p>
                <select
                  value={targetWarehouseId}
                  onChange={(event) => setTargetWarehouseId(event.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <option value="">Chon warehouse dich</option>
                  {filteredWarehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">External reference</p>
                <input
                  value={externalReference}
                  onChange={(event) => setExternalReference(event.target.value)}
                  placeholder="SO-001 / Ticket code..."
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
            )}

            <div className="md:col-span-3">
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Note</p>
              <textarea
                value={requestNote}
                onChange={(event) => setRequestNote(event.target.value)}
                rows={2}
                className="min-h-[72px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
                placeholder="Ly do tao request..."
              />
            </div>
          </div>
        </SectionCard>
      </FadeItem>

      <FadeItem>
        <SectionCard
          title="Them lines"
          subtitle="Tim variant theo ISBN13, SKU hoac ten sach, sau do them vao bang duoi."
          icon={Plus}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={variantQuery}
                onChange={(event) => setVariantQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSearchVariant();
                  }
                }}
                placeholder="Nhap ISBN13, SKU hoac ten sach"
                className="h-9 w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            <Button
              type="button"
              onClick={() => void handleSearchVariant()}
              disabled={searchingVariant}
              loading={searchingVariant}
              className="shrink-0 sm:w-auto"
            >
              Tim
            </Button>
          </div>

          {variantResults.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-muted/20">
              {variantResults.map((variant) => (
                <div
                  key={variant.variant_id}
                  className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-foreground">{variant.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      ISBN13: {variant.isbn13 || "-"} | SKU: {variant.sku || "-"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="info-outline"
                    size="sm"
                    onClick={() => handleAddLine(variant)}
                    className="shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Them
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 overflow-hidden rounded-xl border border-border">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {["San pham", "So luong", "Action"].map((head) => (
                    <th
                      key={head}
                      className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draftLines.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-10 text-center">
                      <EmptyState
                        variant="no-data"
                        title="Chua co line nao"
                        description="Tim san pham va nhan Them de bat dau."
                        className="py-0"
                      />
                    </td>
                  </tr>
                ) : draftLines.map((line) => (
                  <tr key={line.isbn13} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 text-[12px]">
                      <p className="font-semibold text-foreground">{line.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        ISBN13: {line.isbn13} | SKU: {line.sku || "-"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[12px]">
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(event) => handleQuantityChange(line.isbn13, Number(event.target.value))}
                        className="h-9 w-full max-w-[120px] rounded-lg border border-input bg-background px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm-icon"
                        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => handleRemoveLine(line.isbn13)}
                        aria-label="Xoa dong"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-5">
            <Button type="button" variant="outline" onClick={resetForm}>
              Reset
            </Button>
            <Button type="button" onClick={() => void handleSubmitRequest()} disabled={submitting} loading={submitting}>
              <Send className="h-3.5 w-3.5" />
              Tao request
            </Button>
          </div>
        </SectionCard>
      </FadeItem>

      <FadeItem>
        <SectionCard
          title="Danh sach requests"
          subtitle={listView === "my" ? "Cac don ban da tao theo kho nguon." : "Hang cho duyet (can quyen phu hop)."}
          actions={(
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
              <Button
                type="button"
                variant={listView === "my" ? "default" : "ghost"}
                size="sm"
                className={listView === "my" ? "" : "text-muted-foreground"}
                onClick={() => setListView("my")}
              >
                Don cua toi
              </Button>
              {canApprove && (
                <Button
                  type="button"
                  variant={listView === "approval" ? "default" : "ghost"}
                  size="sm"
                  className={listView === "approval" ? "bg-emerald-600 hover:bg-emerald-600/90" : "text-muted-foreground"}
                  onClick={() => setListView("approval")}
                >
                  Approval queue
                </Button>
              )}
            </div>
          )}
        >
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="min-w-[920px] w-full">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {["Order", "Loai", "Nguon", "Dich", "Trang thai", "So luong", "Requested at", "Action"].map((head) => (
                    <th
                      key={head}
                      className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center">
                      <EmptyState
                        variant="no-data"
                        title="Khong co request nao"
                        description={listView === "approval" ? "Khong co don cho duyet." : "Hay tao request moi o phan tren."}
                        className="py-0"
                      />
                    </td>
                  </tr>
                ) : requests.map((row) => {
                  const approveKey = `approve:${row.task_type}:${row.task_id}`;
                  const rejectKey = `reject:${row.task_type}:${row.task_id}`;
                  const canTakeAction = listView === "approval"
                    && ((row.task_type === "outbound" && row.status === "PENDING_APPROVAL")
                      || (row.task_type === "transfer" && row.status === "REQUESTED"));

                  return (
                    <tr key={`${row.task_type}-${row.task_id}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 text-[12px]">
                        <p className="font-semibold text-foreground">{row.order_number}</p>
                        <p className="text-[11px] text-muted-foreground">{row.line_count} lines</p>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{row.order_type}</td>
                      <td className="px-4 py-3 text-[12px]">{row.source_warehouse_code || "-"}</td>
                      <td className="px-4 py-3 text-[12px]">{row.target_warehouse_code || "-"}</td>
                      <td className="px-4 py-3 text-[12px]">
                        <StatusBadge label={row.status} variant={statusBadgeVariant(row.status)} dot />
                      </td>
                      <td className="px-4 py-3 text-[12px] font-medium">{row.total_quantity}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(row.requested_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {canTakeAction ? (
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="success-outline"
                              size="sm"
                              onClick={() => void handleApproveOrReject(row.task_type, row.task_id, "approve")}
                              disabled={processingActionKey === approveKey || processingActionKey === rejectKey}
                            >
                              <Check className="h-3 w-3" />
                              Duyet
                            </Button>
                            <Button
                              type="button"
                              variant="danger-outline"
                              size="sm"
                              onClick={() => void handleApproveOrReject(row.task_type, row.task_id, "reject")}
                              disabled={processingActionKey === approveKey || processingActionKey === rejectKey}
                            >
                              Tu choi
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}
