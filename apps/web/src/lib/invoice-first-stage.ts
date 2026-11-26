import type { SupplierPortalOrder } from "@/services/supplier-portal";

export type FlowTab = "response" | "documents" | "delivery";

/** Where an invoice-first order stands for the supplier, and the one thing to do next. */
export function invoiceFirstStage(order: SupplierPortalOrder) {
  const po = order.purchase_order;
  const invoices = order.invoice_fulfillment || [];
  const pendingProposal = order.supplier_responses?.some((row) => row.review_status === "PENDING_REVIEW");
  const approved = invoices.filter((f) => f.approval_status === "APPROVED");
  const pendingInvoice = invoices.some((f) => f.approval_status === "PENDING_APPROVAL");
  const rejectedInvoice = invoices.some((f) => f.approval_status === "REJECTED");
  const toShip = approved.some((f) => f.lines.some((line) => line.remaining_to_ship_qty > 0));
  if (po.status === "SENT_TO_SUPPLIER") {
    return pendingProposal
      ? { step: 1, title: "Chờ SmartBook duyệt đề xuất số lượng và đơn giá", tab: null }
      : { step: 0, title: "Gửi đề xuất số lượng và đơn giá cho SmartBook", tab: "response" as FlowTab, action: "Phản hồi đơn" };
  }
  if (!["SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(po.status)) return null;
  if (approved.length === 0) {
    if (pendingInvoice) return { step: 3, title: "Hóa đơn đang chờ SmartBook duyệt", tab: null };
    return {
      step: 2,
      title: rejectedInvoice ? "SmartBook đã từ chối hóa đơn — lập hóa đơn mới theo lý do ở mục Chứng từ" : "SmartBook đã duyệt đề xuất — bước tiếp theo: lập hóa đơn",
      tab: "documents" as FlowTab,
      action: "Lập hóa đơn",
    };
  }
  if (toShip) return { step: 4, title: "Hóa đơn đã được duyệt — lập phiếu giao hàng (giao được nhiều đợt)", tab: "delivery" as FlowTab, action: "Lập phiếu giao" };
  return { step: 5, title: "Đã gửi đủ hàng theo hóa đơn — chờ SmartBook xác nhận nhận hàng", tab: null };
}

