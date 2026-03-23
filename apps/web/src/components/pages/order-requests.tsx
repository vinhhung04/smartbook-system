import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardList, Plus, Search, Send, X } from "lucide-react";
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
        <p className="text-[13px] text-slate-400">Dang tai du lieu order requests...</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-cyan-100 to-blue-50 flex items-center justify-center border border-cyan-200/50">
            <ClipboardList className="w-5 h-5 text-cyan-700" />
          </div>
          <div>
            <h1 className="tracking-[-0.02em]">Order Requests</h1>
            <p className="text-[12px] text-slate-400 mt-0.5">Tao don yeu cau va duyet truoc khi vao Picking</p>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[12px] border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <p className="text-[11px] text-slate-500 mb-1">Loai request</p>
            <select
              value={requestType}
              onChange={(event) => setRequestType(event.target.value as RequestType)}
              className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
            >
              <option value="outbound">Outbound Request</option>
              <option value="transfer">Warehouse Transfer Request</option>
            </select>
          </div>

          <div>
            <p className="text-[11px] text-slate-500 mb-1">Warehouse nguon</p>
            <select
              value={selectedWarehouseId}
              onChange={(event) => setSelectedWarehouseId(event.target.value)}
              className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
            >
              <option value="">Chon warehouse</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>
              ))}
            </select>
          </div>

          {requestType === "transfer" ? (
            <div>
              <p className="text-[11px] text-slate-500 mb-1">Warehouse dich</p>
              <select
                value={targetWarehouseId}
                onChange={(event) => setTargetWarehouseId(event.target.value)}
                className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
              >
                <option value="">Chon warehouse dich</option>
                {filteredWarehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <p className="text-[11px] text-slate-500 mb-1">External reference</p>
              <input
                value={externalReference}
                onChange={(event) => setExternalReference(event.target.value)}
                placeholder="SO-001 / Ticket code..."
                className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
              />
            </div>
          )}

          <div className="md:col-span-3">
            <p className="text-[11px] text-slate-500 mb-1">Note</p>
            <textarea
              value={requestNote}
              onChange={(event) => setRequestNote(event.target.value)}
              rows={2}
              className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-[12px]"
              placeholder="Ly do tao request..."
            />
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[12px] border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-[12px] text-slate-600">Them lines</p>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={variantQuery}
                onChange={(event) => setVariantQuery(event.target.value)}
                placeholder="Nhap ISBN13, SKU hoac ten sach"
                className="w-full pl-9 pr-3 py-2 rounded-[10px] border border-slate-200 text-[12px]"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSearchVariant()}
              disabled={searchingVariant}
              className="px-3 py-2 rounded-[10px] text-[12px] bg-slate-900 text-white disabled:opacity-60"
            >
              Tim
            </button>
          </div>

          {variantResults.length > 0 && (
            <div className="rounded-[10px] border border-slate-200 overflow-hidden">
              {variantResults.map((variant) => (
                <div key={variant.variant_id} className="px-3 py-2 border-b border-slate-100 last:border-0 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] text-slate-700 truncate" style={{ fontWeight: 550 }}>{variant.title}</p>
                    <p className="text-[11px] text-slate-500">ISBN13: {variant.isbn13 || "-"} | SKU: {variant.sku || "-"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddLine(variant)}
                    className="px-2.5 py-1.5 rounded-[8px] text-[11px] bg-cyan-50 text-cyan-700 border border-cyan-200"
                  >
                    <Plus className="w-3 h-3 inline mr-1" />
                    Them
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-[10px] border border-slate-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100 text-[11px] text-slate-500">
                  <th className="text-left px-3 py-2">San pham</th>
                  <th className="text-left px-3 py-2 w-[130px]">So luong</th>
                  <th className="text-right px-3 py-2 w-[100px]">Action</th>
                </tr>
              </thead>
              <tbody>
                {draftLines.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-[12px] text-slate-400">Chua co line nao</td>
                  </tr>
                ) : draftLines.map((line) => (
                  <tr key={line.isbn13} className="border-b border-slate-100 last:border-0 text-[12px]">
                    <td className="px-3 py-2">
                      <p className="text-slate-700" style={{ fontWeight: 550 }}>{line.title}</p>
                      <p className="text-[11px] text-slate-500">ISBN13: {line.isbn13} | SKU: {line.sku || "-"}</p>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(event) => handleQuantityChange(line.isbn13, Number(event.target.value))}
                        className="w-full rounded-[8px] border border-slate-200 px-2 py-1.5"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(line.isbn13)}
                        className="text-rose-600 hover:text-rose-700"
                      >
                        <X className="w-4 h-4 inline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="px-3 py-2 rounded-[10px] text-[12px] border border-slate-200"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => void handleSubmitRequest()}
              disabled={submitting}
              className="px-3 py-2 rounded-[10px] text-[12px] bg-cyan-600 text-white disabled:opacity-60"
            >
              <Send className="w-3.5 h-3.5 inline mr-1" />
              Tao request
            </button>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-[12px] border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] text-slate-600">Danh sach requests</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setListView("my")}
                className={`px-2.5 py-1.5 rounded-[8px] text-[11px] border ${listView === "my" ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-600"}`}
              >
                Don cua toi
              </button>
              {canApprove && (
                <button
                  type="button"
                  onClick={() => setListView("approval")}
                  className={`px-2.5 py-1.5 rounded-[8px] text-[11px] border ${listView === "approval" ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-200 text-slate-600"}`}
                >
                  Approval queue
                </button>
              )}
            </div>
          </div>

          <div className="rounded-[10px] border border-slate-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100 text-[11px] text-slate-500">
                  <th className="text-left px-3 py-2">Order</th>
                  <th className="text-left px-3 py-2">Loai</th>
                  <th className="text-left px-3 py-2">Nguon</th>
                  <th className="text-left px-3 py-2">Dich</th>
                  <th className="text-left px-3 py-2">Trang thai</th>
                  <th className="text-left px-3 py-2">So luong</th>
                  <th className="text-left px-3 py-2">Requested at</th>
                  <th className="text-right px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-[12px] text-slate-400">Khong co request nao</td>
                  </tr>
                ) : requests.map((row) => {
                  const approveKey = `approve:${row.task_type}:${row.task_id}`;
                  const rejectKey = `reject:${row.task_type}:${row.task_id}`;
                  const canTakeAction = listView === "approval"
                    && ((row.task_type === "outbound" && row.status === "PENDING_APPROVAL")
                      || (row.task_type === "transfer" && row.status === "REQUESTED"));

                  return (
                    <tr key={`${row.task_type}-${row.task_id}`} className="border-b border-slate-100 last:border-0 text-[12px]">
                      <td className="px-3 py-2">
                        <p className="text-slate-700" style={{ fontWeight: 600 }}>{row.order_number}</p>
                        <p className="text-[11px] text-slate-500">{row.line_count} lines</p>
                      </td>
                      <td className="px-3 py-2">{row.order_type}</td>
                      <td className="px-3 py-2">{row.source_warehouse_code || "-"}</td>
                      <td className="px-3 py-2">{row.target_warehouse_code || "-"}</td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-1 rounded-full text-[11px] bg-slate-100 text-slate-700">{row.status}</span>
                      </td>
                      <td className="px-3 py-2">{row.total_quantity}</td>
                      <td className="px-3 py-2">{formatDate(row.requested_at)}</td>
                      <td className="px-3 py-2 text-right">
                        {canTakeAction ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleApproveOrReject(row.task_type, row.task_id, "approve")}
                              disabled={processingActionKey === approveKey || processingActionKey === rejectKey}
                              className="px-2 py-1 rounded-[7px] text-[11px] border border-emerald-200 bg-emerald-50 text-emerald-700 disabled:opacity-60"
                            >
                              <Check className="w-3 h-3 inline mr-1" />
                              Duyet
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleApproveOrReject(row.task_type, row.task_id, "reject")}
                              disabled={processingActionKey === approveKey || processingActionKey === rejectKey}
                              className="px-2 py-1 rounded-[7px] text-[11px] border border-rose-200 bg-rose-50 text-rose-700 disabled:opacity-60"
                            >
                              Tu choi
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
