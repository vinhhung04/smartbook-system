// AI Copilot 3.2: which verification note (if any) to show under an answer.
// Pure function so it can be unit-tested; the component only renders it.
// Never shows internal codes (categories, claim/scope ids) or "100%": only the
// reader-facing labels the backend sends and one of four short states.

export interface AiVerificationClaim {
  type: string;
  category: string;
  label: string;
  verdict: 'SUPPORTED' | 'CONTRADICTED' | 'UNSUPPORTED' | 'UNVERIFIABLE' | string;
  severity?: 'minor' | 'major' | 'critical' | null;
  detail?: string;
  text?: string;
}

export interface AiVerification {
  status: 'PASSED' | 'REPAIRED' | 'WARNING' | 'BLOCKED' | string;
  claims: AiVerificationClaim[];
  counts?: Record<string, number>;
  checked?: number;
  repairs?: Array<{ category: string; label: string }>;
  retried?: boolean;
  safe_to_act?: boolean;
}

export interface LegacyFaithfulness {
  status: string;
  issues: Array<{ type: string; label: string }>;
}

export type VerificationTone = 'checked' | 'adjusted' | 'warning' | 'blocked';

export interface VerificationNotice {
  tone: VerificationTone;
  title: string;
  items: string[];
}

const TITLES: Record<VerificationTone, string> = {
  checked: 'Đã đối chiếu với dữ liệu hệ thống',
  adjusted: 'Một số số liệu trong câu trả lời đã được điều chỉnh theo dữ liệu',
  warning: 'Một số nhận định chưa có dữ liệu hỗ trợ',
  blocked: 'Không kiểm chứng được một khuyến nghị an toàn — câu trả lời đã được thay bằng kết luận tính trực tiếp từ dữ liệu',
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function verificationNotice(
  verification?: AiVerification | null,
  faithfulness?: LegacyFaithfulness | null,
): VerificationNotice | null {
  if (verification && typeof verification === 'object') {
    const claims = Array.isArray(verification.claims) ? verification.claims : [];
    const problems = unique(
      claims
        .filter((c) => (c.verdict === 'CONTRADICTED' || c.verdict === 'UNSUPPORTED') && c.category !== 'LABEL')
        .map((c) => c.label),
    );
    const supported = verification.counts?.SUPPORTED ?? claims.filter((c) => c.verdict === 'SUPPORTED').length;
    switch (verification.status) {
      case 'BLOCKED':
        return { tone: 'blocked', title: TITLES.blocked, items: problems };
      case 'WARNING':
        return { tone: 'warning', title: TITLES.warning, items: problems };
      case 'REPAIRED': {
        const repaired = unique((verification.repairs ?? []).map((r) => r.label));
        // Only internal labels were stripped: nothing the reader needs to know.
        if (!repaired.length && !verification.retried) return supported > 0 ? { tone: 'checked', title: TITLES.checked, items: [] } : null;
        return { tone: 'adjusted', title: TITLES.adjusted, items: repaired };
      }
      case 'PASSED':
        return supported > 0 ? { tone: 'checked', title: TITLES.checked, items: [] } : null;
      default:
        return null;
    }
  }
  // Answers stored before 3.2 (reopened history): the 3.1 note, unchanged.
  if (faithfulness && (faithfulness.status === 'warning' || faithfulness.status === 'fallback')) {
    const items = unique((faithfulness.issues ?? []).filter((i) => i.type !== 'INTERNAL_LABEL').map((i) => i.label));
    return faithfulness.status === 'fallback'
      ? { tone: 'blocked', title: 'Câu trả lời đã được thay bằng kết luận tính trực tiếp từ dữ liệu', items }
      : { tone: 'warning', title: 'Một số nhận định chưa khớp hoàn toàn với dữ liệu', items };
  }
  return null;
}
