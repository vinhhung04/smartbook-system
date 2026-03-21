# AI Description Generation - Code Reference & Examples

## 1. FRONTEND FUNCTION SIGNATURES

### From InventoryPage.jsx - New Book Modal Handler

```javascript
async function handleAiGenerate() {
  const title = form.title.trim();
  const author = form.author_name.trim();
  if (!title) {
    setAiError('Vui lòng nhập Tên sách trước khi tạo mô tả AI.');
    return;
  }
  setAiLoading(true);
  setAiError('');
  try {
    const result = await generateBookSummary(title, author);
    setField('description', result.description || '');
  } catch (err) {
    setAiError(err.message || 'AI service không phản hồi.');
  } finally {
    setAiLoading(false);
  }
}
```

### From InventoryPage.jsx - Edit Book Modal Handler

```javascript
async function handleAiGenerate() {
  const title = form.title.trim() || book.title || '';
  const author = form.author_name.trim();
  if (!title) {
    setAiError('Vui lòng nhập Tên sách trước khi tạo mô tả AI.');
    return;
  }
  setAiLoading(true);
  setAiError('');
  try {
    const result = await generateBookSummary(title, author);
    setField('description', result.description || '');
  } catch (err) {
    setAiError(err.message || 'AI service không phản hồi.');
  } finally {
    setAiLoading(false);
  }
}
```

### From book-detail.tsx - Quick Description Generator

```typescript
const handleGenerateQuickDescription = async () => {
  if (!book || !id) return;
  try {
    setIsGeneratingDescription(true);
    const summary = await aiService.generateBookSummary(book.title, book.author || "");
    const generatedDescription = summary?.description?.trim();

    if (!generatedDescription) {
      toast.error("AI khong tra ve mo ta");
      return;
    }

    await bookService.update(String(id), { description: generatedDescription });
    setBook((prev) => (prev ? { ...prev, description: generatedDescription } : prev));
    setEditForm((prev) => ({ ...prev, description: generatedDescription }));
    toast.success("Da tao mo ta nhanh bang AI");
  } catch (error) {
    toast.error(getApiErrorMessage(error, "Khong the tao mo ta nhanh"));
  } finally {
    setIsGeneratingDescription(false);
  }
};
```

---

## 2. FRONTEND SERVICE LAYER

### From api.ts

```typescript
export async function generateBookSummary(title: string, author: string) {
  return aiService.generateBookSummary(title, author);
}
```

### From ai.ts

```typescript
export interface BookSummaryResponse {
  description: string;
  web_context_used: boolean;
}

export const aiService = {
  // ... other methods ...
  
  generateBookSummary: async (title: string, author: string): Promise<BookSummaryResponse> => {
    const response = await aiAPI.post('/generate-book-summary', {
      title,
      author,
    });
    return response.data;
  },
};
```

### From http-clients.ts

```typescript
import axios, { AxiosInstance } from 'axios';

const gatewayBaseURL = import.meta.env.VITE_GATEWAY_BASE_URL || 'http://localhost:3000';
const aiBaseURL = import.meta.env.VITE_AI_BASE_URL || `${gatewayBaseURL}/ai`;

export const aiAPI: AxiosInstance = axios.create({
  baseURL: aiBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});
```

---

## 3. BACKEND MAIN ENDPOINTS

### From main.py (FastAPI)

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import ollama
import os

app = FastAPI(title="SmartBook AI Service")

class BookSummaryRequest(BaseModel):
    title: str
    author: str

# Primary endpoint
@app.post("/generate-book-summary")
async def generate_book_summary(req: BookSummaryRequest):
    return await _generate_book_summary(req)

# Legacy endpoint (backward compatibility)
@app.post("/api/ai/generate-book-summary")
async def generate_book_summary_legacy(req: BookSummaryRequest):
    """Tạo mô tả sách bằng Tiếng Việt sử dụng Ollama."""
    return await _generate_book_summary(req)
```

---

## 4. CORE BACKEND IMPLEMENTATION

### Main Generation Function

```python
async def _generate_book_summary(req: BookSummaryRequest):
    # 1. INPUT VALIDATION
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Thiếu tên sách (title).")
    if not req.author.strip():
        raise HTTPException(status_code=400, detail="Thiếu tên tác giả (author).")

    # 2. OPTIONAL WEB SEARCH
    web_context = _search_book_context(req.title.strip(), req.author.strip())

    context_block = (
        f"\n\nThông tin tham khảo từ internet:\n{web_context}"
        if web_context
        else ""
    )

    # 3. BUILD PROMPT
    prompt = (
        f"Bạn là một chuyên gia phê bình sách. "
        f"Dựa trên tên sách '{req.title.strip()}' của tác giả '{req.author.strip()}', "
        f"hãy viết một đoạn tóm tắt nội dung ngắn gọn, hấp dẫn và chuyên nghiệp bằng Tiếng Việt "
        f"(khoảng 150-200 từ) để đưa vào hệ thống thư viện. "
        f"Không viết thành 1 đoạn liền. Bắt buộc trình bày theo nhiều dòng với bố cục sau: "
        f"'📘 Tổng quan' (1 đoạn ngắn), '✨ Điểm nổi bật' (2 gạch đầu dòng), '🎯 Gợi ý bạn đọc' (1-2 câu). "
        f"Có thể dùng thêm một vài ký tự trang trí như 📘 ✨ 🎯 • để nội dung sinh động, nhưng không lạm dụng. "
        f"Trả về văn bản thuần túy, không markdown code block."
        f"{context_block}"
    )

    # 4. CALL OLLAMA LLM
    summary_model = os.getenv("SUMMARY_MODEL", os.getenv("OLLAMA_MODEL", "llava"))
    
    try:
        client = ollama.Client(host=OLLAMA_HOST)
        response = client.generate(
            model=summary_model,
            prompt=prompt,
            options={"temperature": 0.7, "num_predict": 400},
        )
        
        # 5. FORMAT RESPONSE
        description = _format_summary_description(response.get("response", ""))
        
        return {
            "description": description,
            "web_context_used": bool(web_context)
        }

    except ollama.ResponseError as e:
        raise HTTPException(status_code=502, detail=f"Ollama lỗi: {e.error}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### Web Search Function

```python
def _search_book_context(title: str, author: str) -> str:
    """Tìm kiếm thông tin sách trên web qua DuckDuckGo. Trả về chuỗi rỗng nếu thất bại."""
    try:
        from ddgs import DDGS
        query = f"{title} {author} sách tóm tắt nội dung"
        with DDGS() as ddgs:
            results = list(ddgs.text(query, region="vn-vi", max_results=3))
        if not results:
            return ""
        snippets = [r.get("body", "") for r in results if r.get("body")]
        return " ".join(snippets)[:800]  # Limit to 800 characters
    except Exception as exc:
        # Graceful fallback - use LLM's built-in knowledge
        logger.warning("DuckDuckGo search thất bại, sẽ sử dụng kiến thức nội tại: %s", exc)
        return ""
```

### Response Formatting Function

```python
def _format_summary_description(text: str) -> str:
    """Đảm bảo mô tả có bố cục nhiều dòng và ký tự trang trí nhẹ."""
    cleaned = re.sub(r"\s+", " ", (text or "")).strip()
    if not cleaned:
        return ""

    # Preserve existing multi-line format with decorative characters
    if "\n" in text and any(ch in text for ch in ["📘", "✨", "🎯", "•"]):
        return text.strip()

    # Split and categorize sentences
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", cleaned) if s.strip()]
    if not sentences:
        sentences = [cleaned]

    overview = sentences[0]
    highlights = sentences[1:3]
    audience = " ".join(sentences[3:]).strip()

    # Provide defaults if not enough content
    if not highlights:
        highlights = ["Nội dung được diễn đạt súc tích, dễ tiếp cận với nhiều nhóm bạn đọc."]

    if not audience:
        audience = "Phù hợp với bạn đọc muốn khám phá chủ đề chính của cuốn sách một cách rõ ràng và thực tế."

    # Format with decorations
    highlight_lines = "\n".join(f"• {item}" for item in highlights)
    return (
        f"📘 Tổng quan\n{overview}\n\n"
        f"✨ Điểm nổi bật\n{highlight_lines}\n\n"
        f"🎯 Gợi ý bạn đọc\n{audience}"
    )
```

---

## 5. JSX BUTTON IMPLEMENTATIONS

### Inventory Page - New Book Modal Button

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

### Inventory Page - Edit Book Modal Button

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

### Book Detail Page Button

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

## 6. USAGE EXAMPLES

### Example 1: Call from Component

```jsx
import { generateBookSummary } from '@/services/api';

export function MyComponent() {
  const handleGenerate = async () => {
    try {
      const result = await generateBookSummary("Đắc Nhân Tâm", "Dale Carnegie");
      console.log(result.description);
      // Output: "📘 Tổng quan\nĐắc Nhân Tâm là một cuốn sách kinh điển...\n✨ Điểm nổi bật\n..."
      console.log(result.web_context_used); // true or false
    } catch (error) {
      console.error("Failed:", error.message);
    }
  };
  
  return <button onClick={handleGenerate}>Generate</button>;
}
```

### Example 2: Direct Service Call

```typescript
import { aiService } from '@/services/ai';

const response = await aiService.generateBookSummary("Clean Code", "Robert C. Martin");
console.log(response.description);
// Returns formatted multi-line description with emojis and structure
```

### Example 3: With Error Handling

```javascript
import { generateBookSummary } from '@/services/api';

async function generateDescription(book) {
  try {
    if (!book?.title) {
      throw new Error('Title is required');
    }
    
    setLoading(true);
    const result = await generateBookSummary(book.title, book.author || '');
    
    if (!result?.description) {
      throw new Error('Empty description received');
    }
    
    setDescription(result.description);
    return result;
  } catch (error) {
    setError(error.message || 'Unknown error');
    console.error('Generation failed:', error);
  } finally {
    setLoading(false);
  }
}
```

---

## 7. API REQUEST/RESPONSE EXAMPLES

### Request
```bash
curl -X POST http://localhost:3000/ai/generate-book-summary \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Đắc Nhân Tâm",
    "author": "Dale Carnegie"
  }'
```

### Success Response (200)
```json
{
  "description": "📘 Tổng quan\nĐắc Nhân Tâm là một cuốn sách kinh điển về kỹ năng giao tiếp và phát triển cá nhân, hướng dẫn độc giả cách xây dựng những mối quan hệ có ý nghĩa và đạt được thành công.\n\n✨ Điểm nổi bật\n• Cung cấp các nguyên tắc thực tế về cách ứng xử với con người\n• Kết hợp các câu chuyện thực tế từ cuộc sống và sự nghiệp\n\n🎯 Gợi ý bạn đọc\nPhù hợp với bạn đọc muốn cải thiện kỹ năng giao tiếp, phát triển bản thân và xây dựng mối quan hệ tốt hơn.",
  "web_context_used": true
}
```

### Error Response (400) - Missing Title
```json
{
  "detail": "Thiếu tên sách (title)."
}
```

### Error Response (400) - Missing Author
```json
{
  "detail": "Thiếu tên tác giả (author)."
}
```

### Error Response (502) - Ollama Connection Error
```json
{
  "detail": "Ollama lỗi: connection refused"
}
```

---

## 8. ENVIRONMENT CONFIGURATION

### Frontend (.env.local or .env.development)
```bash
# AI Service URL
VITE_AI_BASE_URL=http://localhost:3000/ai

# Or let it default by setting gateway
VITE_GATEWAY_BASE_URL=http://localhost:3000
```

### Backend (.env or docker-compose environment)
```bash
# Ollama Configuration
OLLAMA_HOST=http://ollama:11434
OLLAMA_MODEL=llava

# Optional: Use different model for summaries
SUMMARY_MODEL=llama3
```

---

## 9. COMMON INTEGRATION PATTERNS

### Pattern 1: Pre-fill on New Book

```jsx
const [form, setForm] = useState({ title: '', author: '', description: '' });

const handleAutoGenerate = async () => {
  if (!form.title) {
    Alert.warn('Title required');
    return;
  }
  const { description } = await generateBookSummary(form.title, form.author);
  setForm(prev => ({ ...prev, description }));
};
```

### Pattern 2: Update Existing Book

```jsx
const handleUpdateDescription = async (bookId) => {
  const book = await bookService.getById(bookId);
  const result = await generateBookSummary(book.title, book.author);
  await bookService.update(bookId, { description: result.description });
  setBook(prev => ({ ...prev, description: result.description }));
};
```

### Pattern 3: Batch Generate (Multiple Books)

```javascript
const generateBatch = async (books) => {
  const results = [];
  for (const book of books) {
    try {
      const result = await generateBookSummary(book.title, book.author);
      results.push({ id: book.id, description: result.description });
    } catch (error) {
      console.warn(`Failed for ${book.title}:`, error.message);
    }
  }
  return results;
};
```

---

## 10. DEBUGGING & LOGS

### Frontend Console Output
```javascript
// Enable debug logging
const debug = true;

async function generateBookSummary(title, author) {
  if (debug) console.log('🤖 Generating for:', { title, author });
  try {
    const result = await aiService.generateBookSummary(title, author);
    if (debug) console.log('✅ Generated:', result);
    return result;
  } catch (error) {
    if (debug) console.error('❌ Error:', error);
    throw error;
  }
}
```

### Backend Logs to Check
```python
# Check AI service logs
docker compose logs ai-service -f

# Look for:
# - "POST /generate-book-summary" (request received)
# - "Ollama lỗi" (Ollama connection issues)
# - "DuckDuckGo search thất bại" (web search failed, using LLM knowledge)
```

---

## 11. TROUBLESHOOTING

| Problem | Solution |
|---------|----------|
| Button disabled always | Check `aiLoading` or `submitting` state |
| "Thiếu tên sách" error | Title field is empty or only whitespace |
| Empty response | Check if LLM model loaded properly |
| "Ollama lỗi" | Verify Ollama service running: `docker compose logs ollama` |
| No web context | DuckDuckGo search failed (graceful fallback applies) |
| Very long generation time | Model is large, increase timeout or use smaller model |

---
