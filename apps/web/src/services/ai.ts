import { aiAPI, getToken } from './http-clients';

export interface RecommendationResponse {
  recommendations: Array<{
    title: string;
    description: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    category: string;
  }>;
}

export interface BookSummaryResponse {
  description: string;
  web_context_used: boolean;
}

export interface SummaryViRequest {
  title: string;
  author?: string;
  publisher?: string;
  description?: string;
  categories?: string[];
}

export interface SummaryViResponse {
  summaryVi: string;
  keywords: string[];
  ai_provider: string;
}

export interface LookupBookByIsbnRequest {
  isbn: string;
  generateVietnameseSummary?: boolean;
}

export type IsbnSourceName = 'googleBooks' | 'openLibrary' | 'worldCat' | 'fahasa' | 'tiki' | 'vinabook' | 'webSearch';

export interface IsbnFieldEvidence {
  selectedValue: string | string[] | number | null;
  selectedSource: IsbnSourceName | null;
  confirmations: Array<{ source: IsbnSourceName; value: unknown; sourceUrl?: string }>;
}

export interface IsbnLookupSource {
  name: IsbnSourceName;
  enabled: boolean;
  status: 'SUCCESS' | 'NOT_FOUND' | 'TIMEOUT' | 'ERROR' | 'DISABLED';
  durationMs: number;
  sourceUrl?: string;
}

export interface IsbnConflict {
  field: string;
  selectedValue: unknown;
  alternatives: Array<{ source: IsbnSourceName; value: unknown }>;
}

export interface LookupBookByIsbnResponse {
  success: boolean;
  found: boolean;
  isbn: string;
  isbn13?: string | null;
  isbn10?: string | null;
  title: string | null;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedDate: string | null;
  description: string | null;
  categories: string[];
  language: string | null;
  pageCount: number | null;
  thumbnail: string | null;
  source: {
    googleBooks: boolean;
    openLibrary: boolean;
    worldCat?: boolean;
    fahasa?: boolean;
    tiki?: boolean;
    vinabook?: boolean;
    webSearch?: boolean;
    aiSummary: string;
  };
  confidence: {
    overall: number;
    googleBooks: number;
    openLibrary: number;
    worldCat?: number;
    fahasa?: number;
    tiki?: number;
    vinabook?: number;
    webSearch?: number;
  };
  summaryVi: string | null;
  keywords: string[];
  manualEntryRequired: boolean;
  reason?: string;
  fieldEvidence?: Record<string, IsbnFieldEvidence>;
  fieldConfidence?: Record<string, number>;
  sources?: IsbnLookupSource[];
  conflicts?: IsbnConflict[];
  metadataQualityScore?: number;
  processingTimeMs?: number;
}

export interface PostIsbnAiSuggestions {
  description: string | null;
  summaryVi: string | null;
  keywords: string[];
  categories: string[];
  qualityWarnings: string[];
  provider: string;
  confidence: number;
}

export interface EnrichBookAfterIsbnRequest {
  isbn: string;
  existingCategories?: string[];
  verifiedMetadata?: Record<string, unknown>;
}

export interface EnrichBookAfterIsbnResponse {
  success: boolean;
  lookup: LookupBookByIsbnResponse;
  aiSuggestions: PostIsbnAiSuggestions;
  authorNormalization?: unknown[];
  publisherNormalization?: unknown;
  categoryNormalization?: unknown[];
  authorityMatches?: Record<string, unknown>;
  qualityWarnings?: string[];
  explanation?: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiEvidenceItem {
  label: string;
  source_type: string;
  tool_name: string;
  metric: string;
  value: unknown;
  unit?: string;
  description?: string;
}

export interface AssistantResponse {
  answer: string;
  tools_used: AssistantToolCall[];
  data: Record<string, unknown>;
  conversation_id?: string | null;
  grounding_warning?: string | null;
  pending_action?: PendingAction | null;
  evidence?: AiEvidenceItem[];
  retrieval_warnings?: string[];
}

export interface PendingAction {
  id: string;
  type: string;
  status: string;
  summary: string;
  payload: any;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | string;
  requires_confirmation: boolean;
  allowed_roles: string[];
  allowed_permissions?: string[];
  sources?: Array<{ name: string; endpoint?: string; status?: string }>;
  intent?: string;
  warnings?: string[];
  expires_at?: string;
  requires_review?: boolean;
  created_at?: string;
  created_by_roles?: string[];
}

export interface ConfirmActionResponse {
  success: boolean;
  action_id: string;
  status: string;
  message: string;
  result?: any;
}

export interface AiActionListItem {
  id: string;
  type: string;
  status: string;
  summary: string;
  risk: string;
  requires_review: boolean;
  created_by_user_id: string | null;
  created_at: string;
  expires_at: string;
  conversation_id: string | null;
}

export interface AiActionDetail extends AiActionListItem {
  payload: any;
  requires_confirmation: boolean;
  allowed_roles: string[];
  allowed_permissions: string[];
  sources: Array<{ name: string; endpoint?: string; status?: string }>;
  intent?: string | null;
  created_from_message?: string | null;
  warnings: string[];
  created_by_roles: string[];
  confirmed_by_user_id: string | null;
  cancelled_by_user_id: string | null;
  result: any;
  error_message: string | null;
  updated_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
  cancelled_at: string | null;
  failed_at: string | null;
  expired_at: string | null;
}

export interface AiAuditLogEntry {
  event_type: string;
  actor_user_id: string | null;
  actor_roles: string[];
  old_status: string | null;
  new_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AiConversationSummary {
  conversation_id: string;
  title: string | null;
  status: string;
  last_intent: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

export interface AiMessageRecord {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls: AssistantToolCall[] | null;
  tool_results: Record<string, unknown> | null;
  data: Record<string, unknown> | null;
  pending_action_id: string | null;
  grounding_warning: string | null;
  sources: unknown[] | null;
  created_at: string;
}

export interface ChatResponse {
  reply: string;
  ai_provider: string;
  intent?: string;
  context_sources?: Array<{ name: string; endpoint?: string; status?: string }>;
  retrieval_warnings?: string[];
  pending_action?: PendingAction | null;
}

export interface SystemContext {
  summary?: {
    totalBooks: number;
    totalUnits: number;
    lowStock: number;
    outOfStock: number;
    activeLoans: number;
    overdueLoans: number;
    totalFines: number;
  };
  books?: { title: string; author?: string; quantity: number }[];
  recentLoans?: {
    loan_number: string;
    customer_name: string;
    status: string;
    due_date: string;
  }[];
  recentFines?: {
    customer_name: string;
    fine_type: string;
    amount: number;
    status: string;
  }[];
  recentMovements?: {
    movement_type: string;
    book_title: string;
    quantity: number;
    warehouse_name: string;
  }[];
}

export interface AIRecommendation {
  book_id: string;
  title: string;
  author: string;
  category: string;
  reason: string;
  score: number;
  /** Per-component contribution to `score`, computed server-side (never by the LLM). */
  breakdown?: {
    semantic: number;
    affinity: number;
    quality: number;
    availability: number;
  };
}

export interface AIRecommendationsResult {
  recommendations: AIRecommendation[];
  ai_provider: string;
  /**
   * False when the caller has no reading history to personalise from (no customer
   * profile, or no loans/wishlist/ratings yet). The UI must say so rather than
   * presenting a library-wide list as if it were personal.
   */
  personalized: boolean;
  basis: {
    loans_used: number;
    wishlist_used: number;
    ratings_used: number;
    loans_status: number | null;
  };
  semantic_used: boolean;
}

export interface ReadingStatsResponse {
  total_books: number;
  avg_borrow_days: number;
  streak_months: number;
  monthly_data: { month: string; count: number }[];
  top_categories: { name: string; count: number }[];
  top_authors: { name: string; count: number }[];
  badges: { id: string; name: string; icon: string; description: string }[];
}

export type EnrichMode =
  | 'keywords'
  | 'short_summary'
  | 'normalize_description'
  | 'suggest_categories'
  | 'quality_check';

export interface EnrichBookMetadataRequest {
  title: string;
  authors: string[];
  publisher?: string;
  description?: string;
  categories: string[];
  existingCategories?: string[];
  mode: EnrichMode;
}

export interface EnrichBookMetadataResponse {
  success: boolean;
  mode: string;
  ai_provider: string;
  keywords: string[];
  shortSummary: string | null;
  normalizedDescription: string | null;
  suggestedCategories: string[];
  qualityWarnings: string[];
  confidence: number;
}

export const aiService = {
  getRecommendations: async (): Promise<RecommendationResponse> => {
    const response = await aiAPI.get('/recommendations');
    return response.data;
  },

  generateBookSummary: async (title: string, author: string): Promise<BookSummaryResponse> => {
    const response = await aiAPI.post('/generate-book-summary', {
      title,
      author,
    });
    return response.data;
  },

  lookupBookByIsbn: async (
    payload: LookupBookByIsbnRequest,
  ): Promise<LookupBookByIsbnResponse> => {
    const response = await aiAPI.post('/lookup-book-by-isbn', {
      isbn: payload.isbn,
      generateVietnameseSummary: Boolean(payload.generateVietnameseSummary),
    });
    return response.data;
  },

  isbnIntelligence: async (
    payload: LookupBookByIsbnRequest,
  ): Promise<LookupBookByIsbnResponse> => {
    const response = await aiAPI.post('/isbn-intelligence', {
      isbn: payload.isbn,
      generateVietnameseSummary: Boolean(payload.generateVietnameseSummary),
    });
    return response.data;
  },

  enrichBookAfterIsbn: async (
    payload: EnrichBookAfterIsbnRequest,
  ): Promise<EnrichBookAfterIsbnResponse> => {
    const response = await aiAPI.post('/enrich-book-after-isbn', {
      isbn: payload.isbn,
      existingCategories: payload.existingCategories || [],
      verifiedMetadata: payload.verifiedMetadata,
    });
    return response.data;
  },

  generateSummaryVi: async (payload: SummaryViRequest): Promise<SummaryViResponse> => {
    const response = await aiAPI.post('/generate-summary-vi', payload);
    return response.data;
  },

  askAssistant: async (message: string, conversationId?: string): Promise<AssistantResponse> => {
    const response = await aiAPI.post('/assistant', {
      message,
      conversation_id: conversationId || null,
    });
    return response.data;
  },

  // Streams the assistant's answer token-by-token via SSE instead of waiting for the
  // whole 60-120s+ tool-calling loop to finish. Same fetch()-over-EventSource rationale
  // as chatStream: needs a POST body and Authorization header.
  askAssistantStream: async (
    message: string,
    conversationId: string | undefined,
    handlers: {
      onToken: (text: string) => void;
      onDone: (data: AssistantResponse) => void;
      onError: (error: unknown) => void;
    },
  ): Promise<void> => {
    try {
      const token = getToken();
      const baseURL = aiAPI.defaults.baseURL || '';
      const response = await fetch(`${baseURL}/assistant/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message,
          conversation_id: conversationId || null,
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error(`Assistant stream request failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const rawEvent of events) {
          let eventName = 'message';
          let data = '';
          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) data = line.slice(5).trim();
          }
          if (!data) continue;
          const parsed = JSON.parse(data);
          if (eventName === 'token') {
            handlers.onToken(parsed.text ?? '');
          } else if (eventName === 'done') {
            handlers.onDone(parsed as AssistantResponse);
          }
        }
      }
    } catch (error) {
      handlers.onError(error);
    }
  },

  chat: async (
    message: string,
    conversationHistory: ChatMessage[] = [],
    systemContext?: SystemContext,
  ): Promise<ChatResponse> => {
    const response = await aiAPI.post('/chat', {
      message,
      conversation_history: conversationHistory,
      system_context: systemContext || null,
    });
    return response.data;
  },

  // Streams the reply token-by-token via SSE instead of waiting for the whole
  // response. Uses fetch() rather than EventSource because the request needs
  // a POST body and an Authorization header, neither of which EventSource supports.
  chatStream: async (
    message: string,
    conversationHistory: ChatMessage[] = [],
    systemContext: SystemContext | undefined,
    handlers: {
      onToken: (text: string) => void;
      onDone: (data: ChatResponse) => void;
      onError: (error: unknown) => void;
    },
  ): Promise<void> => {
    try {
      const token = getToken();
      const baseURL = aiAPI.defaults.baseURL || '';
      const response = await fetch(`${baseURL}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message,
          conversation_history: conversationHistory,
          system_context: systemContext || null,
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error(`Chat stream request failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const rawEvent of events) {
          let eventName = 'message';
          let data = '';
          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) data = line.slice(5).trim();
          }
          if (!data) continue;
          const parsed = JSON.parse(data);
          if (eventName === 'token') {
            handlers.onToken(parsed.text ?? '');
          } else if (eventName === 'done') {
            handlers.onDone(parsed as ChatResponse);
          }
        }
      }
    } catch (error) {
      handlers.onError(error);
    }
  },

  /**
   * Personalised recommendations for the signed-in reader. Takes no history from
   * the client: the service reads the caller's own loans, wishlist and ratings
   * with the caller's token, so the browser cannot decide whose history is used.
   */
  getRecommendationsAI: async (limit = 6): Promise<AIRecommendationsResult> => {
    const response = await aiAPI.post('/recommendations', { limit });
    return response.data;
  },

  getReadingStats: async (
    loans: any[],
    reviews: any[],
  ): Promise<ReadingStatsResponse> => {
    const response = await aiAPI.post('/reading-stats', { loans, reviews });
    return response.data;
  },

  confirmAction: async (actionId: string, overridePayload?: Record<string, unknown>): Promise<ConfirmActionResponse> => {
    const body: Record<string, unknown> = { action_id: actionId, confirm: true };
    if (overridePayload && Object.keys(overridePayload).length > 0) {
      body.override_payload = overridePayload;
    }
    const response = await aiAPI.post('/actions/confirm', body);
    return response.data;
  },

  cancelAction: async (actionId: string): Promise<{ success: boolean; action_id: string; status: string }> => {
    const response = await aiAPI.post('/actions/cancel', { action_id: actionId });
    return response.data;
  },

  getPendingAction: async (actionId: string): Promise<PendingAction> => {
    const response = await aiAPI.get(`/actions/pending/${actionId}`);
    return response.data;
  },

  listActions: async (params?: {
    status?: string;
    limit?: number;
    offset?: number;
    conversationId?: string;
    mine?: boolean;
  }): Promise<{ items: AiActionListItem[]; limit: number; offset: number }> => {
    const response = await aiAPI.get('/assistant/actions', {
      params: {
        status: params?.status,
        limit: params?.limit,
        offset: params?.offset,
        conversation_id: params?.conversationId,
        mine: params?.mine,
      },
    });
    return response.data;
  },

  getActionDetail: async (
    actionId: string,
  ): Promise<{ action: AiActionDetail; audit_logs: AiAuditLogEntry[] }> => {
    const response = await aiAPI.get(`/assistant/actions/${actionId}`);
    return response.data;
  },

  listConversations: async (): Promise<{ items: AiConversationSummary[] }> => {
    const response = await aiAPI.get('/assistant/conversations');
    return response.data;
  },

  getConversationDetail: async (
    conversationId: string,
  ): Promise<{ conversation: AiConversationSummary; messages: AiMessageRecord[] }> => {
    const response = await aiAPI.get(`/assistant/conversations/${conversationId}`);
    return response.data;
  },

  renameConversation: async (conversationId: string, title: string): Promise<AiConversationSummary> => {
    const response = await aiAPI.patch(`/assistant/conversations/${conversationId}`, { title });
    return response.data;
  },

  archiveConversation: async (
    conversationId: string,
  ): Promise<{ success: boolean; conversation_id: string; status: string }> => {
    const response = await aiAPI.delete(`/assistant/conversations/${conversationId}`);
    return response.data;
  },

  enrichBookMetadata: async (
    payload: EnrichBookMetadataRequest,
  ): Promise<EnrichBookMetadataResponse> => {
    const response = await aiAPI.post('/enrich-book-metadata', payload);
    return response.data;
  },

  scanReceipt: async (
    file: File,
  ): Promise<{
    success: boolean;
    supplier_name?: string;
    invoice_number?: string;
    invoice_date?: string;
    line_items: Array<{
      title: string;
      isbn: string | null;
      quantity: number;
      unit_price: number;
    }>;
    total_items: number;
    error?: string;
  }> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await aiAPI.post('/scan-receipt', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};
