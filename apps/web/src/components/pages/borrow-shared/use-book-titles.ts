import { useEffect, useState } from 'react';
import { bookService } from '@/services/book';

interface BookRow {
  variant_id?: string;
  title?: string;
}

/**
 * variant_id -> book title. Borrow records only store the variant id; the catalog endpoint
 * returns every title in one response, so it is fetched once per page.
 */
export function useBookTitles() {
  const [titles, setTitles] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    let active = true;
    bookService.getAll()
      .then((rows: unknown) => {
        if (!active) return;
        if (!Array.isArray(rows)) { setTitles(new Map()); return; }
        setTitles(new Map((rows as BookRow[])
          .filter((row) => row.variant_id && row.title)
          .map((row) => [row.variant_id as string, row.title as string])));
      })
      .catch(() => { if (active) setTitles(new Map()); });
    return () => { active = false; };
  }, []);

  // Until the catalog arrives show an ellipsis, not a misleading "not in catalog".
  return (variantId: string) => (titles ? titles.get(variantId) ?? 'Sách ngoài danh mục' : '…');
}
