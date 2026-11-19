/**
 * The ai-service /reading-stats endpoint reads `author` and `category` on each loan item, but /my/loans
 * returns `book_author` and no category at all. This fills both in from the public catalog
 * (matched by variant id, else by title), so "Tác giả hay đọc" and "Thể loại yêu thích" have data.
 */
type CatalogBook = { title: string; author: string | null; category: string | null; variant_id: string | null };
type LoanItem = { variant_id?: string | null; book_title?: string | null; book_author?: string | null; [key: string]: unknown };
type Loan = { loan_items?: LoanItem[] | null; [key: string]: unknown };

const key = (title: string | null | undefined) => (title || '').trim().toLocaleLowerCase('vi');

export function enrichLoansForStats<T extends Loan>(loans: T[], books: CatalogBook[]): T[] {
  const byVariant = new Map<string, CatalogBook>();
  const byTitle = new Map<string, CatalogBook>();
  for (const book of books) {
    if (book.variant_id) byVariant.set(book.variant_id, book);
    if (book.title) byTitle.set(key(book.title), book);
  }
  return loans.map((loan) => ({
    ...loan,
    loan_items: (loan.loan_items ?? []).map((item) => {
      const book = (item.variant_id && byVariant.get(item.variant_id)) || byTitle.get(key(item.book_title));
      return {
        ...item,
        author: item.book_author || book?.author || null,
        category: book?.category || null,
      };
    }),
  }));
}
