import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/status-badge";
import { Field } from "./field";
import { ReviewDisclosure } from "./review-queue-item";
import type { EditableBookForm } from "./types";

export function BookInfoTab({
  form,
  onFieldChange,
  completeSignalCount,
}: {
  form: EditableBookForm;
  onFieldChange: (field: keyof EditableBookForm, value: string) => void;
  completeSignalCount: number;
}) {
  return (
    <section aria-labelledby="catalog-record-title">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-300">Hồ sơ catalog</p>
          <h2 id="catalog-record-title" className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">Thông tin ấn bản</h2>
          <p className="mt-1 text-[14px] text-muted-foreground">Chỉnh sửa metadata trước khi áp dụng vào catalog.</p>
        </div>
        <StatusBadge label={`${completeSignalCount}/4 trường cốt lõi`} variant={completeSignalCount === 4 ? "success" : "warning"} />
      </div>

      <div className="space-y-5">
        <SectionCard title="Thông tin cốt lõi" subtitle="Dữ liệu dùng để nhận diện và phân loại sách.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
            <Field id="isbn" className="sm:col-span-2" label="ISBN" mono required value={form.isbn} onChange={(v) => onFieldChange("isbn", v)} />
            <Field id="title" className="sm:col-span-4" label="Tên sách" required value={form.title} onChange={(v) => onFieldChange("title", v)} />
            <Field id="subtitle" className="sm:col-span-6" label="Tựa phụ" value={form.subtitle} onChange={(v) => onFieldChange("subtitle", v)} />
            <Field id="authors" className="sm:col-span-3" label="Tác giả (cách nhau dấu phẩy)" value={form.authorsText} onChange={(v) => onFieldChange("authorsText", v)} />
            <Field id="publisher" className="sm:col-span-3" label="Nhà xuất bản" value={form.publisher} onChange={(v) => onFieldChange("publisher", v)} />
            <Field id="categories" className="sm:col-span-4" label="Thể loại (cách nhau dấu phẩy)" value={form.categoriesText} onChange={(v) => onFieldChange("categoriesText", v)} />
            <Field id="language" className="sm:col-span-2" label="Ngôn ngữ" value={form.language} onChange={(v) => onFieldChange("language", v)} />
          </div>
        </SectionCard>

        <SectionCard title="Nội dung catalog" subtitle="Mô tả giúp tìm kiếm và hỗ trợ chatbot.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="description" className="mb-2 text-[12px] font-semibold text-foreground">Mô tả</Label>
              <Textarea id="description" value={form.description} onChange={(e) => onFieldChange("description", e.target.value)} rows={5} className="resize-y bg-muted/[0.12] text-[14px] leading-6 focus-visible:bg-card" />
            </div>
            <div>
              <Label htmlFor="summaryVi" className="mb-2 text-[12px] font-semibold text-foreground">Tóm tắt ngắn cho chatbot</Label>
              <Textarea id="summaryVi" value={form.summaryVi} onChange={(e) => onFieldChange("summaryVi", e.target.value)} rows={2} placeholder="Tóm tắt 2-3 câu dùng cho AI chatbot..." className="bg-muted/[0.12] text-[14px] focus-visible:bg-card" />
            </div>
            <Field id="keywords" label="Từ khóa (cách nhau dấu phẩy)" value={form.keywordsText} onChange={(v) => onFieldChange("keywordsText", v)} />
          </div>
        </SectionCard>

        <ReviewDisclosure id="additional-metadata" title="Thông tin bổ sung" description="ISBN-10/13, ngày xuất bản, số trang và URL ảnh bìa." badge={<span className="text-[12px] text-muted-foreground">Tùy chọn</span>}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="isbn13" label="ISBN13" mono value={form.isbn13} onChange={(v) => onFieldChange("isbn13", v)} />
            <Field id="isbn10" label="ISBN10" mono value={form.isbn10} onChange={(v) => onFieldChange("isbn10", v)} />
            <Field id="publishedDate" label="Ngày xuất bản" value={form.publishedDate} onChange={(v) => onFieldChange("publishedDate", v)} />
            <Field id="pageCount" label="Số trang" value={form.pageCount} onChange={(v) => onFieldChange("pageCount", v)} />
            <Field id="thumbnail" label="URL ảnh bìa" className="sm:col-span-2" value={form.thumbnail} onChange={(v) => onFieldChange("thumbnail", v)} />
          </div>
        </ReviewDisclosure>
      </div>
    </section>
  );
}
