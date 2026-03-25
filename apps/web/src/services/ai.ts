import { aiAPI } from './http-clients';

export interface AIAnalysisRequest {
  imageUrl?: string;
  imageFile?: File;
  type: 'OCR' | 'METADATA_EXTRACTION' | 'BARCODE_DETECTION';
}

export interface AIAnalysisResponse {
  data: any;
  confidence: number;
  type: string;
}

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

export interface RecognizeBookResponse {
  title: string | null;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  raw?: string;
}

export interface SummaryViRequest {
  title: string;
  author?: string;
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
    aiSummary: string;
  };
  confidence: {
    overall: number;
    googleBooks: number;
    openLibrary: number;
    worldCat?: number;
  };
  summaryVi: string | null;
  keywords: string[];
  manualEntryRequired: boolean;
  reason?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  reply: string;
  ai_provider: string;
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

export const aiService = {
  analyzeImage: async (data: AIAnalysisRequest): Promise<AIAnalysisResponse> => {
    const formData = new FormData();
    if (data.imageFile) {
      formData.append('file', data.imageFile);
    }
    if (data.imageUrl) {
      formData.append('imageUrl', data.imageUrl);
    }
    formData.append('type', data.type);

    const response = await aiAPI.post('/analyze', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  getRecommendations: async (): Promise<RecommendationResponse> => {
    const response = await aiAPI.get('/recommendations');
    return response.data;
  },

  extractMetadata: async (imageFile: File) => {
    const formData = new FormData();
    formData.append('file', imageFile);

    const response = await aiAPI.post('/extract-metadata', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  recognizeBook: async (imageFile: File | Blob): Promise<RecognizeBookResponse> => {
    const formData = new FormData();
    formData.append('file', imageFile, 'cover.jpg');

    const response = await aiAPI.post('/recognize-book', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
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

  generateSummaryVi: async (payload: SummaryViRequest): Promise<SummaryViResponse> => {
    const response = await aiAPI.post('/generate-summary-vi', payload);
    return response.data;
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
};
