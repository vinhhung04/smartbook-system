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

export type IsbnSourceName = 'googleBooks' | 'openLibrary' | 'worldCat' | 'fahasa' | 'tiki' | 'vinabook';

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
}

export interface EnrichBookAfterIsbnResponse {
  success: boolean;
  lookup: LookupBookByIsbnResponse;
  aiSuggestions: PostIsbnAiSuggestions;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AssistantResponse {
  answer: string;
  tools_used: AssistantToolCall[];
  data: Record<string, unknown>;
  conversation_id?: string | null;
  grounding_warning?: string | null;
  pending_action?: PendingAction | null;
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

  getRecommendationsAI: async (
    borrowHistory: { title: string; author?: string; category?: string }[],
    catalogBooks: { id: string; title: string; author?: string; category?: string; quantity: number }[],
  ): Promise<{ recommendations: AIRecommendation[]; ai_provider: string }> => {
    const response = await aiAPI.post('/recommendations', {
      borrow_history: borrowHistory,
      catalog_books: catalogBooks,
    });
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
