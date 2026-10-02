import { Link } from 'react-router';
import { ArrowRight, Check, KeyRound } from 'lucide-react';
import { useAuthUser } from '@/hooks/useAuthUser';
import { usePageMeta } from '@/lib/page-meta';
import { buildLoginUrl } from '@/lib/return-url';
import { HowBorrowingWorks } from '@/components/public/how-borrowing-works';
import { PageHero } from '@/components/public/page-hero';
import { Reveal } from '@/components/public/book-row';

const OPEN_TO_ALL = [
  'Tìm sách, lọc theo thể loại, tác giả, năm xuất bản',
  'Xem chi tiết sách và chi nhánh còn sách',
  'Đọc đánh giá của bạn đọc khác',
  'Nhờ AI gợi ý sách theo mô tả của bạn',
];

const NEEDS_ACCOUNT = [
  'Đặt trước và theo dõi phiếu mượn',
  'Danh sách yêu thích, đánh giá sách, báo khi có sách',
  'Gợi ý sách theo lịch sử đọc của bạn',
  'Tiền phạt, thanh toán và thông báo',
];

export function PublicAboutPage() {
  usePageMeta({ title: 'Cách mượn sách', description: 'Cách tìm, đặt trước và nhận sách tại thư viện SmartBook.' });
  const { isAuthenticated } = useAuthUser();

  return (
    <>
      <PageHero
        eyebrow="Về SmartBook"
        title="Thư viện nhiều chi nhánh, mở cho mọi người xem"
        description="Bạn có thể xem toàn bộ danh mục, số bản còn trên kệ ở từng chi nhánh và đánh giá của bạn đọc mà không cần tài khoản. Tài khoản bạn đọc chỉ cần khi bạn muốn đặt trước, lưu sách yêu thích, viết đánh giá hoặc theo dõi sách đang mượn."
      >
        <Link to="/books" className="group inline-flex h-11 items-center gap-1.5 rounded-full bg-indigo-700 px-5 text-[14px] font-semibold text-white hover:bg-indigo-800 dark:bg-indigo-500 dark:hover:bg-indigo-400">
          Bắt đầu khám phá sách <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </PageHero>

      <div className="mx-auto max-w-7xl space-y-16 px-4 pt-12 sm:px-6 lg:px-8">
        <Reveal>
          <section aria-labelledby="can-tai-khoan" className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 id="can-tai-khoan" className="font-serif text-[22px] font-semibold tracking-tight">Không cần tài khoản</h2>
              <ul className="mt-4 space-y-2.5">
                {OPEN_TO_ALL.map((item) => (
                  <li key={item} className="flex gap-2.5 text-[14px] text-foreground/85">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-6 dark:border-indigo-500/25 dark:bg-indigo-950/20">
              <h2 className="font-serif text-[22px] font-semibold tracking-tight">Cần tài khoản bạn đọc</h2>
              <ul className="mt-4 space-y-2.5">
                {NEEDS_ACCOUNT.map((item) => (
                  <li key={item} className="flex gap-2.5 text-[14px] text-foreground/85">
                    <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" /> {item}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </Reveal>

        <Reveal>
          <HowBorrowingWorks
            variant="band"
            cta={isAuthenticated ? null : { to: buildLoginUrl('/books', 'register'), label: 'Tạo tài khoản bạn đọc' }}
            secondary={isAuthenticated ? { to: '/customer', label: 'Đến Sách của tôi' } : { to: '/books', label: 'Duyệt danh mục' }}
          />
        </Reveal>
      </div>
    </>
  );
}
