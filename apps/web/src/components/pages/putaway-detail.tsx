import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { PageWrapper, FadeItem } from "../motion-utils";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/services/api.ts";
import { putawayService, type PutawayReceiptDetail } from "@/services/putaway";

function formatDate(value: string | null): string {
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

export function PutawayDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<PutawayReceiptDetail | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data = await putawayService.getReceiptDetail(id);
        setDetail(data);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Khong tai duoc chi tiet phieu"));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [id]);

  const remainingItems = useMemo(() => detail?.items.filter((item) => item.remaining_quantity > 0) || [], [detail]);

  if (loading) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-slate-400">Dang tai chi tiet phieu...</p>
      </PageWrapper>
    );
  }

  if (!detail) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-slate-400">Khong tim thay phieu nhap.</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <NavLink to="/putaway" className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-blue-600 transition-colors" style={{ fontWeight: 550 }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Quay lai danh sach putaway
        </NavLink>
      </FadeItem>

      <FadeItem>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-slate-200 bg-white p-4">
          <div>
            <h1 className="tracking-[-0.02em]">{detail.receipt_number}</h1>
            <p className="text-[12px] text-slate-500 mt-0.5">Kho: {detail.warehouse_code || detail.warehouse_name || "-"} · Ngay duyet: {formatDate(detail.received_at || detail.created_at)}</p>
          </div>
          <button
            onClick={() => navigate(`/putaway/${detail.id}/execute`)}
            disabled={detail.remaining_quantity <= 0}
            className="inline-flex items-center gap-2 rounded-[10px] bg-violet-600 px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            <PackageCheck className="w-3.5 h-3.5" /> Nhap hang
          </button>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-[12px] border border-slate-200 bg-white p-3">
            <p className="text-[11px] text-slate-400 uppercase">Tong so luong</p>
            <p className="text-[24px] text-slate-700" style={{ fontWeight: 700 }}>{detail.total_quantity}</p>
          </div>
          <div className="rounded-[12px] border border-slate-200 bg-white p-3">
            <p className="text-[11px] text-slate-400 uppercase">Da nhap ke</p>
            <p className="text-[24px] text-emerald-700" style={{ fontWeight: 700 }}>{detail.putaway_quantity}</p>
          </div>
          <div className="rounded-[12px] border border-slate-200 bg-white p-3">
            <p className="text-[11px] text-slate-400 uppercase">Con lai</p>
            <p className="text-[24px] text-blue-700" style={{ fontWeight: 700 }}>{detail.remaining_quantity}</p>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="bg-white rounded-[16px] border border-white/80 overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-gradient-to-r from-blue-50/40 to-transparent">
                {["SKU/Barcode", "Ten san pham", "So luong", "Da nhap ke", "Ton kho cho xep ke", "Nhap hang"].map((header) => (
                  <th key={header} className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => (
                <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-blue-50/20 transition-colors">
                  <td className="px-5 py-3.5 text-[12px] font-mono text-slate-500">{item.sku || item.barcode || "-"}</td>
                  <td className="px-5 py-3.5 text-[13px]" style={{ fontWeight: 550 }}>{item.book_title}</td>
                  <td className="px-5 py-3.5 text-[13px]">{item.quantity}</td>
                  <td className="px-5 py-3.5 text-[13px] text-emerald-700">{item.putaway_quantity}</td>
                  <td className="px-5 py-3.5 text-[13px] text-blue-700" style={{ fontWeight: 600 }}>{item.remaining_quantity}</td>
                  <td className="px-5 py-3.5 text-[12px]">
                    <button
                      onClick={() => navigate(`/putaway/${detail.id}/execute`)}
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-violet-200 bg-violet-50 px-3 py-1.5 text-violet-700 hover:bg-violet-100"
                      style={{ fontWeight: 600 }}
                    >
                      <PackageCheck className="w-3.5 h-3.5" /> Nhap hang
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FadeItem>

      {remainingItems.length === 0 ? (
        <FadeItem>
          <div className="rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-700">Tat ca dong hang da duoc nhap len ke.</div>
        </FadeItem>
      ) : null}
    </PageWrapper>
  );
}
