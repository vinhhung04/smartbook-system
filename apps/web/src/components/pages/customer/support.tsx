import { Mail, MapPin, Phone, Clock } from 'lucide-react';
import { SectionCard } from '@/components/ui/section-card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CustomerPageHeader } from './_shared/customer-page-header';

// Configurable per deployment (same pattern as the admin monitor's health-check
// URLs), so this page never silently shows the same address in every install.
const SUPPORT_PHONE = import.meta.env.VITE_LIBRARY_SUPPORT_PHONE || '1900 1234';
const SUPPORT_EMAIL = import.meta.env.VITE_LIBRARY_SUPPORT_EMAIL || 'hotro@smartbook.vn';
const SUPPORT_HOURS = import.meta.env.VITE_LIBRARY_SUPPORT_HOURS || '8:00 – 20:00, Thứ 2 – Chủ nhật';

const FAQ_ITEMS = [
  {
    question: 'Làm sao để đổi email đăng nhập?',
    answer: 'Email đăng nhập không thể tự đổi trong ứng dụng. Vui lòng gọi hotline hoặc gửi email cho thư viện kèm tên đăng nhập và email mới để được hỗ trợ.',
  },
  {
    question: 'Làm sao để nâng cấp gói hội viên?',
    answer: 'Gói hội viên và hạn mức mượn được thư viện thiết lập. Liên hệ hotline hoặc ghé quầy thư viện để yêu cầu nâng cấp hoặc thỏa thuận hạn mức riêng.',
  },
  {
    question: 'Tài khoản của tôi chưa có hồ sơ hội viên, phải làm sao?',
    answer: 'Đây là bước thiết lập ban đầu do thư viện thực hiện. Vui lòng liên hệ hotline hoặc ghé quầy thư viện kèm tài khoản đăng nhập để được kích hoạt hội viên.',
  },
  {
    question: 'Tôi muốn gia hạn hoặc trả sách sớm thì làm ở đâu?',
    answer: 'Vào mục "Phiếu mượn" để gửi yêu cầu gia hạn trực tuyến. Trả sách vẫn cần thực hiện tại quầy thư viện.',
  },
];

export function CustomerSupportPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader title="Hỗ trợ & Liên hệ" subtitle="Các kênh liên hệ trực tiếp với thư viện và câu hỏi thường gặp" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <a
          href={`tel:${SUPPORT_PHONE.replace(/\s+/g, '')}`}
          className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-indigo-300 dark:hover:border-indigo-500/30"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
            <Phone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] text-muted-foreground">Hotline</p>
            <p className="text-[14px] font-semibold text-foreground">{SUPPORT_PHONE}</p>
          </div>
        </a>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-indigo-300 dark:hover:border-indigo-500/30"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
            <Mail className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] text-muted-foreground">Email hỗ trợ</p>
            <p className="truncate text-[14px] font-semibold text-foreground">{SUPPORT_EMAIL}</p>
          </div>
        </a>
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
            <Clock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] text-muted-foreground">Giờ làm việc</p>
            <p className="text-[14px] font-semibold text-foreground">{SUPPORT_HOURS}</p>
          </div>
        </div>
      </div>

      <SectionCard title="Ghé quầy thư viện" subtitle="Trả sách và các thủ tục cần giấy tờ gốc vẫn thực hiện trực tiếp tại quầy">
        <div className="flex items-start gap-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">
            Xem địa chỉ chi nhánh gần bạn tại quầy tiếp tân, hoặc hỏi trực tiếp qua hotline/email ở trên.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Câu hỏi thường gặp" noPadding>
        <Accordion type="single" collapsible>
          {FAQ_ITEMS.map((item, i) => (
            <AccordionItem key={item.question} value={`faq-${i}`}>
              <AccordionTrigger className="px-5 text-[13px] font-medium">{item.question}</AccordionTrigger>
              <AccordionContent className="px-5 text-[13px] text-muted-foreground">{item.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </SectionCard>
    </div>
  );
}
