# AI Description Generation - Quick Reference Card

## 🎯 At a Glance

**Feature:** Users click "✨ Tạo mô tả" button to generate Vietnamese book descriptions using AI/LLM

---

## 📍 Frontend Components - Button Locations

### 1. **New Book Modal** (Tạo sách mới)
- **File:** `apps/web/src/pages/InventoryPage.jsx`
- **Button Lines:** 626-630
- **Handler:** `handleAiGenerate()` at lines 435-451
- **When visible:** When creating new book in inventory

### 2. **Edit Book Modal** (Cập nhật chi tiết sách)
- **File:** `apps/web/src/pages/InventoryPage.jsx`
- **Button Lines:** 328-334
- **Handler:** `handleAiGenerate()` at lines 130-146
- **When visible:** When editing existing book in inventory

### 3. **Book Detail Page** (Chi tiết sách)
- **File:** `apps/web/src/components/pages/book-detail.tsx`
- **Button Lines:** 540-547
- **Handler:** `handleGenerateQuickDescription()` at lines 112-143
- **When visible:** ViewingBook details, right side modal
- **Unique:** Directly updates database and book display after generation

---

## 🔧 Frontend Functions

| Function | File | Lines | Purpose |
|----------|------|-------|---------|
| `handleAiGenerate()` | InventoryPage.jsx | 435-451, 130-146 | Call AI service with title & author |
| `handleGenerateQuickDescription()` | book-detail.tsx | 112-143 | Generate + update + reload book |
| `generateBookSummary()` | api.ts | 60-62 | Expose to JSX pages |
| `aiService.generateBookSummary()` | ai.ts | 86-92 | HTTP POST to `/generate-book-summary` |

---

## 🌐 API Endpoints

### Frontend Call Chain
```
Component → generateBookSummary(title, author)
          → aiService.generateBookSummary(title, author)
          → aiAPI.post('/generate-book-summary', {title, author})
          → http://localhost:3000/ai/generate-book-summary
```

### Backend Endpoints
| Endpoint | File | Method | Function | Purpose |
|----------|------|--------|----------|---------|
| `/generate-book-summary` | main.py:311-312 | POST | `generate_book_summary()` | **Primary** endpoint |
| `/api/ai/generate-book-summary` | main.py:305-310 | POST | `generate_book_summary_legacy()` | Legacy/alternate |

---

## 🤖 Backend AI Service

### Main Function: `_generate_book_summary()` 
**File:** `services/ai-service/main.py`  
**Lines:** 314-359

### Step-by-Step Process:
1. **Validate** (lines 318-323)
   - Check `title.strip()` not empty
   - Check `author.strip()` not empty
   
2. **Search** (lines 325-326)
   - Call `_search_book_context(title, author)`
   - Optional: Find web info via DuckDuckGo
   
3. **Prompt** (lines 328-352)
   - Build detailed prompt with title, author, web context
   - Format includes: structure, style, tone guidelines
   
4. **Generate** (lines 354-358)
   - Create `ollama.Client()`
   - Call `client.generate()` with:
     - **Model:** `SUMMARY_MODEL` env var (default: `llava`)
     - **Temperature:** `0.7`
     - **Max tokens:** `400`
   
5. **Format** (line 357)
   - Call `_format_summary_description(response)`
   - Returns formatted multi-line description

---

## 🔌 Supporting Functions

### `_search_book_context(title, author)`
**Lines:** 267-281
- Uses **DuckDuckGo** for web search
- Query: `"{title} {author} sách tóm tắt nội dung"`
- Returns: Up to 800 chars of search snippets
- **Graceful fallback:** Returns empty string if search fails

### `_format_summary_description(text)`
**Lines:** 283-302
- Splits into sentences
- Formats as:
  ```
  📘 Tổng quan
  {First sentence}
  
  ✨ Điểm nổi bật
  • {Highlight 1}
  • {Highlight 2}
  
  🎯 Gợi ý bạn đọc
  {Target audience}
  ```

---

## 📊 Data Flow

```
FRONTEND                          BACKEND
─────────────────────────────────────────────

Button Click
    ↓
handleAiGenerate()
    ↓ {title, author}
generateBookSummary(title, author)
    ↓
aiService.generateBookSummary()
    ↓ HTTP POST
POST /generate-book-summary
    ↓ aiAPI.baseURL = http://localhost:3000/ai
                      ↓ (Gateway routes)
                      POST /ai/generate-book-summary
                             ↓
                      generate_book_summary()
                             ↓
                      _generate_book_summary()
                             ↓
                      1. Validate inputs
                             ↓
                      2. _search_book_context()
                             ↓ (Optional DuckDuckGo)
                      3. Build prompt
                             ↓
                      4. Ollama (llava model)
                             ↓
                      5. _format_summary_description()
                             ↓
                      Response: {description, web_context_used}
    ↓ HTTP 200
Response received
    ↓
Result displayed in textarea
    ↓
(BookDetail only) bookService.update()
    ↓
Success toast notification
```

---

## 📝 Input/Output

### Request
```json
{
  "title": "Đắc Nhân Tâm",
  "author": "Dale Carnegie"
}
```

### Response (Success)
```json
{
  "description": "📘 Tổng quan\nĐắc Nhân Tâm là một cuốn sách kinh điển...\n\n✨ Điểm nổi bật\n• Cung cấp các nguyên tắc thực tế...\n• Kết hợp các câu chuyện thực tế...\n\n🎯 Gợi ý bạn đọc\nPhù hợp với bạn đọc muốn cải thiện...",
  "web_context_used": true
}
```

### Error Responses
| Status | Code | Problem |
|--------|------|---------|
| 400 | Missing `title` | `"Thiếu tên sách (title)."` |
| 400 | Missing `author` | `"Thiếu tên tác giả (author)."` |
| 500 | LLM error | `"Internal server error"` |
| 502 | Ollama down | `"Ollama lỗi: {error}"` |

---

## ⚙️ Environment Variables

### Frontend (`.env` or `.env.local`)
```
VITE_AI_BASE_URL=http://localhost:3000/ai
# Or defaults to: {VITE_GATEWAY_BASE_URL}/ai
# Which defaults to: http://localhost:3000/ai
```

### Backend (`.env`)
```
OLLAMA_HOST=http://ollama:11434
OLLAMA_MODEL=llava
SUMMARY_MODEL=llama3  # Optional, overrides OLLAMA_MODEL for summaries
```

---

## 🔍 Validation & Error Handling

### Frontend Validation
```javascript
if (!title) {
  setAiError('Vui lòng nhập Tên sách trước khi tạo mô tả AI.');
  return;
}
```

### Frontend Error Display
- Red error text below button
- Disabled button during loading
- Toast notifications (success/error)
- Loading spinner animation

### Backend Validation
```python
if not req.title.strip():
    raise HTTPException(status_code=400, detail="Thiếu tên sách (title).")
if not req.author.strip():
    raise HTTPException(status_code=400, detail="Thiếu tên tác giả (author).")
```

### Try-Catch Flow
```javascript
try {
  setAiLoading(true);
  const result = await generateBookSummary(title, author);
  if (!result.description) {
    setAiError('AI không trả về mô tả');
    return;
  }
  setField('description', result.description);
  toast.success('Đã tạo mô tả'); // Book detail only
} catch (err) {
  setAiError(err.message || 'AI service không phản hồi.');
  toast.error('Không thể tạo mô tả'); // Book detail only
} finally {
  setAiLoading(false);
}
```

---

## 🎨 UI States

### Button States
- **Idle:** `<Sparkles/>` icon + "✨ Tạo mô tả" text
- **Loading:** `<Loader2 animate-spin/>` icon + "Đang tạo..." text
- **Disabled:** `opacity-50` while loading or submitting
- **Error:** Red error message displays below button

---

## 📂 File Quick Links

### Frontend
- **Pages:** `apps/web/src/pages/InventoryPage.jsx`
- **Components:** `apps/web/src/components/pages/book-detail.tsx`
- **Services:** `apps/web/src/services/{api.ts, ai.ts, http-clients.ts}`

### Backend
- **AI Service:** `services/ai-service/main.py`

### Config/Docs
- **Analysis:** `AI_DESCRIPTION_FLOW_ANALYSIS.md` (detailed)
- **This File:** `AI_DESCRIPTION_QUICK_REFERENCE.md` (quick ref)

---

## 🚀 Testing the Feature

### Prerequisites
- Ollama running: `docker compose up ollama`
- AI Service running: `docker compose up ai-service`
- API Gateway running: `docker compose up api-gateway`
- Frontend running: `npm run dev` in `apps/web`

### Test Steps
1. Go to **Inventory** page
2. Click **"Tạo Sách Mới"** (New Book)
3. Fill in **Title** and **Author**
4. Click **"✨ AI Tạo mô tả"** button
5. Wait for loading (1-3 seconds)
6. See generated description in textarea

### Alternative: Book Detail Page
1. Go to **Catalog**
2. Click on any book
3. Click **"Tạo bang AI"** button in description section
4. Description is generated and auto-saved
5. See success toast: "Da tao mo ta nhanh bang AI"

---

## 🔗 Related APIs

- **Ollama:** `http://localhost:11434/api/generate`
- **AI Service Health:** `GET http://localhost:8000/health`
- **DuckDuckGo Search:** No auth required, rate-limited

---
