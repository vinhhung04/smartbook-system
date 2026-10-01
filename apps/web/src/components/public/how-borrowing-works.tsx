import { Link } from 'react-router';

// A real sequence (the order matters), so the numbers carry information.
const STEPS = [
  { title: 'Tìm sách', body: 'Duyệt danh mục hoặc tìm theo tên, tác giả, ISBN. Mỗi cuốn đều cho biết còn bao nhiêu bản và ở chi nhánh nào.' },
  { title: 'Đặt trước trực tuyến', body: 'Chọn chi nhánh muốn đến lấy. Thư viện giữ sách cho bạn trong thời hạn theo gói hội viên.' },
  { title: 'Nhận sách tại quầy', body: 'Khi sách sẵn sàng, bạn nhận mã nhận sách. Đưa mã cho thủ thư để mượn và theo dõi hạn trả trong “Sách của tôi”.' },
];

export function HowBorrowingWorks({ cta }: { cta: { to: string; label: string } | null }) {
  return (
    <section aria-labelledby="cach-muon-sach" className="rounded-xl border border-border bg-card p-6 sm:p-8">
      <h2 id="cach-muon-sach" className="font-serif text-[22px] font-semibold tracking-tight sm:text-[26px]">Mượn sách thế nào?</h2>
      <ol className="mt-6 grid gap-6 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-indigo-600/40 font-mono text-[12px] font-semibold text-indigo-700 dark:text-indigo-300">{index + 1}</span>
            <div>
              <h3 className="text-[15px] font-semibold">{step.title}</h3>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {cta ? (
        <Link to={cta.to} className="mt-7 inline-flex h-10 items-center rounded-md bg-indigo-700 px-4 text-[14px] font-semibold text-white hover:bg-indigo-800 dark:bg-indigo-500 dark:hover:bg-indigo-400">
          {cta.label}
        </Link>
      ) : null}
    </section>
  );
}
