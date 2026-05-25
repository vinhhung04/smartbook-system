import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ClipboardList, Inbox, MapPinned, PackageCheck, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { getApiErrorMessage } from "@/services/api";
import { myWarehouseTaskService, type MyWarehouseTask } from "@/services/my-warehouse-tasks";

function taskTypeLabel(type: string) {
  const upper = String(type || "").toUpperCase();
  if (upper === "RECEIVING") return "Receiving";
  if (upper === "PUTAWAY") return "Putaway";
  if (upper === "PICKING") return "Picking";
  if (upper === "OUTBOUND") return "Outbound";
  return upper || "Task";
}

function taskStatusVariant(status: string): "success" | "warning" | "danger" | "info" | "neutral" | "cyan" {
  const upper = String(status || "").toUpperCase();
  if (upper.includes("DONE") || upper.includes("COMPLETE") || upper.includes("POSTED") || upper.includes("RECEIVED")) return "success";
  if (upper.includes("PROGRESS") || upper.includes("PICKING")) return "info";
  if (upper.includes("PENDING") || upper.includes("READY") || upper.includes("APPROVED")) return "warning";
  if (upper.includes("CANCEL") || upper.includes("REJECT")) return "danger";
  return "neutral";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MyWarehouseTasksPage() {
  const [tasks, setTasks] = useState<MyWarehouseTask[]>([]);
  const [loading, setLoading] = useState(true);

  const counts = useMemo(() => {
    return {
      receiving: tasks.filter((task) => task.type === "RECEIVING").length,
      putaway: tasks.filter((task) => task.type === "PUTAWAY").length,
      picking: tasks.filter((task) => task.type === "PICKING").length,
      outbound: tasks.filter((task) => task.type === "OUTBOUND").length,
    };
  }, [tasks]);

  const loadTasks = async () => {
    try {
      setLoading(true);
      const response = await myWarehouseTaskService.getMyTasks();
      setTasks(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong tai duoc cong viec kho"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();
  }, []);

  const cards = [
    { label: "Receiving tasks", value: counts.receiving, icon: Inbox, tone: "text-sky-700 bg-sky-50 border-sky-100" },
    { label: "Putaway tasks", value: counts.putaway, icon: MapPinned, tone: "text-violet-700 bg-violet-50 border-violet-100" },
    { label: "Picking tasks", value: counts.picking, icon: PackageCheck, tone: "text-emerald-700 bg-emerald-50 border-emerald-100" },
    { label: "Outbound tasks", value: counts.outbound, icon: Truck, tone: "text-amber-700 bg-amber-50 border-amber-100" },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50">
            <ClipboardList className="h-5 w-5 text-emerald-700" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Cong viec kho cua toi</h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Theo doi receiving, putaway, picking va outbound task da duoc giao</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadTasks()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Lam moi
        </Button>
      </motion.div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <SectionCard key={card.label}>
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${card.tone}`}>
                <card.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground">{card.label}</p>
                <p className="mt-1 text-2xl font-semibold">{card.value}</p>
              </div>
            </div>
          </SectionCard>
        ))}
      </div>

      <SectionCard noPadding>
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold">Task duoc giao</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Loai", "Ma task", "Kho", "Trang thai", "Tao luc", "Hoan tat"].map((header) => (
                  <th key={header} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">Dang tai cong viec...</td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10">
                    <EmptyState
                      icon={ClipboardList}
                      title="Chua co task duoc giao"
                      description="Nhan vien kho chi thao tac tren task da duoc quan ly giao. Cac nghiep vu tao don, dieu chuyen va dieu chinh ton kho khong hien thi tai day."
                    />
                  </td>
                </tr>
              ) : tasks.map((task) => (
                <tr key={`${task.type}:${task.id}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 text-[13px] font-medium">{taskTypeLabel(task.type)}</td>
                  <td className="px-5 py-3 text-[12px] font-mono text-muted-foreground">{task.title}</td>
                  <td className="px-5 py-3 text-[13px] text-muted-foreground">{task.warehouse || "-"}</td>
                  <td className="px-5 py-3"><StatusBadge label={task.status} variant={taskStatusVariant(task.status)} dot /></td>
                  <td className="px-5 py-3 text-[12px] text-muted-foreground">{formatDate(task.created_at)}</td>
                  <td className="px-5 py-3 text-[12px] text-muted-foreground">{formatDate(task.completed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
