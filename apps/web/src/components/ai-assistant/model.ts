import type { ComponentType, SVGProps } from 'react';
import { BookAlertIcon, BookDueIcon, BookPileIcon, BookStackIcon, BookTaskIcon } from '@/components/ai-experience/smartbook-icons';
import type {
  AiDecision,
  AiEvidenceItem,
  AiExecution,
  AiRebalanceDecision,
  AiTimelineStage,
  AiExplanation,
  AiFaithfulness,
  AiRecommendation,
  AssistantExtras,
  PendingAction,
} from '@/services/ai';
import type { AiVerification } from '@/lib/copilot-verification';
import type { AiExplainability, BookRecognition } from '@/services/ai-experience';
import type { AuthUser } from '@/services/auth';
import { hasAnyPermission } from '@/lib/rbac';
import { sanitizeVisualizations, type CopilotVisualizationSpec } from '@/lib/copilot-visualization';

// The message model of the /ai-assistant workspace and the role-aware starter
// questions. The assistant fields mirror the backend response one-to-one: the
// UI only arranges them, it never derives new figures from them.

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  pendingAction?: PendingAction;
  evidence?: AiEvidenceItem[];
  groundingWarning?: string | null;
  retrievalWarnings?: string[];
  followups?: string[];
  caveats?: string[];
  recommendations?: AiRecommendation[];
  dataAsOf?: string | null;
  explanation?: AiExplanation | null;
  visualizations?: CopilotVisualizationSpec[];
  visualizationNotes?: string[];
  faithfulness?: AiFaithfulness | null;
  verification?: AiVerification | null;
  decision?: AiDecision | AiRebalanceDecision | null;
  /** Rebalancing: the confirmed draft's real outcome, and the stages the turn completed. */
  execution?: AiExecution | null;
  timeline?: AiTimelineStage[];
  /** Streaming: the draft text is being checked against the data (Copilot 3.2). */
  verifying?: boolean;
  /** Reopened from history: charts show the stored snapshot, never refreshed. */
  fromHistory?: boolean;
  isError?: boolean;
  /** Phase F (client only, not stored server-side): a cover photo and its recognition. */
  hasPhoto?: boolean;
  recognition?: BookRecognition;
  pendingQuestion?: string;
  chosenBookId?: string | null;
  /** Phase F: the unified evidence contract of the answer (ai_core/explainability.py). */
  explainability?: AiExplainability | null;
}

export function extrasToMessageFields(extras?: AssistantExtras | null): Partial<AssistantMessage> {
  return {
    followups: extras?.suggested_followups ?? [],
    caveats: extras?.caveats ?? [],
    recommendations: extras?.recommendations ?? [],
    dataAsOf: extras?.data_as_of ?? null,
    explanation: extras?.explanation ?? null,
    visualizations: sanitizeVisualizations(extras?.visualizations),
    visualizationNotes: extras?.visualization_notes ?? [],
    faithfulness: extras?.faithfulness ?? null,
    verification: extras?.verification ?? null,
    decision: extras?.decision ?? null,
    execution: extras?.execution ?? null,
    timeline: extras?.timeline ?? [],
  };
}

export interface SuggestionGroup {
  label: string;
  icon: ComponentType<Omit<SVGProps<SVGSVGElement>, 'children'>>;
  questions: string[];
}

/** Starter questions by what the role can actually read: a warehouse manager
 * has no borrow analytics (analytics.borrow.read), so loans/fines questions
 * would only come back as "không có quyền". Grouped by the management need. */
export function suggestionGroupsFor(user: AuthUser | null): SuggestionGroup[] {
  const readsBorrow = Boolean(user?.is_superuser) || hasAnyPermission(user, ['analytics.borrow.read']);
  const restock: SuggestionGroup = {
    label: 'Tồn kho và nhập hàng',
    icon: BookPileIcon,
    questions: ['Sách nào được mượn nhiều nhưng tồn kho thấp và cần nhập thêm?', 'Với ngân sách 20 triệu nên nhập sách gì?'],
  };
  if (readsBorrow) {
    return [
      { label: 'Ưu tiên hôm nay', icon: BookTaskIcon, questions: ['Nên ưu tiên xử lý việc gì hôm nay?'] },
      restock,
      { label: 'Nhu cầu mượn sách', icon: BookStackIcon, questions: ['Lượt mượn tháng này so với tháng trước thế nào?'] },
    ];
  }
  return [
    { label: 'Rủi ro vận hành', icon: BookAlertIcon, questions: ['Kho nào đang rủi ro thiếu sách nhất?'] },
    restock,
    { label: 'Tồn kho chậm luân chuyển', icon: BookDueIcon, questions: ['Sách nào tồn kho lâu không ai mượn?'] },
  ];
}
