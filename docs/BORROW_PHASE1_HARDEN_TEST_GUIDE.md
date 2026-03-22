# Borrow Phase 1 Harden Test Guide

This guide validates the hardened Customer + Reservation flow and the new Phase 2 conversion/return endpoints.

## Prerequisites

- Run stack: `docker compose up --build`
- Ensure merged seed loaded: `data/smartbook_merged_seed.sql`
- Login with a user that has `borrow.read`, `borrow.write`, `inventory.stock.write`.
- Export JWT token to environment variable:
  - PowerShell: `$env:SMARTBOOK_TOKEN = "<jwt>"`

## Base URLs

- Gateway: `http://localhost:3000`
- Borrow endpoints are proxied under `/borrow`.

## Case 1: create customer success

```bash
curl -X POST "http://localhost:3000/borrow/customers" \
  -H "Authorization: Bearer $SMARTBOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Customer Test Harden",
    "email": "customer.harden.demo@smartbook.local",
    "phone": "0912999999",
    "status": "ACTIVE"
  }'
```

Expected:
- `201`
- response has `data.id`, `data.customer_code`, `data.status = ACTIVE`.

## Case 2: reservation success

```bash
curl -X POST "http://localhost:3000/borrow/reservations" \
  -H "Authorization: Bearer $SMARTBOOK_TOKEN" \
  -H "Idempotency-Key: case2-reserve-001" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "00000000-0000-0000-0000-000000000703",
    "variant_id": "00000000-0000-0000-0000-000000000441",
    "warehouse_id": "00000000-0000-0000-0000-000000000461",
    "quantity": 1,
    "source_channel": "COUNTER"
  }'
```

Expected:
- `201` first request.
- Repeat with same `Idempotency-Key` returns `200` and `idempotent = true`.

## Case 3: reservation fail when no stock

```bash
curl -X POST "http://localhost:3000/borrow/reservations" \
  -H "Authorization: Bearer $SMARTBOOK_TOKEN" \
  -H "Idempotency-Key: case3-reserve-no-stock-001" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "00000000-0000-0000-0000-000000000703",
    "variant_id": "00000000-0000-0000-0000-000000000449",
    "warehouse_id": "00000000-0000-0000-0000-000000000461",
    "quantity": 1,
    "source_channel": "WEB"
  }'
```

Expected:
- `409`
- message indicates insufficient stock.

## Case 4: reservation cancel success

Use reservation id from Case 2 response:

```bash
curl -X PATCH "http://localhost:3000/borrow/reservations/<reservation_id>/cancel" \
  -H "Authorization: Bearer $SMARTBOOK_TOKEN" \
  -H "Idempotency-Key: case4-cancel-001"
```

Expected:
- `200`
- `data.status = CANCELLED`
- Repeat same cancel call with another key should stay safe (idempotent or conflict-safe behavior).

## Case 5: reservation blocked by unpaid fine

```bash
curl -X POST "http://localhost:3000/borrow/reservations" \
  -H "Authorization: Bearer $SMARTBOOK_TOKEN" \
  -H "Idempotency-Key: case5-unpaid-fine-001" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "00000000-0000-0000-0000-000000000704",
    "variant_id": "00000000-0000-0000-0000-000000000441",
    "warehouse_id": "00000000-0000-0000-0000-000000000461",
    "quantity": 1,
    "source_channel": "COUNTER"
  }'
```

Expected:
- `409`
- message says unpaid fine balance.

## Case 6: reservation blocked by membership limit

```bash
curl -X POST "http://localhost:3000/borrow/reservations" \
  -H "Authorization: Bearer $SMARTBOOK_TOKEN" \
  -H "Idempotency-Key: case6-membership-limit-001" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "00000000-0000-0000-0000-000000000705",
    "variant_id": "00000000-0000-0000-0000-000000000441",
    "warehouse_id": "00000000-0000-0000-0000-000000000461",
    "quantity": 1,
    "source_channel": "COUNTER"
  }'
```

Expected:
- `409`
- message says max active loans limit exceeded.

## Optional Phase 2 quick checks

Convert reservation to loan:

```bash
curl -X POST "http://localhost:3000/borrow/reservations/<reservation_id>/convert-to-loan" \
  -H "Authorization: Bearer $SMARTBOOK_TOKEN" \
  -H "Idempotency-Key: phase2-convert-001"
```

Return a loan:

```bash
curl -X POST "http://localhost:3000/borrow/loans/<loan_id>/return" \
  -H "Authorization: Bearer $SMARTBOOK_TOKEN" \
  -H "Idempotency-Key: phase2-return-001" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected:
- convert creates loan and updates reservation to `CONVERTED_TO_LOAN`.
- return updates stock movement type `RETURN` and loan status transitions toward `RETURNED`.
