# AI Book Description Generation Flow - Complete Analysis

## Overview
"Tạo Mô Tả Bằng AI" (Generate Description by AI) feature allows users to automatically generate Vietnamese book descriptions using AI/LLM.

---

## 1. FRONTEND COMPONENTS

### A. UI Buttons - "✨ Tạo mô tả" / "Tao bang AI"

#### Location 1: Inventory Page - New Book Modal
**File:** [apps/web/src/pages/InventoryPage.jsx](apps/web/src/pages/InventoryPage.jsx#L626)
- **Component:** `NewBookModal()`
- **Button Location:** Lines 626-630
- **Button Label:** "✨ AI Tạo mô tả" or "Đang tạo..."
- **Handler Function:** `handleAiGenerate()` (Lines 435-451)
- **Button State:** Shows loading spinner when `aiLoading` is true

```jsx
<button
  type="button"
  onClick={handleAiGenerate}
  disabled={aiLoading || submitting}
  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-50 border border-violet-200 text-violet-700 text-xs font-semibold hover:bg-violet-100 disabled:opacity-50 transition-colors"
>
  {aiLoading
    ? <Loader2 size={12} className="animate-spin" />
    : <Sparkles size={12} />}
  {aiLoading ? 'Đang tạo...' : '✨ AI Tạo mô tả'}
</button>
```

#### Location 2: Inventory Page - Edit Book Modal
**File:** [apps/web/src/pages/InventoryPage.jsx](apps/web/src/pages/InventoryPage.jsx#L328)
- **Component:** `EditBookModal()`
- **Button Location:** Lines 328-334
- **Button Label:** "✨ AI Tạo mô tả" or "Đang tạo..."
- **Handler Function:** `handleAiGenerate()` (Lines 130-146)
- **Same implementation as New Book Modal**

#### Location 3: Book Detail Page
**File:** [apps/web/src/components/pages/book-detail.tsx](apps/web/src/components/pages/book-detail.tsx#L540)
- **Component:** `BookDetailPage()`
- **Button Location:** Lines 540-547
- **Button Label:** "Tao bang AI" or "Dang tao..."
- **Handler Function:** `handleGenerateQuickDescription()` (Lines 112-143)
- **Special Feature:** Updates the book immediately after AI generates description

```tsx
<button
  onClick={() => void handleGenerateQuickDescription()}
  disabled={isGeneratingDescription}
  className="inline-flex items-center gap-1.5 rounded-[8px] border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-100 transition-colors disabled:opacity-60"
>
  <Sparkles className="h-3.5 w-3.5" />
  {isGeneratingDescription ? "Dang tao..." : "Tao bang AI"}
</button>
```

---

## 2. FRONTEND SERVICE LAYER

### A. API Service - generateBookSummary()
**File:** [apps/web/src/services/api.ts](apps/web/src/services/api.ts#L60-L62)
- **Function:** `generateBookSummary(title: string, author: string)`
- **Implementation:** Delegates to `aiService.generateBookSummary()`

```ts
export async function generateBookSummary(title: string, author: string) {
  return aiService.generateBookSummary(title, author);
}
```

### B. AI Service
**File:** [apps/web/src/services/ai.ts](apps/web/src/services/ai.ts#L86-L92)

**Interfaces:**
```ts
export interface BookSummaryResponse {
  description: string;
  web_context_used: boolean;
}
```

**Method:** `aiService.generateBookSummary()`
```ts
generateBookSummary: async (title: string, author: string): Promise<BookSummaryResponse> => {
  const response = await aiAPI.post('/generate-book-summary', {
    title,
    author,
  });
  return response.data;
}
```

### C. HTTP Client Configuration
**File:** [apps/web/src/services/http-clients.ts](apps/web/src/services/http-clients.ts#L25)
- **Base URL:** `${gatewayBaseURL}/ai` (defaults to `http://localhost:3000/ai`)
- **Environment Variable:** `VITE_AI_BASE_URL`
- **API Instance:** `aiAPI`

```ts
const aiBaseURL = import.meta.env.VITE_AI_BASE_URL || `${gatewayBaseURL}/ai`;

export const aiAPI: AxiosInstance = axios.create({
  baseURL: aiBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});
```

---

## 3. BACKEND API ENDPOINTS

### AI Service Endpoints
**File:** [services/ai-service/main.py](services/ai-service/main.py)

#### Endpoint 1: Primary (Current)
- **Method:** `POST`
- **Path:** `/generate-book-summary`
- **Function:** `generate_book_summary(req: BookSummaryRequest)`
- **Line:** 311-312

#### Endpoint 2: Legacy (Alternative)
- **Method:** `POST`
- **Path:** `/api/ai/generate-book-summary`
- **Function:** `generate_book_summary_legacy(req: BookSummaryRequest)`
- **Line:** 305-310
- **Note:** For backward compatibility

#### Shared Implementation
- **Function:** `_generate_book_summary(req: BookSummaryRequest)` (Lines 314-359)
- **Lines:** 305-312, 314-359

```python
@app.post("/generate-book-summary")
async def generate_book_summary(req: BookSummaryRequest):
    return await _generate_book_summary(req)

@app.post("/api/ai/generate-book-summary")
async def generate_book_summary_legacy(req: BookSummaryRequest):
    """Tạo mô tả sách bằng Tiếng Việt sử dụng Ollama."""
    return await _generate_book_summary(req)
```

### Request/Response Model
```python
class BookSummaryRequest(BaseModel):
    title: str
    author: str
```

**Response:**
```json
{
  "description": "📘 Tổng quan\n...\n✨ Điểm nổi bật\n...\n🎯 Gợi ý bạn đọc\n...",
  "web_context_used": true/false
}
```

---

## 4. BACKEND AI SERVICE IMPLEMENTATION

### A. Main Function: `_generate_book_summary()`
**File:** [services/ai-service/main.py](services/ai-service/main.py#L314-L359)

**Input Validation:**
```python
if not req.title.strip():
    raise HTTPException(status_code=400, detail="Thiếu tên sách (title).")
if not req.author.strip():
    raise HTTPException(status_code=400, detail="Thiếu tên tác giả (author).")
```

**Process Flow:**
1. Validates input (title and author required)
2. Searches web for book context (optional)
3. Constructs prompt with book info and web context
4. Calls Ollama LLM model for generation
5. Formats the response with `_format_summary_description()`
6. Returns description and `web_context_used` flag

**Configuration:**
- **Ollama Host:** `OLLAMA_HOST` env var (default: `http://ollama:11434`)
- **Model:** `SUMMARY_MODEL` env var (default: `llava`)
- **Temperature:** 0.7
- **Max Tokens:** 400

### B. Web Search Function: `_search_book_context()`
**File:** [services/ai-service/main.py](services/ai-service/main.py#L267-L281)

**Library:** DuckDuckGo (`from ddgs import DDGS`)
**Query Format:** `"{title} {author} sách tóm tắt nội dung"`
**Region:** Vietnamese (`vn-vi`)
**Max Results:** 3
**Context Limit:** 800 characters

```python
def _search_book_context(title: str, author: str) -> str:
    """Tìm kiếm thông tin sách trên web qua DuckDuckGo."""
    try:
        from ddgs import DDGS
        query = f"{title} {author} sách tóm tắt nội dung"
        with DDGS() as ddgs:
            results = list(ddgs.text(query, region="vn-vi", max_results=3))
        # ... processing
        return " ".join(snippets)[:800]
    except Exception as exc:
        logger.warning("DuckDuckGo search thất bại, sẽ sử dụng kiến thức nội tại: %s", exc)
        return ""
```

### C. Response Formatting: `_format_summary_description()`
**File:** [services/ai-service/main.py](services/ai-service/main.py#L283-L302)

**Format Structure:**
```
📘 Tổng quan
[First sentence - Overview]

✨ Điểm nổi bật
• [Highlight 1]
• [Highlight 2]

🎯 Gợi ý bạn đọc
[Target audience recommendation]
```

**Features:**
- Preserves existing multi-line format with decorative characters
- Splits text into sentences
- Extracts overview, highlights, and audience sections
- Adds emoji decorators (📘, ✨, 🎯, •)
- Ensures readability with proper line breaks

### D. LLM Prompts Used

**Book Summary Prompt** (Lines 25-40):
```python
PROMPT = (
    "Bạn là chuyên gia biên mục và giới thiệu sách cho thư viện. "
    "Dựa trên 2 thông tin đầu vào gồm Tên sách và Nhà xuất bản, "
    "hãy viết một đoạn mô tả ngắn về nội dung chính, chủ đề hoặc giá trị nổi bật..."
)
```

**Detailed Summary Prompt** (Lines 335-350):
```python
prompt = (
    f"Bạn là một chuyên gia phê bình sách. "
    f"Dựa trên tên sách '{req.title.strip()}' của tác giả '{req.author.strip()}', "
    f"hãy viết một đoạn tóm tắt nội dung ngắn gọn, hấp dẫn và chuyên nghiệp "
    f"(khoảng 150-200 từ) để đưa vào hệ thống thư viện. "
    f"Bắt buộc trình bày theo nhiều dòng với bố cục: "
    f"'📘 Tổng quan' (1 đoạn ngắn), '✨ Điểm nổi bật' (2 gạch đầu dòng), '🎯 Gợi ý bạn đọc' "
    f"{context_block}"  # Optional web search results
)
```

---

## 5. COMPLETE USER FLOW

### Flow Diagram
```
┌─────────────────────────────────────┐
│ Frontend UI                         │
│ - InventoryPage (New/Edit Modal)   │
│ - BookDetailPage                   │
│ Button: "✨ Tạo mô tả"             │
└──────────────┬──────────────────────┘
               │ Click
               ▼
┌─────────────────────────────────────┐
│ handleAiGenerate()                  │
│ - Extract title & author from form  │
│ - Show loading state                │
│ - Call: generateBookSummary(title,  │
│   author)                           │
└──────────────┬──────────────────────┘
               │ Call
               ▼
┌─────────────────────────────────────┐
│ apps/web/src/services/api.ts        │
│ generateBookSummary()               │
└──────────────┬──────────────────────┘
               │ Call
               ▼
┌─────────────────────────────────────┐
│ apps/web/src/services/ai.ts         │
│ aiService.generateBookSummary()     │
│ POST /generate-book-summary         │
│ {title, author}                     │
└──────────────┬──────────────────────┘
               │ HTTP POST
               │ aiAPI.baseURL=http://localhost:3000/ai
               ▼
┌─────────────────────────────────────┐
│ API Gateway                         │
│ Forwards to AI Service              │
│ Route: /ai/generate-book-summary   │
└──────────────┬──────────────────────┘
               │ Forward
               ▼
┌─────────────────────────────────────┐
│ services/ai-service/main.py         │
│ @app.post("/generate-book-summary") │
│ Function: generate_book_summary()   │
└──────────────┬──────────────────────┘
               │ Process
               ▼
┌─────────────────────────────────────┐
│ _generate_book_summary(req)         │
│ 1. Validate title & author          │
│ 2. Optional: Web search via         │
│    _search_book_context()           │
│ 3. Build LLM prompt                 │
│ 4. Call Ollama (llava model)        │
│ 5. Parse LLM response               │
└──────────────┬──────────────────────┘
               │ Call
               ▼
┌─────────────────────────────────────┐
│ Ollama Service                      │
│ Model: llava (or SUMMARY_MODEL)     │
│ Temperature: 0.7                    │
│ Max tokens: 400                     │
│ Generate Vietnamese description     │
└──────────────┬──────────────────────┘
               │ Return response
               ▼
┌─────────────────────────────────────┐
│ _format_summary_description()       │
│ Format response with:               │
│ - 📘 Tổng quan (Overview)          │
│ - ✨ Điểm nổi bật (Highlights)     │
│ - 🎯 Gợi ý bạn đọc (Audience)      │
└──────────────┬──────────────────────┘
               │ Return formatted
               ▼
┌─────────────────────────────────────┐
│ Response: {                         │
│   description: "...",               │
│   web_context_used: true/false      │
│ }                                   │
└──────────────┬──────────────────────┘
               │ HTTP Response 200
               ▼
┌─────────────────────────────────────┐
│ Frontend (api.ts)                   │
│ Receive response                    │
│ Extract: result.description         │
└──────────────┬──────────────────────┘
               │ Success
               ▼
┌─────────────────────────────────────┐
│ Frontend Component                  │
│ 1. setField('description',          │
│    result.description)              │
│ 2. Show success toast                │
│ 3. Hide loading state               │
│ 4. Update textarea with generated   │
│    description                      │
└─────────────────────────────────────┘
```

---

## 6. FILE LOCATIONS SUMMARY

### Frontend Files
| File | Purpose |
|------|---------|
| [apps/web/src/pages/InventoryPage.jsx](apps/web/src/pages/InventoryPage.jsx#L130-L151) | New & Edit Book AI handlers |
| [apps/web/src/components/pages/book-detail.tsx](apps/web/src/components/pages/book-detail.tsx#L112-L143) | Book detail AI handler |
| [apps/web/src/services/api.ts](apps/web/src/services/api.ts#L60-L62) | API gateway function |
| [apps/web/src/services/ai.ts](apps/web/src/services/ai.ts#L86-L92) | AI service with generateBookSummary() |
| [apps/web/src/services/http-clients.ts](apps/web/src/services/http-clients.ts#L25-L29) | HTTP client config |

### Backend Files
| File | Purpose |
|------|---------|
| [services/ai-service/main.py](services/ai-service/main.py) | Main AI service implementation |
| [services/ai-service/main.py](services/ai-service/main.py#L258-L281) | `_search_book_context()` - Web search |
| [services/ai-service/main.py](services/ai-service/main.py#L283-L302) | `_format_summary_description()` - Format response |
| [services/ai-service/main.py](services/ai-service/main.py#L305-L359) | `_generate_book_summary()` - Main logic |

---

## 7. ERROR HANDLING & VALIDATION

### Frontend Validation (InventoryPage.jsx)
```javascript
async function handleAiGenerate() {
  const title = form.title.trim();
  const author = form.author_name.trim();
  if (!title) {
    setAiError('Vui lòng nhập Tên sách trước khi tạo mô tả AI.');
    return;
  }
  // ... try/catch for API call
}
```

### Frontend Error Display
- Error message in red text below button
- Loading spinner during request
- Disabled state while loading
- Toast notifications for success/error

### Backend Validation (main.py)
```python
if not req.title.strip():
    raise HTTPException(status_code=400, detail="Thiếu tên sách (title).")
if not req.author.strip():
    raise HTTPException(status_code=400, detail="Thiếu tên tác giả (author).")
```

### Error Responses
- **400:** Missing title or author
- **500:** Internal server error (LLM call failure)
- **502:** Ollama connection error

---

## 8. ENVIRONMENT VARIABLES

### Frontend (.env)
```
VITE_AI_BASE_URL=http://localhost:3000/ai
```

### Backend (.env)
```
OLLAMA_HOST=http://ollama:11434
OLLAMA_MODEL=llava
SUMMARY_MODEL=llama3  # Optional, defaults to OLLAMA_MODEL
```

---

## 9. KEY FUNCTIONS REFERENCE

### Frontend Functions (BookDetailPage)
- **`handleGenerateQuickDescription()`** (Line 112-143): Main handler for book detail page
  - Calls `aiService.generateBookSummary()`
  - Updates book via `bookService.update()`
  - Shows success/error toast

### Frontend Functions (InventoryPage)
- **`handleAiGenerate()` in `NewBookModal`** (Line 435-451): Generates description for new book
- **`handleAiGenerate()` in `EditBookModal`** (Line 130-146): Generates description for existing book

### Backend Functions (main.py)
- **`generate_book_summary()`** (Line 311-312): POST endpoint
- **`generate_book_summary_legacy()`** (Line 305-310): Legacy POST endpoint
- **`_generate_book_summary()`** (Line 314-359): Core generation logic
  - Input validation
  - Web search via `_search_book_context()`
  - Ollama call
  - Response formatting
- **`_search_book_context()`** (Line 267-281): DuckDuckGo web search
- **`_format_summary_description()`** (Line 283-302): Format multi-line description

---

## 10. RESPONSE FORMAT EXAMPLE

**Example Generated Description:**
```
📘 Tổng quan
Đắc Nhân Tâm là một cuốn sách kinh điển về kỹ năng giao tiếp và phát triển cá nhân, 
dạy người đọc cách xây dựng các mối quan hệ có ý nghĩa và đạt được thành công.

✨ Điểm nổi bật
• Cung cấp các nguyên tắc thực tế về cách ứng xử với con người
• Kết hợp các câu chuyện thực tế từ cuộc sống và sự nghiệp

🎯 Gợi ý bạn đọc
Phù hợp với bạn đọc muốn cải thiện kỹ năng giao tiếp, phát triển bản thân 
và xây dựng mối quan hệ tốt hơn trong đời sống cá nhân và công việc.
```

---

## 11. INTEGRATION POINTS

### API Gateway Routing
- Frontend → `http://localhost:3000/ai` (Gateway)
- Gateway → AI Service internal routing

### Service Communication
- HTTP/REST via axios
- JSON request/response
- Bearer token authentication (if configured)

### Database Integration
- BookDetailPage directly updates database after AI generation
- `bookService.update(id, {description: generatedDescription})`
- Immediate UI refresh with updated description

---
