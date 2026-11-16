// What the floating chatbot shows a reader beside the conversation: a digest of
// their loans and fines (from /my/loans and /my/fines), the loans an answer
// mentions, and the follow-up questions that fit an answer. Pure functions.

export interface ReaderLoan {
  id: string;
  loan_number: string;
  status: string;
  due_date?: string | null;
  primary_book_title?: string | null;
  extra_item_count?: number;
  renewal?: { pending?: boolean } | null;
}

export interface ReaderFine {
  id: string;
  fine_type?: string | null;
  status?: string | null;
  remaining_amount?: number | null;
}

export interface DigestCard {
  tone: 'alert' | 'notice' | 'calm';
  title: string;
  detail: string;
  /** The question the card asks the assistant when chosen. */
  question: string;
}

const DAY = 86_400_000;
const ACTIVE = new Set(['BORROWED', 'OVERDUE']);

export const isActiveLoan = (loan: ReaderLoan) => ACTIVE.has(String(loan.status).toUpperCase());
export const canRequestRenewal = (loan: ReaderLoan) => isActiveLoan(loan) && !loan.renewal?.pending;

/** Whole days from today to the due date: 0 is today, negative is overdue. */
export function daysUntil(due: string, now: number): number {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  return Math.round((startOfDay(new Date(due).getTime()) - startOfDay(now)) / DAY);
}

function bookName(loan: ReaderLoan): string {
  const title = loan.primary_book_title || loan.loan_number;
  return loan.extra_item_count ? `${title} và ${loan.extra_item_count} cuốn khác` : title;
}

function dueWords(days: number): string {
  if (days < 0) return `quá hạn ${-days} ngày`;
  if (days === 0) return 'đến hạn hôm nay';
  if (days === 1) return 'đến hạn ngày mai';
  return `đến hạn sau ${days} ngày`;
}

export function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString('vi-VN')}đ`;
}

/** At most two cards: the loan that needs attention first, then what is owed. */
export function readerDigest(loans: ReaderLoan[], fines: ReaderFine[], now = Date.now()): DigestCard[] {
  const cards: DigestCard[] = [];
  const active = loans
    .filter((l) => isActiveLoan(l) && l.due_date)
    .map((l) => ({ loan: l, days: daysUntil(l.due_date!, now) }))
    .sort((a, b) => a.days - b.days);

  if (active.length > 0) {
    const overdue = active.filter((a) => a.days < 0);
    const first = active[0];
    if (overdue.length > 0) {
      cards.push({
        tone: 'alert',
        title: overdue.length > 1 ? `${overdue.length} phiếu mượn đã quá hạn` : `${bookName(first.loan)} ${dueWords(first.days)}`,
        detail: overdue.length > 1 ? `Lâu nhất: ${bookName(first.loan)}, ${dueWords(first.days)}.` : 'Trả sớm để không phát sinh thêm phí trễ hạn.',
        question: 'Tôi có sách nào quá hạn? Tôi cần làm gì?',
      });
    } else {
      cards.push({
        tone: first.days <= 3 ? 'notice' : 'calm',
        title: `${bookName(first.loan)} ${dueWords(first.days)}`,
        detail: active.length > 1 ? `Bạn đang mượn ${active.length} phiếu.` : 'Bạn đang mượn 1 phiếu.',
        question: 'Tôi có sách nào sắp đến hạn trả?',
      });
    }
  }

  const owed = fines.filter((f) => Number(f.remaining_amount || 0) > 0);
  if (owed.length > 0) {
    const total = owed.reduce((sum, f) => sum + Number(f.remaining_amount || 0), 0);
    cards.push({
      tone: 'notice',
      title: `Phí phạt còn ${formatVnd(total)}`,
      detail: owed.length > 1 ? `${owed.length} khoản chưa thanh toán xong.` : '1 khoản chưa thanh toán xong.',
      question: 'Tôi có khoản phạt nào chưa thanh toán?',
    });
  }
  return cards;
}

/** Loan codes an answer names, in order, without repeats. */
export function mentionedLoanCodes(text: string): string[] {
  return [...new Set(text.match(/(?<![A-Za-z0-9-])(?:[A-Z]{2,8}-)?LOAN-[A-Z0-9]+(?:-[A-Z0-9]+)?\b/g) ?? [])];
}

const READER_FOLLOW_UPS: Array<{ intents: string[]; words: RegExp; questions: string[] }> = [
  { intents: ['FINE_SUMMARY_QUERY'], words: /phạt|thanh toán|nợ/i, questions: ['Làm sao để thanh toán phí phạt?', 'Vì sao tôi bị tính phí phạt?'] },
  { intents: ['OVERDUE_LOAN_QUERY'], words: /hạn|gia hạn|đang mượn|phiếu mượn/i, questions: ['Tôi có thể gia hạn sách nào?', 'Trả sách muộn bị phạt bao nhiêu?'] },
  { intents: ['RESERVATION_QUERY'], words: /đặt trước|đặt sách|giữ sách/i, questions: ['Khi nào tôi nhận được sách đã đặt?', 'Tôi có thể hủy đặt trước không?'] },
  { intents: ['BOOK_SEARCH_QUERY', 'TOP_BORROWED_BOOKS_QUERY'], words: /tìm sách|gợi ý|sách nào hay|thể loại/i, questions: ['Gợi ý sách tương tự cho tôi.', 'Sách nào đang được mượn nhiều?'] },
  { intents: [], words: /quy định|hướng dẫn|mượn tối đa/i, questions: ['Tôi được mượn tối đa bao nhiêu cuốn?', 'Phí trễ hạn được tính thế nào?'] },
];

const STAFF_FOLLOW_UPS: Record<string, string[]> = {
  OVERDUE_LOAN_QUERY: ['Khách nào có phạt chưa thanh toán?', 'Loan nào đến hạn trong 3 ngày tới?'],
  FINE_SUMMARY_QUERY: ['Tổng tiền phạt chưa thu là bao nhiêu?', 'Khách nào có phạt cao nhất?'],
  RESERVATION_QUERY: ['Đặt trước nào đang chờ xác nhận?', 'Có reservation nào sắp hết hạn?'],
  LOW_STOCK_QUERY: ['Đề xuất nhập thêm các sách sắp hết.', 'Cảnh báo các sách tồn kho thấp.'],
  REORDER_SUGGESTION_QUERY: ['Sách nào tồn kho dưới ngưỡng tối thiểu?', 'Biến động tồn kho trong tuần này.'],
  DASHBOARD_SUMMARY_QUERY: ['Sách nào tồn kho thấp?', 'Có loan nào quá hạn?'],
  TOP_BORROWED_BOOKS_QUERY: ['Sách nào tồn kho thấp?', 'Xu hướng mượn sách theo tháng.'],
  BORROW_TREND_QUERY: ['Sách nào được mượn nhiều nhất?', 'Có loan nào quá hạn?'],
  AGING_INVENTORY_QUERY: ['Đề xuất nhập thêm các sách sắp hết.', 'Sách nào được mượn nhiều nhất?'],
};

/** Two follow-up questions for an answer, never one already asked in this conversation. */
export function followUpsFor({ reader, intent, question, asked }: {
  reader: boolean;
  intent?: string | null;
  question: string;
  asked: string[];
}): string[] {
  let pool: string[] = [];
  if (reader) {
    const byIntent = READER_FOLLOW_UPS.find((g) => intent && g.intents.includes(intent));
    const byWords = READER_FOLLOW_UPS.find((g) => g.words.test(question));
    pool = (byIntent ?? byWords)?.questions ?? [];
  } else if (intent) {
    pool = STAFF_FOLLOW_UPS[intent] ?? [];
  }
  const seen = new Set(asked.map((q) => q.trim().toLowerCase()));
  return pool.filter((q) => !seen.has(q.toLowerCase())).slice(0, 2);
}
