import { Link } from 'react-router';
import { useAuthUser } from '@/hooks/useAuthUser';
import { usePageMeta } from '@/lib/page-meta';
import { buildLoginUrl } from '@/lib/return-url';
import { HowBorrowingWorks } from '@/components/public/how-borrowing-works';

export function PublicAboutPage() {
  usePageMeta({ title: 'Cách mượn sách', description: 'Cách tìm, đặt trước và nhận sách tại thư viện SmartBook.' });
  const { isAuthenticated } = useAuthUser();

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 pt-10 sm:px-6 lg:px-8">
      <header>
        <h1 className="font-serif text-[32px] font-semibold tracking-tight sm:text-[40px]">Về SmartBook</h1>
        <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-muted-foreground">
          SmartBook là hệ thống thư viện nhiều chi nhánh. Bạn có thể xem toàn bộ danh mục, số bản còn trên kệ ở từng chi nhánh
          và đánh giá của bạn đọc mà không cần tài khoản. Tài khoản bạn đọc chỉ cần khi bạn muốn đặt trước, lưu sách yêu thích,
          viết đánh giá hoặc theo dõi sách đang mượn.
        </p>
      </header>

      <HowBorrowingWorks cta={isAuthenticated ? null : { to: buildLoginUrl('/books', 'register'), label: 'Tạo tài khoản bạn đọc' }} />

      <section aria-labelledby="can-tai-khoan" className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 id="can-tai-khoan" className="text-[16px] font-semibold">Không cần tài khoản</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-muted-foreground">
            <li>Tìm sách, lọc theo thể loại, tác giả, năm xuất bản</li>
            <li>Xem chi tiết sách và chi nhánh còn sách</li>
            <li>Đọc đánh giá của bạn đọc khác</li>
          </ul>
        </div>
        <div>
          <h2 className="text-[16px] font-semibold">Cần tài khoản bạn đọc</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-muted-foreground">
            <li>Đặt trước và theo dõi phiếu mượn</li>
            <li>Danh sách yêu thích, đánh giá sách</li>
            <li>Gợi ý sách theo lịch sử đọc của bạn</li>
            <li>Tiền phạt, thanh toán và thông báo</li>
          </ul>
        </div>
      </section>

      <p className="text-[14px]">
        <Link to="/books" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Bắt đầu khám phá sách →</Link>
      </p>
    </div>
  );
}
