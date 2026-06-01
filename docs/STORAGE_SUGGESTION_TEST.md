# Hướng dẫn Test - Storage Suggestion Feature

## Tổng quan

Chức năng gợi ý vị trí lưu trữ sách trong kho có tích hợp AI và Redis cache.

## Các file đã tạo/sửa

### Backend (inventory-service)

| File | Mô tả |
|------|--------|
| `src/utils/warehouse-scope.utils.js` | Helpers kiểm tra warehouse scope |
| `src/services/storage-suggestion.service.js` | Business logic scoring + AI + Redis cache |
| `src/controllers/storage-suggestion.controller.js` | API handlers |
| `src/routes/storage-suggestion.routes.js` | Route definitions |
| `src/index.js` | Đăng ký routes |

### AI Service (ai-service)

| File | Mô tả |
|------|--------|
| `main.py` | Thêm endpoint `/explain-storage-suggestion` |

### Frontend (web)

| File | Mô tả |
|------|--------|
| `src/services/storage-suggestion.ts` | API service |
| `src/services/index.ts` | Export service |
| `src/components/inventory/StorageSuggestionPanel.tsx` | UI component |
| `src/components/pages/receiving-putaway.tsx` | Tích hợp Putaway page |

## Tính năng mới

### 1. AI Explanation
- Gọi AI để tạo câu giải thích tự nhiên cho các gợi ý
- Ưu tiên Anthropic, fallback Ollama local
- Nếu AI lỗi → dùng rule-based explanation

### 2. Redis Cache
- Cache key: `storage_suggestion:{warehouseId}:{variantId}:{quantity}`
- TTL: 120 giây
- Cache được xóa khi có stock movement
- Nếu Redis không khả dụng → bỏ qua cache

### 3. Tích hợp Putaway Page
- Nút "Gợi ý vi trí (AI)" trong section Receiving → Shelf
- Nhập số lượng cần gợi ý
- Chọn vị trí từ gợi ý → tự động điền vào draft line

## API Endpoints

### 1. POST /api/storage-suggestions

Gợi ý vị trí lưu trữ cho sách/variant.

**Request:**
```json
{
  "warehouse_id": "uuid-cua-kho",
  "book_id": "uuid-cua-sach",
  "variant_id": "uuid-cua-variant",
  "quantity": 10,
  "mode": "RECEIVING"
}
```

**Response:**
```json
{
  "success": true,
  "warehouseId": "uuid",
  "variantId": "uuid",
  "bookId": "uuid",
  "bookTitle": "Tên sách",
  "quantity": 10,
  "suggestions": [
    {
      "rank": 1,
      "locationId": "uuid",
      "locationCode": "A-01-01",
      "zone": "A",
      "shelf": "01",
      "bin": "01",
      "score": 92,
      "confidence": "HIGH",
      "availableCapacity": 50,
      "currentOnHand": 12,
      "reasons": ["Vị trí này đã có cùng đầu sách"],
      "warnings": [],
      "aiExplanation": "Nên đặt tại kệ A-01-01 vì đây là khu vực IT, hiện có sách cùng chủ đề."
    }
  ],
  "fallback": false,
  "fromCache": false
}
```

### 2. GET /api/storage-suggestions/context

Lấy thông tin hỗ trợ hiển thị.

### 3. POST /api/storage-suggestions/apply

Validate gợi ý trước khi áp dụng.

### 4. POST /ai/explain-storage-suggestion (AI Service)

Tạo câu giải thích tự nhiên cho gợi ý.

## Test bằng cURL

### 1. Lấy token

```bash
curl -X POST http://localhost:3002/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "password"}'
```

### 2. Test gợi ý vị trí

```bash
curl -X POST http://localhost:3001/api/storage-suggestions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "warehouse_id": "YOUR_WAREHOUSE_UUID",
    "variant_id": "YOUR_VARIANT_UUID",
    "quantity": 10,
    "mode": "RECEIVING"
  }'
```

### 3. Test AI explanation

```bash
curl -X POST http://localhost:8000/explain-storage-suggestion \
  -H "Content-Type: application/json" \
  -d '{
    "book": {
      "title": "Clean Code",
      "categories": ["Programming", "Software"],
      "authors": ["Robert C. Martin"]
    },
    "suggestions": [
      {"location_code": "IT-A01-S02-B03", "score": 92, "reasons": ["Cùng variant"]}
    ]
  }'
```

## Scoring Algorithm

| Tiêu chí | Điểm | Mô tả |
|----------|-------|--------|
| Cùng variant | +40 | Sách cùng ISBN/bìa đã có ở vị trí |
| Cùng sách | +30 | Cùng đầu sách nhưng khác variant |
| Cùng category | +20 | Cùng thể loại sách |
| Đủ sức chứa | +20 | Sức chứa >= số lượng nhập |
| Active & Pickable | +10 | Vị trí đang hoạt động |
| Vị trí trống | +8 | Chưa có hàng |
| Lịch sử gần đây | +10 | Có movement 90 ngày gần nhất |

**Confidence:**
- HIGH: score >= 80
- MEDIUM: score >= 50
- LOW: score < 50

## Test Cases

### TC1: Admin xem gợi ý
- User: Admin (is_superuser=true)
- Gọi suggestion cho Kho A và Kho B
- Kết quả: Cả hai đều được, thấy đầy đủ vị trí

### TC2: Staff Kho A xem kho của mình
- User: Staff có scope Kho A
- Gọi suggestion cho Kho A
- Kết quả: Được, thấy vị trí Kho A

### TC3: Staff Kho A xem Kho B (403)
- User: Staff có scope Kho A
- Gọi suggestion cho Kho B
- Kết quả: 403 Forbidden

### TC4: Vị trí có cùng variant
- Tạo stock_balance cho variant X tại location A-01-01
- Gọi suggestion cho variant X
- Kết quả: A-01-01 được ưu tiên với +40 điểm

### TC5: Vị trí hết capacity
- Location có capacity_qty = 10, đang chứa 10
- Gọi suggestion với quantity = 5
- Kết quả: Warning hoặc không gợi ý vị trí này

### TC6: AI Explanation
- Gọi suggestion
- Kiểm tra trường `aiExplanation` trong response
- Nếu AI lỗi → fallback sang rule-based

### TC7: Redis Cache
- Gọi suggestion lần 1 → `fromCache: false`
- Gọi suggestion lần 2 → `fromCache: true`
- Đợi 120s → `fromCache: false`

## Permission Requirements

- **inventory.stock.read**: Xem gợi ý
- **inventory.stock.write**: Chọn và xác nhận vị trí

## Environment Variables

### inventory-service
```
AI_SERVICE_URL=http://localhost:8000
REDIS_URL=redis://localhost:6379
```

### ai-service
```
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.2
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-4-6
```

## Hạn chế còn lại

1. Chưa có unit test
2. Chưa tích hợp vào trang Goods Receipt
3. Chưa tích hợp vào AI Import Book

## Cách sử dụng trên UI

1. Vào trang **Receiving - Shelf Putaway**
2. Chọn **Warehouse** và **Receiving source**
3. Chọn **SKU** trong danh sách
4. Bấm nút **"Gợi ý vị trí (AI)"**
5. Nhập **số lượng** cần gợi ý
6. Xem danh sách gợi ý với điểm số và AI explanation
7. Bấm **"Chọn"** để điền vào draft line
