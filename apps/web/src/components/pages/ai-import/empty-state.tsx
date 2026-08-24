import { BookOpen } from "lucide-react";

export function EmptyLookupState() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-dashed border-cyan-200 bg-gradient-to-br from-cyan-50/50 via-card to-violet-50/50 p-8 text-center dark:border-cyan-500/20 dark:from-cyan-500/5 dark:via-card dark:to-violet-500/5">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-200/60 bg-card shadow-sm dark:border-cyan-500/20">
        <BookOpen className="h-7 w-7 text-cyan-500" />
      </div>
      <h3 className="text-[15px] font-semibold text-foreground">Sẵn sàng nhập sách mới</h3>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted-foreground">
        Nhấn Enter sau khi nhập ISBN, hoặc dùng nút Quét camera ở trên — hệ thống sẽ tra cứu metadata và AI sẽ tạo đề xuất để bạn duyệt.
      </p>
    </div>
  );
}
