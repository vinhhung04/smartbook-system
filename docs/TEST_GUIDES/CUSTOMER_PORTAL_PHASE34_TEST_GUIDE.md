# CUSTOMER PORTAL PHASE 3-4 - Local Test Guide

This guide validates Phase 3 and Phase 4 customer portal features with real services and real DB data.

## Scope

- Phase 3:
  - My Reservations list
  - Create reservation
  - Cancel reservation
  - My Notifications list
- Phase 4:
  - My Loans list
  - My Loan detail
  - Renewal request
  - My Fines summary
  - My wallet/account summary
  - Fine payment (partial/full)

- Phase C/D extension:
  - Auto-debit borrow fee during reservation -> loan conversion (when configured)
  - Overdue sweep job and overdue fine generation
  - Lost/damaged fine generation on return flow

## 1. Prerequisites

- Docker stack is up from repository root:

```bash
docker compose up -d --build
```

- Services are healthy:
  - Web: http://localhost:5173
  - Gateway: http://localhost:3000/health

## 2. Create customer account and login

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username":"phase34.customer",
    "email":"phase34.customer@example.com",
    "full_name":"Phase34 Customer",
    "password":"Passw0rd!"
  }'
```

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"phase34.customer@example.com","password":"Passw0rd!"}'
```

Save token as `TOKEN`.

## 3. API checks

### 3.1 Identity and membership

```bash
curl http://localhost:3000/my/profile -H "Authorization: Bearer $TOKEN"
curl http://localhost:3000/my/membership -H "Authorization: Bearer $TOKEN"
```

Expected: both HTTP 200.

### 3.2 Catalog and reservable item

```bash
curl "http://localhost:3000/catalog/books" -H "Authorization: Bearer $TOKEN"
```

Expected: HTTP 200, book list includes fields used by reservation flow (`variant_id`, `default_warehouse_id`, `reservable`).

### 3.3 Create reservation

Use one reservable row from catalog response:

```bash
curl -X POST http://localhost:3000/my/reservations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: phase34-resv-001" \
  -d '{
    "variant_id":"<variant_uuid>",
    "warehouse_id":"<warehouse_uuid>",
    "pickup_location_id":"<location_uuid_or_null>",
    "quantity":1
  }'
```

Expected:
- HTTP 201 when stock is available and membership allows.
- Proper 409 for blocked cases (stock unavailable, membership limit exceeded, etc.).

### 3.4 List/cancel reservations

```bash
curl http://localhost:3000/my/reservations -H "Authorization: Bearer $TOKEN"
```

```bash
curl -X PATCH http://localhost:3000/my/reservations/<reservation_id>/cancel \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: phase34-cancel-001"
```

Expected:
- List returns only current customer reservations.
- Cancel succeeds only for valid statuses and releases stock integration.

### 3.5 Loans and loan detail

```bash
curl http://localhost:3000/my/loans -H "Authorization: Bearer $TOKEN"
curl http://localhost:3000/my/loans/<loan_id> -H "Authorization: Bearer $TOKEN"
```

Expected:
- HTTP 200.
- Loan detail is restricted to current customer.

### 3.6 Renewal request

```bash
curl -X POST http://localhost:3000/my/loans/<loan_id>/renew-request \
  -H "Authorization: Bearer $TOKEN"
```

Expected:
- HTTP 201 for accepted request creation.
- HTTP 409 for blocked cases based on loan status or membership limits.

### 3.7 Fines and notifications

```bash
curl http://localhost:3000/my/fines -H "Authorization: Bearer $TOKEN"
curl http://localhost:3000/my/notifications -H "Authorization: Bearer $TOKEN"
```

Expected:
- HTTP 200.
- Fines returns at least balance summary; notifications returns only current customer records.

### 3.8 Wallet/account and top-up

```bash
curl http://localhost:3000/my/account -H "Authorization: Bearer $TOKEN"
```

```bash
curl -X POST http://localhost:3000/my/account/topup \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: phase34-topup-001" \
  -d '{"amount":200000,"note":"phase34 topup"}'
```

```bash
curl http://localhost:3000/my/account/ledger -H "Authorization: Bearer $TOKEN"
```

Expected:
- HTTP 200 for summary/ledger.
- HTTP 201 (or 200 idempotent replay) for top-up.

### 3.9 Fine payment (partial/full)

Use one fine id from `GET /my/fines`.

```bash
curl -X POST http://localhost:3000/my/fines/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fine_id":"<fine_uuid>","amount":10000,"payment_method":"EWALLET"}'
```

Expected:
- HTTP 200.
- Fine moves UNPAID -> PARTIALLY_PAID -> PAID when settled.

### 3.10 Staff manual overdue sweep

This endpoint requires staff token with `borrow.write`.

```bash
curl -X POST http://localhost:3000/borrow/loans/jobs/overdue-sweep \
  -H "Authorization: Bearer <STAFF_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"limit":200}'
```

Expected:
- HTTP 200 with processed item count.
- Overdue items become OVERDUE and overdue fines are created when applicable.

## 4. UI checks

1. Login to customer portal: http://localhost:5173/customer/login
2. Browse books: http://localhost:5173/customer/books
3. Open book detail and click reserve if item is reservable.
4. Verify reservations page: http://localhost:5173/customer/reservations
5. Verify loans page: http://localhost:5173/customer/loans
6. Verify fines page: http://localhost:5173/customer/fines
7. Verify notifications page: http://localhost:5173/customer/notifications

## 5. Covered test cases

- Customer can create and list own reservations.
- Customer cannot cancel invalid reservation states.
- Reservation/loan/fine/notification endpoints are ownership-scoped.
- Loan detail is ownership-protected.
- Renewal request supports success and blocked conditions.
- Fines and notifications load from real DB-backed services.
- Wallet/account summary and top-up work with ledger records.
- Fine payment supports partial/full settlement and updates balance.
- Overdue sweep transitions loan items and generates overdue fines.
