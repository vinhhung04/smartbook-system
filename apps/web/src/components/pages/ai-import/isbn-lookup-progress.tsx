import { useEffect, useState } from "react";
import { SearchCheck } from "lucide-react";

/**
 * Honest wait state for an ISBN lookup. The backend answers in one response
 * (often 10–30 s while marketplace sites are scraped) and sends no per-source
 * progress, so nothing here claims a source has answered or how far along it is:
 * only that the request is running and for how long.
 */
export function IsbnLookupProgress() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div role="status" aria-live="polite" className="rounded-2xl border border-border bg-card px-5 py-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <SearchCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground">Đang tra cứu metadata cho ISBN này…</p>
          <p className="mt-1 max-w-[70ch] text-[12.5px] leading-relaxed text-muted-foreground">
            Hệ thống hỏi các nguồn đã cấu hình (thư viện số, nhà sách trực tuyến) và chỉ trả kết quả một lần khi xong.
            Nguồn nào có dữ liệu sẽ hiện ở phần Đối chiếu nguồn sau khi tra cứu hoàn tất.
          </p>
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground" aria-hidden="true">{elapsed}s</span>
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full w-1/3 animate-[lookup-sweep_1.6s_ease-in-out_infinite] rounded-full bg-primary/70 motion-reduce:w-full motion-reduce:animate-none motion-reduce:bg-primary/30" />
      </div>
      {elapsed >= 10 ? (
        <p className="mt-3 text-[12px] text-muted-foreground">Nhà sách trực tuyến thường phản hồi chậm — có thể mất đến khoảng 30 giây.</p>
      ) : null}
      <style>{"@keyframes lookup-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
    </div>
  );
}
