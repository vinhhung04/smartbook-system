# AI Description Generation - Visual Architecture & Diagrams

## 1. SYSTEM ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT BROWSER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      FRONTEND (React/TypeScript)                     │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐           │  │
│  │  │ Inventory    │  │ Inventory    │  │ Book Detail     │           │  │
│  │  │ Page - New   │  │ Page - Edit  │  │ Page            │           │  │
│  │  │ Book Modal   │  │ Book Modal   │  │                 │           │  │
│  │  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘           │  │
│  │         │                 │                   │                    │  │
│  │         │ handleAiGenerate│ handleAiGenerate │ handleGenerateQuick │  │
│  │         │      ()         │      ()          │ Description()       │  │
│  │         └─────────────────┴───────────────────┴────────┐            │  │
│  │                                                        │            │  │
│  │  ┌─────────────────────────────────────────────────────▼────────┐  │  │
│  │  │              API SERVICE LAYER (services/api.ts)             │  │  │
│  │  │         generateBookSummary(title, author)                   │  │  │
│  │  └────────────────────────────────┬─────────────────────────────┘  │  │
│  │                                   │                               │  │
│  │  ┌────────────────────────────────▼─────────────────────────────┐  │  │
│  │  │              AI SERVICE (services/ai.ts)                     │  │  │
│  │  │    aiService.generateBookSummary(title, author)             │  │  │
│  │  │         aiAPI.post('/generate-book-summary',                │  │  │
│  │  │         {title, author})                                    │  │  │
│  │  └────────────────────────────────┬─────────────────────────────┘  │  │
│  │                                   │                               │  │
│  │  ┌────────────────────────────────▼─────────────────────────────┐  │  │
│  │  │         HTTP CLIENT (services/http-clients.ts)              │  │  │
│  │  │    baseURL: http://localhost:3000/ai                        │  │  │
│  │  │    aiAPI = axios.create({baseURL: aiBaseURL})               │  │  │
│  │  └────────────────────────────────┬─────────────────────────────┘  │  │
│  │                                   │                               │  │
│  └───────────────────────────────────┼───────────────────────────────┘  │
│                                      │                                  │
└──────────────────────────────────────┼──────────────────────────────────┘
                                       │ HTTP POST
                                       │ Content-Type: application/json
                                       │ {title: string, author: string}
                                       │
                ┌──────────────────────▼──────────────────────┐
                │    API GATEWAY (PORT 3000)                  │
                │  Reverse Proxy / Route Management           │
                │  Forwards /ai/* → AI Service (8000)        │
                └──────────────────────┬──────────────────────┘
                                       │ Route: /ai/generate-book-summary
                                       │
                ┌──────────────────────▼──────────────────────┐
                │  AI SERVICE (Python/FastAPI, PORT 8000)     │
                ├───────────────────────────────────────────┐ │
                │ @app.post("/generate-book-summary")       │ │
                │                                           │ │
                │  1. Validate Request                      │ │
                │     ├─ title.strip() not empty            │ │
                │     └─ author.strip() not empty           │ │
                │                                           │ │
                │  2. Optional Web Search                   │ │
                │     ├─ _search_book_context()             │ │
                │     └─ DuckDuckGo (max 3 results)         │ │
                │                                           │ │
                │  3. Build LLM Prompt                      │ │
                │     ├─ Title + Author + Context           │ │
                │     └─ Format guidelines                  │ │
                │                                           │ │
                │  4. Call Ollama                           │ │
                │     ├─ Model: llava/llama3                │ │
                │     ├─ Temperature: 0.7                   │ │
                │     └─ Max tokens: 400                    │ │
                │                                           │ │
                │  5. Format Response                       │ │
                │     ├─ _format_summary_description()      │ │
                │     └─ Multi-line with emojis             │ │
                │                                           │ │
                │  6. Return JSON Response                  │ │
                │     ├─ description: string                │ │
                │     └─ web_context_used: boolean          │ │
                ├───────────────────────────────────────────┤ │
                │  📡 Depends On:                           │ │
                │  ├─ Ollama Service (localhost:11434)      │ │
                │  └─ DuckDuckGo API (optional web search)  │ │
                └─────────────────────────────────────────────┘
```

---

## 2. REQUEST/RESPONSE FLOW DIAGRAM

```
┌─────────────────────────┐
│  User Clicks Button     │
│  "✨ Tao bang AI"      │
└────────────┬────────────┘
             │
             ▼
    ┌────────────────────┐
    │ handleAiGenerate() │
    │  or               │
    │ handleGenerate... │
    │ QuickDescription()│
    └────────────┬───────┘
                 │
        ┌────────▼─────────┐
        │ Validate Input   │
        │ title present?   │
        │ author present?  │
        └────────┬─────────┘
                 │
        ┌────────▼────────────────────┐
        │ Set Loading State = TRUE    │
        │ Show: Spinner + "Dang tao"  │
        │ Disable: Button             │
        └────────┬────────────────────┘
                 │
        ┌────────▼────────────────────┐
        │ POST /generate-book-summary │
        │ Payload:                    │
        │ {                           │
        │   title: string,            │
        │   author: string            │
        │ }                           │
        └────────┬────────────────────┘
                 │
    ┌────────────▼────────────────────────┐
    │ NETWORK REQUEST                     │
    │ http://localhost:3000/ai/...        │
    │ (Gateway routes to port 8000)       │
    └────────────┬────────────────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │ Backend Processing                │
    │ 1. Validate: title ≠ empty        │
    │ 2. Validate: author ≠ empty       │
    │                                  │
    │ If validation fails:              │
    │ ─> HTTP 400 Error Response        │
    │                                  │
    │ 3. Web Search (DuckDuckGo)        │
    │ 4. Build Prompt                  │
    │ 5. Call Ollama LLM               │
    │ 6. Format Response               │
    │ 7. Return Success                │
    └────────────┬──────────────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │ HTTP Response (200 OK)            │
    │ {                                │
    │   description: "📘 Tổng quan\n...",│
    │   web_context_used: true          │
    │ }                                │
    └────────────┬──────────────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │ Frontend Receives Response        │
    │ 1. Extract: result.description   │
    │ 2. Set Loading State = FALSE      │
    │ 3. Hide Spinner, show normal icon │
    │ 4. Enable Button                 │
    └────────────┬──────────────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │ Update UI                        │
    │ 1. Populate textarea with desc   │
    │ 2. Show Success Toast             │
    │ (Book Detail only):              │
    │ 3. Save to database              │
    │ 4. Update page display           │
    └─────────────────────────────────┘
```

---

## 3. COMPONENT HIERARCHY

```
App
├── InventoryPage
│   ├── BookList (renders books)
│   └── NewBookModal
│       ├── Input: title
│       ├── Input: author
│       ├── Textarea: description
│       │   └── Button: "✨ AI Tạo mô tả"
│       │       └── handleAiGenerate()
│       │           └── generateBookSummary(title, author)
│       └── Button: "Tạo sách mới"
│
├── InventoryPage (continued)
│   └── EditBookModal
│       ├── Input: title
│       ├── Input: author
│       ├── Textarea: description
│       │   └── Button: "✨ AI Tạo mô tả"
│       │       └── handleAiGenerate()
│       │           └── generateBookSummary(title, author)
│       └── Button: "Lưu thay đổi"
│
└── BookDetailPage
    ├── BookMetadata
    ├── InventoryTable
    └── EditModal
        ├── Input: title
        ├── Input: author
        ├── Textarea: description
        │   └── Button: "Tao bang AI"
        │       └── handleGenerateQuickDescription()
        │           ├── generateBookSummary(title, author)
        │           ├── bookService.update(id, {description})
        │           ├── setBook(...) [UI refresh]
        │           └── toast.success(...)
        └── Button: "Luu thay doi"
```

---

## 4. STATE MANAGEMENT DIAGRAM

### InventoryPage State

```
┌──────────────────────────────────────┐
│    InventoryPage State               │
├──────────────────────────────────────┤
│                                      │
│  NewBookModal:                       │
│  ├─ form: {                          │
│  │   title: string                   │
│  │   author: string                  │
│  │   description: string ◄── Updated │
│  │   ...                             │
│  │ }                                 │
│  ├─ aiLoading: boolean ◄── Flag      │
│  ├─ aiError: string ◄── Error msg    │
│  └─ submitting: boolean              │
│                                      │
│  EditBookModal:                      │
│  ├─ form: {                          │
│  │   title: string                   │
│  │   author: string                  │
│  │   description: string ◄── Updated │
│  │   ...                             │
│  │ }                                 │
│  ├─ aiLoading: boolean ◄── Flag      │
│  ├─ aiError: string ◄── Error msg    │
│  └─ submitting: boolean              │
│                                      │
└──────────────────────────────────────┘
```

### BookDetailPage State

```
┌──────────────────────────────────────┐
│    BookDetailPage State              │
├──────────────────────────────────────┤
│                                      │
│  Data:                               │
│  ├─ book: BookDetailData             │
│  └─ editForm: {                      │
│      title: string                   │
│      author: string                  │
│      description: string ◄── Updated │
│      ...                             │
│    }                                 │
│                                      │
│  UI Flags:                           │
│  ├─ loading: boolean                 │
│  ├─ isGeneratingDescription: boolean │
│  ├─ isSaving: boolean                │
│  └─ showEditModal: boolean           │
│                                      │
└──────────────────────────────────────┘
```

---

## 5. SERVICE LAYERS ARCHITECTURE

```
┌─────────────────────────────────────────────────┐
│           FRONTEND SERVICE LAYERS               │
├─────────────────────────────────────────────────┤
│                                                 │
│  Layer 1: React Components (JSX)                │
│  ├─ InventoryPage.jsx                           │
│  ├─ book-detail.tsx                             │
│  └─ Components handle UI & state               │
│                                                 │
│         ▲                                       │
│         │ import                                │
│         │                                       │
│  Layer 2: API Gateway (api.ts)                  │
│  ├─ generateBookSummary(title, author)          │
│  └─ Re-exports aiService method                │
│                                                 │
│         ▲                                       │
│         │ import                                │
│         │                                       │
│  Layer 3: Domain Services (ai.ts)               │
│  ├─ aiService.generateBookSummary()             │
│  ├─ aiService.recognizeBook()                   │
│  ├─ aiService.extractMetadata()                 │
│  └─ Calls aiAPI HTTP client                    │
│                                                 │
│         ▲                                       │
│         │ use                                   │
│         │                                       │
│  Layer 4: HTTP Client (http-clients.ts)         │
│  ├─ aiAPI: axios instance                       │
│  │   baseURL: http://localhost:3000/ai          │
│  │   headers: {Content-Type: application/json}  │
│  ├─ inventoryAPI: axios instance                │
│  ├─ authAPI: axios instance                     │
│  └─ gatewayAPI: axios instance                  │
│                                                 │
│         ▼                                       │
│    NETWORK                                      │
│    HTTP POST → Gateway → AI Service Python     │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 6. BACKEND PROCESSING PIPELINE

```
HTTP Request
  │
  ├─ Method: POST
  ├─ Path: /generate-book-summary
  └─ Body: {title: string, author: string}
  │
  ▼ FastAPI Route Handler
  │
  generate_book_summary(req: BookSummaryRequest)
  │
  ▼ Delegate to Main Function
  │
  _generate_book_summary(req)
  │
  ├─ STEP 1: INPUT VALIDATION ──────────────────┐
  │  ├─ if not req.title.strip()                │
  │  │  └─ raise HTTPException(400)             │
  │  └─ if not req.author.strip()               │
  │     └─ raise HTTPException(400)             │
  │                                              │
  ├─ STEP 2: WEB SEARCH (Optional) ─────────────┤
  │  └─ web_context = _search_book_context()    │
  │     ├─ Query: "{title} {author} sách..."    │
  │     ├─ DuckDuckGo API                       │
  │     └─ Returns: up to 800 chars             │
  │                                              │
  ├─ STEP 3: BUILD PROMPT ──────────────────────┤
  │  ├─ Base prompt (expert instruction)        │
  │  ├─ Add title & author                      │
  │  ├─ Append web_context if available         │
  │  └─ Result: Detailed LLM instruction        │
  │                                              │
  ├─ STEP 4: CALL OLLAMA ───────────────────────┤
  │  ├─ Create ollama.Client(OLLAMA_HOST)       │
  │  ├─ client.generate(                        │
  │  │   model=SUMMARY_MODEL,                  │
  │  │   prompt=prompt,                        │
  │  │   options={temp:0.7, num_predict:400}   │
  │  │ )                                        │
  │  └─ Returns: LLM response text              │
  │                                              │
  ├─ STEP 5: FORMAT RESPONSE ───────────────────┤
  │  └─ _format_summary_description(response)   │
  │     ├─ Split into sentences                 │
  │     ├─ Extract: overview, highlights, aud   │
  │     └─ Format with emojis & line breaks     │
  │                                              │
  ├─ STEP 6: ERROR HANDLING ────────────────────┤
  │  ├─ ollama.ResponseError → 502              │
  │  └─ Exception → 500                         │
  │                                              │
  └─ STEP 7: RETURN RESPONSE ───────────────────┐
     └─ {description: string, web_context_used}│
  │                                              │
  ▼ HTTP 200 Response
  │
  └─ To Frontend
```

---

## 7. ERROR HANDLING FLOW

```
┌─────────────────────────────┐
│  Frontend Request           │
│  generateBookSummary()      │
└──────────────┬──────────────┘
               │
    ┌──────────▼──────────────┐
    │  Try Block              │
    └──────────┬──────────────┘
               │
    ┌──────────▼──────────────────────────┐
    │  HTTP Request Sent                  │
    └──────────┬──────────────────────────┘
               │
         ┌─────┴─────┐
         │           │
    ┌────▼────┐ ┌───▼────────┐
    │ Success │ │   Error    │
    │ (200)   │ │ (4xx/5xx)  │
    └────┬────┘ └───┬────────┘
         │          │
    ┌────▼────┬─────▼────────────┐
    │ Catch   │                  │
    │ Block   │  Error Handler   │
    │ (if     │                  │
    │ thrown) │  Check Error:    │
    │         │  ├─ 400: Input   │
    │         │  │   validation  │
    │         │  ├─ 500: Server  │
    │         │  ├─ 502: Ollama  │
    │         │  └─ Network err  │
    │         └─────┬────────────┘
    │              │
    └──────┬───────┘
           │
    ┌──────▼──────────────────┐
    │  Frontend Error Handler │
    ├──────────────────────────┤
    │ 1. Set aiError message   │
    │ 2. Clear aiLoading flag  │
    │ 3. Show red error text   │
    │ 4. Toast notification    │
    │ 5. Keep button enabled   │
    └──────────────────────────┘
```

---

## 8. DATA FLOW SEQUENCE

```
Timeline ───────────────────────────────────────────────────────

T0:   User clicks button
      componentState.aiLoading = false
      componentState.button.disabled = false
      componentState.button.text = "✨ Tao bang AI"
      │
      
T1:   Button click → handleAiGenerate()
      componentState.aiLoading = true
      componentState.button.disabled = true
      componentState.button.text = "Dang tao..."
      │
      
T2:   Call generateBookSummary(title, author)
      │ (immediate, async)
      
T3:   HTTP POST sent to /generate-book-summary
      Network.status = "pending"
      │
      
T4:   Backend processes request (1-5 seconds typically)
      ├─ Validate inputs
      ├─ Optional DuckDuckGo search
      ├─ Build prompt
      ├─ Call Ollama LLM (most time spent here)
      └─ Format response
      │
      
T5:   HTTP Response received
      Network.status = "completed"
      componentState.aiLoading = false
      │
      
T6:   Frontend processes response
      ├─ Check result.description exists
      ├─ Set aiError = ''
      ├─ setField('description', result.description)
      └─ (BookDetail only): bookService.update()
      │
      
T7:   UI Updates
      ├─ Textarea populated with description
      ├─ Button returns to normal state
      ├─ Success toast shown
      └─ No red error text
      │
      
T8:   Component ready for next action
      componentState.aiLoading = false
      componentState.button.disabled = false
      componentState.button.text = "✨ Tao bang AI"
```

---

## 9. DEPENDENCY GRAPH

```
┌─────────────────────────────────────┐
│  FRONTEND DEPENDENCIES              │
├─────────────────────────────────────┤
│                                     │
│  React Components                   │
│  ├─ lucide-react (icons)            │
│  │  ├─ <Sparkles />                 │
│  │  └─ <Loader2 />                  │
│  ├─ sonner (toast notifications)    │
│  │  ├─ toast.success()              │
│  │  └─ toast.error()                │
│  └─ motion/react (animations)       │
│                                     │
│  Services                           │
│  ├─ axios (HTTP client)             │
│  │  └─ aiAPI.post()                 │
│  ├─ generateBookSummary() [api.ts]  │
│  ├─ aiService.generateBookSummary() │
│  └─ bookService.update() [BookDtl] │
│                                     │
│  Utilities                          │
│  ├─ localStorage (token storage)    │
│  ├─ getApiErrorMessage() [errors]   │
│  └─ getApiErrorMessage() [errors]   │
│                                     │
└─────────────────────────────────────┘
        │
        ▼ HTTP Requests
┌─────────────────────────────────────┐
│  BACKEND DEPENDENCIES               │
├─────────────────────────────────────┤
│                                     │
│  FastAPI Application                │
│  ├─ fastapi                         │
│  ├─ pydantic (validation)           │
│  │  └─ BaseModel                    │
│  ├─ python-multipart (form data)    │
│  └─ fastapi.middleware.cors         │
│                                     │
│  LLM & AI Services                  │
│  ├─ ollama (client wrapper)         │
│  │  └─ ollama.Client.generate()     │
│  └─ ddgs (DuckDuckGo search)        │
│     └─ DDGS.text()                  │
│                                     │
│  Core Python                        │
│  ├─ json (JSON parsing)             │
│  ├─ re (regex)                      │
│  ├─ logging                         │
│  ├─ os (env variables)              │
│  └─ asyncio (async support)         │
│                                     │
│  External Services                  │
│  ├─ Ollama (LLM inference)          │
│  │  └─ Model: llava or llama3       │
│  └─ DuckDuckGo (web search)         │
│     └─ Optional, graceful fallback  │
│                                     │
└─────────────────────────────────────┘
```

---

## 10. SCALABILITY & PERFORMANCE NOTES

```
Performance Characteristics:

Request Generation Time:
├─ Input validation: ~1ms
├─ Web search (DuckDuckGo): ~500-1000ms (optional, can be disabled)
├─ LLM generation (Ollama): ~2-30s (varies by model size and HW)
│  ├─ Small model (7b): ~2-5s
│  ├─ Medium model (13b): ~5-10s
│  └─ Large model (70b): ~10-30s
├─ Response formatting: ~5ms
└─ Total: ~2-31s typical (depends on model)

Bottlenecks:
├─ Ollama LLM inference time (most critical)
├─ Model download on first run (one-time)
└─ DuckDuckGo search latency (can disable)

Optimization Options:
├─ Use smaller LLM models (7b vs 70b)
├─ Cache frequent requests
├─ Disable web search if not needed
├─ Increase timeout for frontend requests
└─ Use GPU acceleration for Ollama

Scaling Considerations:
├─ Rate limiting: Implement to prevent abuse
├─ Concurrent requests: Queue if needed
├─ Model serving: Consider dedicated LLM server
└─ Caching layer: Redis for description cache
```

---
