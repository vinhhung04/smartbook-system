export type SelectOption = {
  id: string;
  title: string;
  subtitle?: string | null;
  /** Extra searchable text (codes, emails) that is not displayed. */
  keywords?: string | null;
};

/** Lowercase, strip Vietnamese diacritics (đ included) so "kho ha noi" finds "Kho Hà Nội". */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** Every whitespace-separated term must appear somewhere in the option's text. */
export function filterOptions<T extends SelectOption>(options: T[], query: string): T[] {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return options;
  return options.filter((option) => {
    const haystack = normalizeSearchText([option.title, option.subtitle, option.keywords].filter(Boolean).join(' '));
    return terms.every((term) => haystack.includes(term));
  });
}
