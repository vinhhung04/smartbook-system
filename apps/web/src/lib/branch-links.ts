import type { BranchStats } from '@/services/public-catalog';

/** Where "Xem sách tại chi nhánh" lands: what can be reserved there, or — when
 *  every copy is lent out — everything the branch holds, so it's never a dead end. */
export function branchBooksUrl(branch: { id: string; stats: BranchStats }) {
  const params = new URLSearchParams({ branch: branch.id });
  if (branch.stats.available_title_count > 0) params.set('availability', 'available');
  return `/books?${params.toString()}`;
}
