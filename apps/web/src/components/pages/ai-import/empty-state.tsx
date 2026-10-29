import { BookCheck, GitCompareArrows, PencilLine } from "lucide-react";

const STEPS = [
  { icon: GitCompareArrows, title: "Đối chiếu", text: "Kết quả tra cứu và đọc ảnh hiện cạnh nhau, kèm nguồn của từng giá trị." },
  { icon: PencilLine, title: "Kiểm duyệt", text: "Trường xung đột, trùng lặp và chuẩn hóa chờ bạn quyết định — không tự áp dụng." },
  { icon: BookCheck, title: "Lưu", text: "Sách chỉ được tạo khi bạn bấm Lưu, sau khi các điều kiện bắt buộc đã đủ." },
];

export function EmptyLookupState() {
  return (
    <div className="rounded-2xl border border-dashed border-border px-5 py-6">
      <p className="text-[13px] font-semibold text-foreground">Chưa có sách nào đang nhập</p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">Bắt đầu bằng ISBN hoặc ảnh sách ở trên. Sau đó, không gian làm việc sẽ mở ra ở đây.</p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-2.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <span className="block text-[13px] font-medium text-foreground">{title}</span>
              <span className="block text-[12px] leading-relaxed text-muted-foreground">{text}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
