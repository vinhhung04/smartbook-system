import { useCallback, useEffect, useState } from 'react';
import { customerBorrowService } from '@/services/customer-borrow';
import type { ReaderFine, ReaderLoan } from '@/lib/chat-reader';

export interface ReaderSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error';
  loans: ReaderLoan[];
  fines: ReaderFine[];
  refresh: () => void;
}

/** The reader's own loans and fines for the floating chatbot, loaded while `enabled`. */
export function useReaderSnapshot(enabled: boolean): ReaderSnapshot {
  const [state, setState] = useState<Omit<ReaderSnapshot, 'refresh'>>({ status: 'idle', loans: [], fines: [] });
  // Sets state only when the requests settle, so the effect below never renders twice in a row.
  const load = useCallback(() => {
    if (!enabled) return;
    Promise.all([customerBorrowService.getMyLoans({ pageSize: 100 }), customerBorrowService.getMyFines()])
      .then(([loans, fines]) => setState({
        status: 'ready',
        loans: Array.isArray(loans?.data) ? loans.data : [],
        fines: Array.isArray(fines?.data?.fines) ? fines.data.fines : [],
      }))
      .catch(() => setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'error' })));
  }, [enabled]);
  useEffect(() => { load(); }, [load]);
  const refresh = useCallback(() => {
    if (!enabled) return;
    setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading' }));
    load();
  }, [enabled, load]);
  // The first load is in flight as soon as the snapshot is enabled.
  const status = enabled && state.status === 'idle' ? 'loading' : state.status;
  return { ...state, status, refresh };
}
