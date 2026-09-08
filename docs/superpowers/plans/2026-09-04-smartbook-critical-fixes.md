# SmartBook — Sửa lỗi nghiêm trọng trước bảo vệ (Tier 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa 6 phát hiện mức "nghiêm trọng" từ báo cáo audit UX/tính năng — những lỗi có khả năng làm hỏng buổi bảo vệ đồ án hoặc khiến hội đồng bắt gặp ngay trong vài phút đầu bấm thử hệ thống.

**Architecture:** Đây là 8 thay đổi độc lập, mỗi thay đổi chạm một lát mỏng của hệ thống (seed data, một route, một component). Không có thay đổi kiến trúc lớn — chủ yếu là: sửa dữ liệu mẫu sai, gỡ một tính năng giả/lỗi hiển thị, nối hai điểm dữ liệu đã tồn tại nhưng chưa được nối, và thêm một lớp phòng thủ lỗi còn thiếu.

**Tech Stack:** Node.js + Express + Prisma (`services/borrow-service`, `services/inventory-service`), React 18 + TypeScript + Vite + react-router 7 (`apps/web`).

**Spec:** Báo cáo audit đã publish tại phiên làm việc trước (artifact `smartbook-audit.html`) — các mã LIB-01, CUST-01, LIB-02, PLAT-01, CUST-02, IA-08, PLAT-06, PLAT-05 trong mục "MỨC 0: Sáu thứ nên sửa trước buổi bảo vệ".

## Global Constraints

- `apps/web` KHÔNG có bất kỳ framework test tự động nào (không vitest, không jest, không @testing-library) — xác nhận bằng `apps/web/package.json` chỉ có `dev/build/lint/preview`. Mọi thay đổi frontend được xác minh bằng `pnpm --filter web lint`, `pnpm --filter web build` (TypeScript compile) và kiểm tra thủ công trên trình duyệt qua dev server — **không tự chế test giả**.
- Backend dùng Node test runner gốc: `node --test test/*.test.js` (xem `services/borrow-service/package.json` script `test`). Test mới cho logic thuần (không đụng DB) đi theo đúng khuôn `services/borrow-service/test/auth-middleware.test.js` (dùng `node:test` + `node:assert/strict`, không mock Prisma).
- Các đổi thay chạm Prisma/DB thật được xác minh bằng script tích hợp có sẵn: `node scripts/borrow-phase2-integration.mjs` (chạy trên stack Docker đang sống) — đây là cơ chế smoke-test duy nhất của repo cho luồng mượn/trả, không tồn tại DB test riêng.
- Giữ nguyên style code hiện có: file `.ts` (không phải `.tsx`) dùng `createElement` thay vì JSX (xem `apps/web/src/app/routes.ts`).
- Không xóa `ROUTE_ACCESS.messaging` trong `lib/rbac.ts` — chỉ gỡ các nơi tiêu thụ nó, vì việc xóa định nghĩa quyền không nằm trong phạm vi lỗi đang sửa.
- Toàn bộ chuỗi hiển thị mới phải là tiếng Việt, khớp giọng văn hiện có trong `apps/web/src/components/pages/customer/*`.

---

## Task 1: Sửa ngày hết hạn membership trong seed + auto-provision

**Files:**
- Modify: `services/borrow-service/prisma/seed.js:221-291` (khối `customer_memberships.createMany`)
- Modify: `services/borrow-service/prisma/seed.js:1171` (dòng `extendedCustomer` membership)
- Modify: `services/borrow-service/src/services/membership.service.js`
- Modify: `services/borrow-service/src/controllers/customer.controller.js:113-121` (auto-provision khi khách tự đăng ký)
- Modify: `services/borrow-service/src/controllers/customer.controller.js:229-238` (auto-provision khi staff tạo khách)
- Modify: `services/borrow-service/src/controllers/customer.controller.js:569-577` (auto-provision khi đăng ký qua auth-service)
- Test: `services/borrow-service/test/membership-dates.test.js`

**Interfaces:**
- Consumes: không phụ thuộc task nào trước.
- Produces: `computeMembershipEndDate(startDate, durationDays)` — export mới từ `services/borrow-service/src/services/membership.service.js`, dùng ở Task 2.

**Vấn đề:** Mọi membership trong seed có `end_date` là ngày cứng trong quá khứ (2024/2025), nên `resolveActiveMembership` (lọc `end_date >= today`) trả `null` cho gần hết khách demo — bấm "Đặt sách" ra lỗi 409. Ngược lại, khi khách tự đăng ký, ba nơi tạo `customer_memberships` đều KHÔNG đặt `end_date` — nên gói hội viên tự đăng ký "sống mãi mãi", vô hiệu hóa khái niệm thời hạn.

- [ ] **Step 1: Thêm hàm tính ngày hết hạn thuần túy vào `membership.service.js`**

Mở `services/borrow-service/src/services/membership.service.js`, thêm hằng số và hàm mới ngay trước `module.exports`:

```javascript
const DEFAULT_MEMBERSHIP_DURATION_DAYS = 365;

function computeMembershipEndDate(startDate, durationDays = DEFAULT_MEMBERSHIP_DURATION_DAYS) {
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + durationDays);
  return end;
}

module.exports = {
  resolveActiveMembership,
  computeMembershipEndDate,
  DEFAULT_MEMBERSHIP_DURATION_DAYS,
};
```

- [ ] **Step 2: Viết test cho `computeMembershipEndDate`**

Tạo `services/borrow-service/test/membership-dates.test.js`:

```javascript
const assert = require('node:assert/strict');
const test = require('node:test');
const { computeMembershipEndDate, DEFAULT_MEMBERSHIP_DURATION_DAYS } = require('../src/services/membership.service');

test('computeMembershipEndDate adds the default 365 days when no duration is given', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const end = computeMembershipEndDate(start);
  assert.equal(DEFAULT_MEMBERSHIP_DURATION_DAYS, 365);
  assert.equal(end.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('computeMembershipEndDate honors a custom duration', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const end = computeMembershipEndDate(start, 30);
  assert.equal(end.toISOString(), '2026-01-31T00:00:00.000Z');
});
```

- [ ] **Step 3: Chạy test để xác nhận PASS**

Run: `cd services/borrow-service && node --test test/membership-dates.test.js`
Expected: 2 pass, 0 fail.

- [ ] **Step 4: Sửa ba nơi auto-provision để luôn đặt `end_date`**

Trong `services/borrow-service/src/controllers/customer.controller.js`, thêm import ở đầu file (cạnh `resolveActiveMembership`):

```javascript
const { resolveActiveMembership, computeMembershipEndDate } = require('../services/membership.service');
```

Tại dòng 113 (khối tạo membership khi khách tự đăng ký), sửa:

```javascript
      await tx.customer_memberships.create({
        data: {
          customer_id: customer.id,
          plan_id: membershipPlan.id,
          card_number: generateCardNumber(customer.id),
          start_date: new Date(),
          end_date: computeMembershipEndDate(new Date()),
          status: 'ACTIVE',
          note: 'Auto assigned from customer self provisioning',
        },
      });
```

Tại dòng 229 (khối staff tạo khách), sửa:

```javascript
      if (membershipPlan) {
        const membership = await tx.customer_memberships.create({
          data: {
            customer_id: customer.id,
            plan_id: membershipPlan.id,
            card_number: generateCardNumber(customer.id),
            start_date: new Date(),
            end_date: computeMembershipEndDate(new Date()),
            status: resolvedStatus === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
            note: 'Auto assigned on customer creation',
          },
        });
```

Tại dòng 569 (khối đăng ký qua auth-service), sửa:

```javascript
      await tx.customer_memberships.create({
        data: {
          customer_id: customer.id,
          plan_id: ensuredPlan.id,
          card_number: generateCardNumber(customer.id),
          start_date: new Date(),
          end_date: computeMembershipEndDate(new Date()),
          status: 'ACTIVE',
          note: 'Auto assigned from auth register',
        },
      });
```

- [ ] **Step 5: Sửa seed.js dùng ngày tương đối thay vì ngày cứng**

Mở `services/borrow-service/prisma/seed.js`, thay toàn bộ khối `customer_memberships.createMany` ở dòng 221-291:

```javascript
const oneYearMs = 365 * 24 * 60 * 60 * 1000;
const membershipStart = (daysAgo) => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
const membershipEnd = (startDate, durationDays = 365) => new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

const memberships = [
  { customer_id: customers[0].id, plan_id: plans[2].id, card_number: 'CARD-001-GOLD', daysAgo: 240 },
  { customer_id: customers[1].id, plan_id: plans[0].id, card_number: 'CARD-002-BASIC', daysAgo: 200 },
  { customer_id: customers[2].id, plan_id: plans[1].id, card_number: 'CARD-003-SILVER', daysAgo: 180 },
  { customer_id: customers[3].id, plan_id: plans[3].id, card_number: 'CARD-004-VIP', daysAgo: 220 },
  { customer_id: customers[4].id, plan_id: plans[0].id, card_number: 'CARD-005-BASIC', daysAgo: 150 },
  { customer_id: customers[5].id, plan_id: plans[1].id, card_number: 'CARD-006-SILVER', daysAgo: 120 },
  { customer_id: customers[7].id, plan_id: plans[2].id, card_number: 'CARD-008-GOLD', daysAgo: 90 },
];

await prisma.customer_memberships.createMany({
  data: memberships.map((m) => {
    const start = membershipStart(m.daysAgo);
    return {
      customer_id: m.customer_id,
      plan_id: m.plan_id,
      card_number: m.card_number,
      start_date: start,
      end_date: membershipEnd(start),
      status: 'ACTIVE',
    };
  }),
  skipDuplicates: true,
});

// customers[6] giữ một membership ĐÃ HẾT HẠN có chủ đích — dùng để demo/test luồng
// "khách hết hạn không mượn được sách" mà không cần chờ dữ liệu thật quá hạn.
await prisma.customer_memberships.create({
  data: {
    customer_id: customers[6].id,
    plan_id: plans[0].id,
    card_number: 'CARD-007-BASIC',
    start_date: new Date(Date.now() - oneYearMs - 30 * 24 * 60 * 60 * 1000),
    end_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    status: 'EXPIRED',
  },
});

console.log('✅ Created customer memberships');
```

- [ ] **Step 6: Sửa membership của `extendedCustomer` ở dòng ~1171 cũng dùng ngày tương đối**

Tìm dòng chứa `card_number: 'CARD-EXT-001-SILVER'` và sửa:

```javascript
await prisma.customer_memberships.createMany({
  data: [{
    customer_id: extendedCustomer.id,
    plan_id: plans[1].id,
    card_number: 'CARD-EXT-001-SILVER',
    start_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    end_date: new Date(Date.now() + 305 * 24 * 60 * 60 * 1000),
    status: 'ACTIVE',
    note: 'Student reader with mixed digital and counter activity.',
  }],
});
```

- [ ] **Step 7: Chạy lại seed và xác minh bằng script tích hợp thật**

Run: `cd services/borrow-service && node prisma/seed.js` (cần Postgres đang chạy qua `docker compose up -d`)
Expected: log kết thúc bằng `✅ Created customer memberships`, không có lỗi.

Run: `node scripts/borrow-phase2-integration.mjs` (từ thư mục gốc `smartbook-system`, cần toàn bộ stack Docker đang chạy)
Expected: dòng `1.self customer ensure: true` và `3.reservation->loan convert: true` — nghĩa là tạo reservation không còn bị 409 vì thiếu membership.

- [ ] **Step 8: Commit**

```bash
git add services/borrow-service/prisma/seed.js services/borrow-service/src/services/membership.service.js services/borrow-service/src/controllers/customer.controller.js services/borrow-service/test/membership-dates.test.js
git commit -m "fix(borrow): seed memberships with relative dates, always set end_date on auto-provision"
```

---

## Task 2: Thêm endpoint gia hạn membership

**Files:**
- Modify: `services/borrow-service/src/controllers/customer.controller.js`
- Modify: `services/borrow-service/src/routes/customer.routes.js`
- Test: `services/borrow-service/test/membership-dates.test.js` (bổ sung)

**Interfaces:**
- Consumes: `computeMembershipEndDate(startDate, durationDays)` từ Task 1.
- Produces: `POST /borrow/customers/:id/membership/renew` — dùng ở roadmap sub-plan "Thư viện" khi thêm UI gia hạn cho staff (không nằm trong phạm vi task này).

**Vấn đề:** Không có bất kỳ đường nào để gia hạn hoặc cấp lại membership khi hết hạn — `customer.routes.js` chỉ có `GET .../membership/active`. Một khi `status='EXPIRED'` hoặc `end_date` trôi qua, khách hàng đó vĩnh viễn không mượn được sách nữa trừ khi ai đó sửa DB tay.

- [ ] **Step 1: Viết test cho hàm tính điểm bắt đầu gia hạn**

Thêm vào cuối `services/borrow-service/test/membership-dates.test.js`:

```javascript
const { resolveRenewalStart } = require('../src/services/membership.service');

test('resolveRenewalStart extends from today when current membership already expired', () => {
  const today = new Date('2026-09-04T00:00:00.000Z');
  const expiredEnd = new Date('2026-01-01T00:00:00.000Z');
  const start = resolveRenewalStart(expiredEnd, today);
  assert.equal(start.toISOString(), today.toISOString());
});

test('resolveRenewalStart extends from the current end_date when membership is still active', () => {
  const today = new Date('2026-09-04T00:00:00.000Z');
  const futureEnd = new Date('2026-12-01T00:00:00.000Z');
  const start = resolveRenewalStart(futureEnd, today);
  assert.equal(start.toISOString(), futureEnd.toISOString());
});

test('resolveRenewalStart extends from today when there is no prior end_date', () => {
  const today = new Date('2026-09-04T00:00:00.000Z');
  const start = resolveRenewalStart(null, today);
  assert.equal(start.toISOString(), today.toISOString());
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL (hàm chưa tồn tại)**

Run: `cd services/borrow-service && node --test test/membership-dates.test.js`
Expected: FAIL với lỗi `resolveRenewalStart is not a function`.

- [ ] **Step 3: Thêm `resolveRenewalStart` vào `membership.service.js`**

Trong `services/borrow-service/src/services/membership.service.js`, thêm hàm và export:

```javascript
function resolveRenewalStart(currentEndDate, today = new Date()) {
  if (!currentEndDate) return today;
  const end = currentEndDate instanceof Date ? currentEndDate : new Date(currentEndDate);
  return end.getTime() > today.getTime() ? end : today;
}

module.exports = {
  resolveActiveMembership,
  computeMembershipEndDate,
  resolveRenewalStart,
  DEFAULT_MEMBERSHIP_DURATION_DAYS,
};
```

- [ ] **Step 4: Chạy lại test để xác nhận PASS**

Run: `cd services/borrow-service && node --test test/membership-dates.test.js`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Thêm controller `renewMembership`**

Trong `services/borrow-service/src/controllers/customer.controller.js`, cập nhật import:

```javascript
const { resolveActiveMembership, computeMembershipEndDate, resolveRenewalStart, DEFAULT_MEMBERSHIP_DURATION_DAYS } = require('../services/membership.service');
```

Thêm hàm mới cạnh `getActiveMembership` (sau hàm đó):

```javascript
async function renewMembership(req, res) {
  const id = parseId(req.params.id);
  if (!id || !isUuid(id)) {
    return res.status(400).json({ message: 'Invalid customer id' });
  }

  const durationDays = req.body?.duration_days == null
    ? DEFAULT_MEMBERSHIP_DURATION_DAYS
    : Number(req.body.duration_days);
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    return res.status(400).json({ message: 'duration_days must be a positive number' });
  }

  try {
    const customer = await prisma.customers.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const currentMembership = await prisma.customer_memberships.findFirst({
      where: { customer_id: id },
      orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
    });

    const planId = req.body?.plan_id ? String(req.body.plan_id) : currentMembership?.plan_id;
    if (!planId) {
      return res.status(400).json({ message: 'plan_id is required when the customer has no prior membership' });
    }

    const plan = await prisma.membership_plans.findUnique({ where: { id: planId } });
    if (!plan || !plan.is_active) {
      return res.status(404).json({ message: 'Membership plan not found or inactive' });
    }

    const startDate = resolveRenewalStart(currentMembership?.end_date || null);
    const endDate = computeMembershipEndDate(startDate, durationDays);

    const membership = await prisma.$transaction(async (tx) => {
      const created = await tx.customer_memberships.create({
        data: {
          customer_id: id,
          plan_id: plan.id,
          card_number: generateCardNumber(id),
          start_date: startDate,
          end_date: endDate,
          status: 'ACTIVE',
          note: `Renewed from membership ${currentMembership?.card_number || 'N/A'}`,
        },
      });

      await writeAuditLog(tx, {
        actor_user_id: req.user?.id || null,
        action_name: 'RENEW_CUSTOMER_MEMBERSHIP',
        entity_type: 'CUSTOMER_MEMBERSHIP',
        entity_id: created.id,
        before_data: currentMembership ? { end_date: currentMembership.end_date, status: currentMembership.status } : null,
        after_data: { end_date: created.end_date, plan_id: created.plan_id, card_number: created.card_number },
      });

      return created;
    });

    return res.status(201).json({
      data: {
        membership_id: membership.id,
        card_number: membership.card_number,
        plan_id: membership.plan_id,
        start_date: membership.start_date,
        end_date: membership.end_date,
      },
    });
  } catch (error) {
    console.error('renewMembership error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
```

Thêm `renewMembership` vào `module.exports` của file này (tìm khối export hiện có và thêm tên hàm vào danh sách).

- [ ] **Step 6: Đăng ký route**

Trong `services/borrow-service/src/routes/customer.routes.js`, thêm vào import:

```javascript
const {
  listCustomers,
  createCustomer,
  getCustomerById,
  updateCustomer,
  getActiveMembership,
  renewMembership,
  getMyProfile,
  updateMyProfile,
  getMyMembership,
} = require('../controllers/customer.controller');
```

Thêm route ngay sau dòng `router.get('/:id/membership/active', ...)`:

```javascript
router.post('/:id/membership/renew', authorizeBorrowAdminWrite, renewMembership);
```

- [ ] **Step 7: Xác minh thủ công bằng curl (cần stack Docker đang chạy)**

Run:
```bash
docker compose up -d
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"username":"hung","password":"123456"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).data.token")
CUSTOMER_ID="<id của customers[6] — lấy qua GET /borrow/customers>"
curl -s -X POST "http://localhost:3000/borrow/customers/$CUSTOMER_ID/membership/renew" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```
Expected: HTTP 201, body có `end_date` là khoảng 365 ngày kể từ hôm nay.

- [ ] **Step 8: Commit**

```bash
git add services/borrow-service/src/services/membership.service.js services/borrow-service/src/controllers/customer.controller.js services/borrow-service/src/routes/customer.routes.js services/borrow-service/test/membership-dates.test.js
git commit -m "feat(borrow): add membership renewal endpoint for staff"
```

---

## Task 3: Gỡ ảo giác thanh toán — thanh toán phạt & nạp ví tự phục vụ

**Files:**
- Modify: `services/borrow-service/src/routes/my.routes.js`
- Modify: `apps/web/src/services/customer-borrow.ts`
- Modify: `apps/web/src/components/pages/customer/fines.tsx`
- Modify: `apps/web/src/components/pages/customer/_shared/fine-card.tsx`
- Modify: `apps/web/src/components/pages/customer/_shared/fine-item.tsx`
- Delete: `apps/web/src/components/pages/customer/payment-result.tsx`

**Interfaces:**
- Consumes: không phụ thuộc task nào trước.
- Produces: không có interface mới cho task khác — đây là gỡ bỏ có chủ đích.

**Vấn đề:** `payMyFine` ghi thẳng `fine_payments` với `status: 'PAID'` không qua bất kỳ cổng thanh toán nào — khách bấm nút là tự xóa nợ. `topupMyAccount` cộng thẳng tiền vào ví không cần xác minh gì — "tạo tiền từ hư không". `getMyMomoPaymentStatus` chỉ đọc lại dòng vừa ghi và luôn trả `PAID`. `payment-result.tsx` không được route tới bởi bất kỳ đâu — code chết. Việc thanh toán phạt THẬT đã có sẵn ở phía nhân viên qua `POST /borrow/fines/:id/payments` (`apps/web/src/components/pages/borrow-fines.tsx`) — không cần dựng thêm gì, chỉ cần thôi giả vờ có một cổng thanh toán tự phục vụ phía khách.

- [ ] **Step 1: Gỡ 3 route tự phục vụ khỏi backend**

Mở `services/borrow-service/src/routes/my.routes.js`, xóa 3 dòng:

```javascript
router.post('/fines/payments', payMyFine);
router.get('/payments/momo/:orderId', getMyMomoPaymentStatus);
```

(giữ nguyên dòng `router.get('/fines', getMyFines);` — chỉ xóa dòng POST payments và GET momo status). Cũng xóa `payMyFine` và `getMyMomoPaymentStatus` khỏi khối import ở đầu file. Xóa dòng:

```javascript
router.post('/account/topup', topupMyAccount);
```

và xóa `topupMyAccount` khỏi import. Giữ nguyên `router.get('/account', getMyAccount);` và `router.get('/account/ledger', getMyAccountLedger);` (chỉ xem, không tự nạp).

Trong `services/borrow-service/src/controllers/my.controller.js`, thêm một dòng comment ngay trước hàm `payMyFine`, `topupMyAccount`, `getMyMomoPaymentStatus` (không xóa hàm — chỉ đánh dấu không còn route nào gọi tới):

```javascript
// NOTE: không còn route nào gọi hàm này — thanh toán phạt và nạp ví tự phục vụ đã bị gỡ
// vì hệ thống chưa tích hợp cổng thanh toán thật (xem finding CUST-01/LIB-02).
// Việc ghi nhận thanh toán phạt thật do nhân viên thực hiện qua POST /borrow/fines/:id/payments.
```

- [ ] **Step 2: Gỡ 3 hàm khỏi service phía frontend**

Mở `apps/web/src/services/customer-borrow.ts`, xóa 3 hàm `payFine`, `getMomoPaymentStatus`, `topupMyAccount` (dòng 96-104 và hàm `topupMyAccount` nếu nằm gần đó — tìm bằng grep `topupMyAccount` trong file để lấy đúng vị trí trước khi xóa).

- [ ] **Step 3: Viết lại `FineItem` thành hiển thị thông tin, không còn nút thanh toán**

Mở `apps/web/src/components/pages/customer/_shared/fine-item.tsx`, thay toàn bộ nội dung:

```tsx
import { formatCurrencyVnd, formatDateTime } from './customer-format';
import { StatusBadge } from './status-badge';

interface FineItemProps {
  fine: any;
}

export function FineItem({ fine }: FineItemProps) {
  const paid = (fine?.fine_payments || []).reduce((sum: number, row: any) => sum + Number(row?.amount || 0), 0);
  const remaining = Math.max(0, Number(fine?.amount || 0) - Number(fine?.waived_amount || 0) - paid);
  const status = String(fine?.status || '').toUpperCase();
  const isHighRemaining = remaining >= 500000;

  const toneClassName = status === 'UNPAID'
    ? 'border-rose-200 bg-rose-50/60'
    : status === 'PARTIALLY_PAID'
      ? 'border-amber-200 bg-amber-50/60'
      : status === 'PAID' || status === 'WAIVED'
        ? 'border-emerald-200 bg-emerald-50/50'
        : 'border-slate-200 bg-white';

  return (
    <div className={`rounded-[12px] border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] ${toneClassName}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[13px] text-slate-900" style={{ fontWeight: 700 }}>{fine.fine_type}</div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.04em] text-slate-400">Trạng thái phạt</div>
          <div className="mt-1 text-[12px] text-slate-500">Ngày phát hành: {formatDateTime(fine.issued_at)}</div>
          <div className="mt-1"><StatusBadge status={fine.status} /></div>
        </div>
        <div className="text-right text-[12px] text-slate-600">
          <div>Tổng: {formatCurrencyVnd(fine.amount)}</div>
          <div className={isHighRemaining ? 'text-rose-700' : ''} style={{ fontWeight: 700 }}>Còn lại: {formatCurrencyVnd(remaining)}</div>
        </div>
      </div>

      {remaining > 0 ? (
        <div className="mt-3 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] text-slate-600">
          Vui lòng thanh toán khoản phạt này tại quầy thư viện. Nhân viên sẽ ghi nhận thanh toán vào hệ thống.
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Cập nhật `FineCard` khớp props mới**

Mở `apps/web/src/components/pages/customer/_shared/fine-card.tsx`, thay toàn bộ nội dung:

```tsx
import { FineItem } from './fine-item';

interface FineCardProps {
  fine: any;
}

export function FineCard({ fine }: FineCardProps) {
  return <FineItem fine={fine} />;
}
```

- [ ] **Step 5: Viết lại `fines.tsx` — gỡ nút thanh toán và nạp ví**

Mở `apps/web/src/components/pages/customer/fines.tsx`, thay toàn bộ nội dung:

```tsx
import { useEffect, useState } from 'react';
import { ReceiptText, RefreshCw, Wallet } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { formatCurrencyVnd, formatDateTime } from './_shared/customer-format';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { FineCard } from './_shared/fine-card';

export function CustomerFinesPage() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountSnapshot, setAccountSnapshot] = useState<any | null>(null);
  const [ledgerRows, setLedgerRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadFines = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await customerBorrowService.getMyFines();
      setData(response?.data || null);

      const [accountResponse, ledgerResponse] = await Promise.all([
        customerBorrowService.getMyAccount(),
        customerBorrowService.getMyAccountLedger({ page: 1, pageSize: 5 }),
      ]);

      setAccountSnapshot(accountResponse?.data || null);
      setLedgerRows(Array.isArray(ledgerResponse?.data) ? ledgerResponse.data : []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được tiền phạt'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadFines(); }, []);

  const totalFine = Number(data?.total_fine_balance || 0);
  const walletBalance = Number(accountSnapshot?.available_balance || 0);

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-100 to-red-50 flex items-center justify-center border border-rose-200/40">
            <ReceiptText className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Tiền phạt & Ví của tôi</h1>
            <p className="text-[13px] text-muted-foreground">Xem số dư phạt và lịch sử giao dịch ví</p>
          </div>
        </div>
        <button
          onClick={() => void loadFines()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 rounded-xl border border-input bg-white px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </button>
      </div>

      {loading ? (
        <LoadingOverlay />
      ) : error ? (
        <EmptyState variant="error" title="Không tải được tiền phạt" description={error} action={<button onClick={() => void loadFines()} className="text-primary font-medium hover:underline">Thử lại</button>} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Tiền phạt còn lại" value={formatCurrencyVnd(totalFine)} icon={ReceiptText} variant={totalFine > 0 ? 'danger' : 'success'} />
            <StatCard label="Số dư ví" value={formatCurrencyVnd(walletBalance)} icon={Wallet} variant={walletBalance < 100000 ? 'warning' : 'success'} />
            <StatCard label="Số phiếu phạt" value={(data?.fines || []).length} icon={ReceiptText} variant="default" />
            <StatCard label="Lần thanh toán" value={(data?.fine_payments || []).length} icon={ReceiptText} variant="info" />
          </div>

          {totalFine > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-4 text-[13px] text-amber-800">
              Bạn còn <strong>{formatCurrencyVnd(totalFine)}</strong> tiền phạt chưa thanh toán. Vui lòng đến quầy thư viện để thanh toán trực tiếp — nhân viên sẽ ghi nhận vào hệ thống ngay khi bạn thanh toán xong.
            </div>
          ) : null}

          <SectionCard title="Phiếu phạt" subtitle={`${(data?.fines || []).length} phiếu`}>
            {(data?.fines || []).length === 0 ? (
              <EmptyState variant="no-data" title="Chưa có phiếu phạt" description="Bạn không có tiền phạt. Tiếp tục đọc sách nhé!" />
            ) : (
              <div className="space-y-3">
                {(data?.fines || []).map((fine: any) => (
                  <FineCard key={fine.id} fine={fine} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Giao dịch ví gần đây" subtitle="Giao dịch mới nhất">
            {ledgerRows.length === 0 ? (
              <EmptyState variant="inbox" title="Chưa có giao dịch" description="Lịch sử giao dịch ví sẽ hiển thị ở đây." />
            ) : (
              <div className="space-y-2">
                {ledgerRows.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground truncate">{entry.entry_type || entry.reference_type || 'Entry'}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDateTime(entry.created_at)}</p>
                    </div>
                    <span className={`text-[14px] font-bold shrink-0 ml-3 ${Number(entry.amount) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {Number(entry.amount) >= 0 ? '+' : ''}{formatCurrencyVnd(Number(entry.amount))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Xóa trang mồ côi**

Run: `rm apps/web/src/components/pages/customer/payment-result.tsx`

- [ ] **Step 7: Build và kiểm tra thủ công**

Run: `pnpm --filter web build`
Expected: build thành công, không lỗi TypeScript về import thiếu (xác nhận không còn nơi nào import `payment-result`, `payFine`, `getMomoPaymentStatus`, `topupMyAccount`).

Mở dev server (`pnpm --filter web dev`), đăng nhập khách hàng có phạt (ví dụ tài khoản gắn với `customers[6]` sau Task 1), vào `/customer/fines`.
Expected: thấy banner vàng nhắc thanh toán tại quầy, không còn ô nhập số tiền nạp ví, không còn nút "Trả 50%"/"Trả đầy đủ".

- [ ] **Step 8: Commit**

```bash
git add services/borrow-service/src/routes/my.routes.js services/borrow-service/src/controllers/my.controller.js apps/web/src/services/customer-borrow.ts apps/web/src/components/pages/customer/fines.tsx apps/web/src/components/pages/customer/_shared/fine-card.tsx apps/web/src/components/pages/customer/_shared/fine-item.tsx
git rm apps/web/src/components/pages/customer/payment-result.tsx
git commit -m "fix(customer): remove fake self-service fine payment and wallet top-up"
```

---

## Task 4: Gỡ tính năng "Tin nhắn nội bộ" khỏi mọi lối vào

**Files:**
- Modify: `apps/web/src/lib/nav-groups.ts`
- Modify: `apps/web/src/components/topbar.tsx`
- Modify: `apps/web/src/app/routes.ts`

**Interfaces:**
- Consumes: không phụ thuộc task nào trước.
- Produces: không có interface mới — `components/pages/messages/` được giữ nguyên trên đĩa (không xóa thư mục), chỉ gỡ 3 điểm truy cập, để dành sẵn cho việc bật lại khi có backend thật (xem roadmap sub-plan "Nền tảng").

**Vấn đề:** `/messages` render dữ liệu 100% giả từ `mock-data.ts` giữ trong bộ nhớ (tải lại trang là mất tin nhắn). Có 3 lối vào: nhóm sidebar "Liên lạc nội bộ", icon trên topbar, và route đăng ký trong router.

- [ ] **Step 1: Gỡ nhóm sidebar**

Mở `apps/web/src/lib/nav-groups.ts`, xóa toàn bộ khối nhóm (dòng 28-34):

```javascript
  {
    labelKey: "sidebar.group.communication",
    color: "text-indigo-400",
    dotColor: "bg-indigo-400",
    items: [
      { to: "/messages", icon: MessagesSquare, labelKey: "sidebar.messages", access: ROUTE_ACCESS.messaging, activeColor: "from-indigo-500/15 to-blue-500/10", textColor: "text-indigo-600", iconBg: "bg-indigo-500/10" },
    ],
  },
```

Sửa dòng import ở đầu file, xóa `MessagesSquare` khỏi danh sách import từ `lucide-react` (dòng 6) nếu không còn nơi nào khác trong file dùng nó — kiểm tra bằng `grep -n MessagesSquare apps/web/src/lib/nav-groups.ts` trước khi xóa, chỉ xóa nếu chỉ còn 1 kết quả (chính dòng import).

- [ ] **Step 2: Gỡ icon trên topbar**

Mở `apps/web/src/components/topbar.tsx`, xóa khối (dòng 194-196):

```tsx
        <NavLink to="/messages" className="w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-140 text-slate-500 dark:text-slate-400" title={t('sidebar.messages')} aria-label={t('sidebar.messages')}>
          <MessagesSquare className="w-4 h-4" />
        </NavLink>
```

Xóa `MessagesSquare` khỏi import `lucide-react` ở dòng 1 của file này (kiểm tra bằng `grep -n MessagesSquare apps/web/src/components/topbar.tsx` — chỉ xóa nếu không còn dùng ở đâu khác trong file).

- [ ] **Step 3: Gỡ route**

Mở `apps/web/src/app/routes.ts`, xóa dòng:

```javascript
      { path: "messages", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.messaging), lazy: { Component: async () => (await import("@/components/pages/messages")).MessagesPage } },
```

- [ ] **Step 4: Build và kiểm tra thủ công**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: cả hai lệnh thành công, không cảnh báo import không dùng tới.

Mở dev server, đăng nhập ADMIN, xác nhận sidebar không còn nhóm "Liên lạc nội bộ", topbar không còn icon tin nhắn, và điều hướng thẳng tới `/messages` trả về trang 404 (`NotFoundPage`) thay vì màn hình chat giả.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/nav-groups.ts apps/web/src/components/topbar.tsx apps/web/src/app/routes.ts
git commit -m "fix(web): remove internal messaging entry points backed by mock data"
```

---

## Task 5: Thêm tên sách vào thẻ đặt trước và phiếu mượn của khách

**Files:**
- Create: `services/inventory-service/src/controllers/borrow-integration.controller.js` (thêm hàm `getVariantDetails` vào file có sẵn)
- Modify: `services/inventory-service/src/routes/borrow-integration.routes.js`
- Modify: `services/borrow-service/src/services/inventory-integration.service.js`
- Modify: `services/borrow-service/src/controllers/my.controller.js` (hàm `getMyReservations`, `getMyLoans`)
- Modify: `apps/web/src/components/pages/customer/_shared/reservation-item.tsx`
- Modify: `apps/web/src/components/pages/customer/_shared/loan-item.tsx`

**Interfaces:**
- Consumes: `BookCoverPlaceholder` component có sẵn tại `apps/web/src/components/pages/customer/_shared/book-cover-placeholder.tsx` (props `{category, title, imageUrl}`).
- Produces: `getVariantDetails({ variantIds, authHeader })` — hàm mới export từ `services/borrow-service/src/services/inventory-integration.service.js`, trả về `Array<{ id, title, author, cover_image_url }>`.

**Vấn đề:** `getMyReservations`/`getMyLoans` chỉ query `loan_reservations`/`loan_transactions` trong `borrow_db` mà không `include` gì — tên sách nằm ở `inventory_db` (bảng `books`/`book_variants`), một database khác hoàn toàn. Thẻ hiển thị chỉ có `reservation_number`/`loan_number`, ngày, badge trạng thái — độc giả không biết đặt trước nào là cuốn nào.

- [ ] **Step 1: Thêm endpoint tra cứu chi tiết variant hàng loạt ở inventory-service**

Mở `services/inventory-service/src/controllers/borrow-integration.controller.js`, thêm hàm mới cạnh `searchBorrowVariants`:

```javascript
async function getVariantDetails(req, res) {
  const idsParam = String(req.query.ids || '').trim();
  if (!idsParam) {
    return res.json({ data: [] });
  }

  const ids = idsParam.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 200);
  if (ids.length === 0) {
    return res.json({ data: [] });
  }

  try {
    const variants = await prisma.book_variants.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        cover_image_url: true,
        books: {
          select: {
            title: true,
            book_authors: {
              select: { authors: { select: { full_name: true } } },
              orderBy: { author_order: 'asc' },
              take: 1,
            },
          },
        },
      },
    });

    return res.json({
      data: variants.map((variant) => ({
        id: variant.id,
        title: variant.books?.title || 'Không rõ tên sách',
        author: variant.books?.book_authors?.[0]?.authors?.full_name || null,
        cover_image_url: variant.cover_image_url || null,
      })),
    });
  } catch (error) {
    console.error('getVariantDetails error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
```

Thêm `getVariantDetails` vào `module.exports` cuối file.

- [ ] **Step 2: Đăng ký route**

Mở `services/inventory-service/src/routes/borrow-integration.routes.js`, thêm vào import:

```javascript
const {
  searchBorrowVariants,
  listBorrowWarehouses,
  getAvailability,
  reserveFromBorrow,
  releaseBorrowReservation,
  consumeBorrowReservation,
  returnBorrowedLoan,
  getVariantDetails,
} = require('../controllers/borrow-integration.controller');
```

Thêm route ngay sau `router.get('/variants/search', ...)`:

```javascript
router.get('/variants/details', authorizeAnyPermission(['borrow.read', 'borrow.write', 'inventory.stock.read']), getVariantDetails);
```

- [ ] **Step 3: Thêm hàm gọi sang inventory-service từ borrow-service**

Mở `services/borrow-service/src/services/inventory-integration.service.js`, thêm hàm mới cạnh `checkAvailability`:

```javascript
async function getVariantDetails({ variantIds, authHeader }) {
  const uniqueIds = [...new Set((variantIds || []).filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const result = await requestInventory(
    `/api/borrow-integration/variants/details?ids=${uniqueIds.map(encodeURIComponent).join(',')}`,
    {
      method: 'GET',
      headers: {
        Authorization: getInventoryAuthHeader(authHeader),
      },
    }
  );

  return Array.isArray(result?.data) ? result.data : [];
}
```

Cập nhật `module.exports` ở cuối file, thêm `getVariantDetails`:

```javascript
module.exports = {
  checkAvailability,
  reserveStock,
  releaseReservation,
  consumeReservation,
  returnBorrowedStock,
  getVariantDetails,
};
```

- [ ] **Step 4: Làm giàu dữ liệu trong `getMyReservations`**

Mở `services/borrow-service/src/controllers/my.controller.js`, thêm import ở đầu file:

```javascript
const { getVariantDetails } = require('../services/inventory-integration.service');
```

Sửa hàm `getMyReservations`, thay đoạn `return res.json({ ... })` cuối hàm:

```javascript
async function getMyReservations(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const pagination = parsePagination(req.query);
    const status = String(req.query?.status || '').trim();

    const where = {
      customer_id: customer.id,
      ...(status ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.loan_reservations.findMany({
        where,
        orderBy: [{ reserved_at: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.loan_reservations.count({ where }),
    ]);

    let variantById = new Map();
    try {
      const variants = await getVariantDetails({
        variantIds: items.map((item) => item.variant_id),
        authHeader: req.headers.authorization,
      });
      variantById = new Map(variants.map((v) => [v.id, v]));
    } catch (enrichError) {
      console.error('getMyReservations: failed to enrich book titles:', enrichError);
    }

    const enrichedItems = items.map((item) => ({
      ...item,
      book_title: variantById.get(item.variant_id)?.title || null,
      book_author: variantById.get(item.variant_id)?.author || null,
      book_cover_url: variantById.get(item.variant_id)?.cover_image_url || null,
    }));

    return res.json({
      data: enrichedItems,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize) || 1,
      },
    });
  } catch (error) {
    console.error('getMyReservations error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
```

Chú ý: khối `try/catch` bọc riêng lời gọi `getVariantDetails` để nếu inventory-service tạm thời không phản hồi, danh sách đặt trước vẫn hiển thị được (chỉ thiếu tên sách) thay vì cả trang lỗi.

- [ ] **Step 5: Làm giàu dữ liệu trong `getMyLoans`**

Trong cùng file, sửa hàm `getMyLoans` — sau khối `Promise.all` lấy `items`/`total`, thêm enrich cho từng `loan_item` bên trong mỗi loan (một loan có thể có nhiều `loan_items`, mỗi item một `variant_id` khác nhau):

```javascript
async function getMyLoans(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const pagination = parsePagination(req.query);
    const status = String(req.query?.status || '').trim();

    const where = {
      customer_id: customer.id,
      ...(status ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.loan_transactions.findMany({
        where,
        orderBy: [{ borrow_date: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
        include: { loan_items: true },
      }),
      prisma.loan_transactions.count({ where }),
    ]);

    let variantById = new Map();
    try {
      const allVariantIds = items.flatMap((loan) => loan.loan_items.map((li) => li.variant_id));
      const variants = await getVariantDetails({ variantIds: allVariantIds, authHeader: req.headers.authorization });
      variantById = new Map(variants.map((v) => [v.id, v]));
    } catch (enrichError) {
      console.error('getMyLoans: failed to enrich book titles:', enrichError);
    }

    const enrichedItems = items.map((loan) => {
      const enrichedLoanItems = loan.loan_items.map((li) => ({
        ...li,
        book_title: variantById.get(li.variant_id)?.title || null,
        book_cover_url: variantById.get(li.variant_id)?.cover_image_url || null,
      }));
      return {
        ...loan,
        loan_items: enrichedLoanItems,
        primary_book_title: enrichedLoanItems[0]?.book_title || null,
        extra_item_count: Math.max(0, enrichedLoanItems.length - 1),
      };
    });
```

Giữ nguyên phần còn lại của hàm phía dưới (response `meta`) — chỉ thay biến `items` bằng `enrichedItems` trong `data: enrichedItems`.

- [ ] **Step 6: Hiển thị tên sách trên thẻ đặt trước**

Mở `apps/web/src/components/pages/customer/_shared/reservation-item.tsx`, thêm import và sửa phần render đầu thẻ:

```tsx
import { formatDateTime } from './customer-format';
import { StatusBadge } from './status-badge';
import { QRCode } from '@/components/ui/qr-code';
import { BookCoverPlaceholder } from './book-cover-placeholder';
import { useState } from 'react';

interface ReservationItemProps {
  item: any;
  onCancel: (id: string) => void;
}

export function ReservationItem({ item, onCancel }: ReservationItemProps) {
  const [mountedAt] = useState(() => Date.now());
  const status = String(item.status || '').toUpperCase();
  const canCancel = status === 'PENDING' || status === 'CONFIRMED' || status === 'READY_FOR_PICKUP';
  const isReady = status === 'READY_FOR_PICKUP';
  const pickupCode = String(item.pickup_code || '').trim();
  const expiresAt = item?.expires_at ? new Date(item.expires_at) : null;
  const hoursToExpire = expiresAt ? Math.floor((expiresAt.getTime() - mountedAt) / (60 * 60 * 1000)) : null;
  const isExpiringSoon = status === 'PENDING' && hoursToExpire !== null && hoursToExpire >= 0 && hoursToExpire <= 72;
  const bookTitle = item.book_title || 'Sách chưa xác định';

  return (
    <div className={`rounded-[12px] border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] ${isReady ? 'border-cyan-200 bg-cyan-50/60' : isExpiringSoon ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3 min-w-0">
          <div className="w-12 shrink-0">
            <BookCoverPlaceholder title={bookTitle} imageUrl={item.book_cover_url} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] text-slate-900 truncate" style={{ fontWeight: 700 }}>{bookTitle}</div>
            {item.book_author ? <div className="text-[11px] text-slate-500 truncate">{item.book_author}</div> : null}
            <div className="mt-1 text-[11px] text-slate-400">{item.reservation_number || 'Phiếu đặt trước'}</div>
            <div className="mt-1 text-[12px] text-slate-500">Ngày đặt: {formatDateTime(item.reserved_at)}</div>
            <div className={`text-[12px] ${isExpiringSoon ? 'text-amber-700' : 'text-slate-500'}`} style={{ fontWeight: isExpiringSoon ? 600 : 500 }}>Hết hạn: {formatDateTime(item.expires_at)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={item.status} />
          <button
            disabled={!canCancel}
            onClick={() => onCancel(item.id)}
            className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 hover:bg-rose-100 disabled:opacity-60"
            style={{ fontWeight: 600 }}
          >
            Hủy
          </button>
        </div>
      </div>

      {isReady && pickupCode ? (
        <div className="mt-4 flex flex-col gap-3 rounded-[10px] border border-cyan-200 bg-white/80 p-3 sm:flex-row sm:items-center">
          <div className="w-fit rounded-[8px] border border-slate-200 bg-white p-2">
            <QRCode value={`SMARTBOOK:PICKUP:${pickupCode}`} size={112} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.04em] text-cyan-700" style={{ fontWeight: 700 }}>Mã nhận sách</div>
            <div className="mt-1 break-all font-mono text-lg text-slate-950" style={{ fontWeight: 800 }}>{pickupCode}</div>
            <div className="mt-1 text-[12px] text-slate-500">Có giá trị đến {formatDateTime(item.pickup_code_expires_at || item.expires_at)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7: Hiển thị tên sách trên phiếu mượn**

Mở `apps/web/src/components/pages/customer/_shared/loan-item.tsx`, thay toàn bộ nội dung:

```tsx
import { formatDateTime } from './customer-format';
import { StatusBadge } from './status-badge';
import { BookCoverPlaceholder } from './book-cover-placeholder';
import { useState } from 'react';

interface LoanItemProps {
  item: any;
  onView: (id: string) => void;
}

export function LoanItem({ item, onView }: LoanItemProps) {
  const [mountedAt] = useState(() => Date.now());
  const status = String(item.status || '').toUpperCase();
  const isOverdue = status === 'OVERDUE';
  const dueDate = item?.due_date ? new Date(item.due_date) : null;
  const remainingDays = dueDate ? Math.ceil((dueDate.getTime() - mountedAt) / (24 * 60 * 60 * 1000)) : null;
  const isDueSoon = !isOverdue && remainingDays !== null && remainingDays >= 0 && remainingDays <= 3;
  const bookTitle = item.primary_book_title || 'Sách chưa xác định';
  const extraCount = Number(item.extra_item_count || 0);

  return (
    <div className={`rounded-[12px] border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] ${isOverdue ? 'border-rose-200 bg-rose-50/60' : isDueSoon ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3 min-w-0">
          <div className="w-12 shrink-0">
            <BookCoverPlaceholder title={bookTitle} imageUrl={item.loan_items?.[0]?.book_cover_url} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] text-slate-900 truncate" style={{ fontWeight: 700 }}>
              {bookTitle}{extraCount > 0 ? ` (+${extraCount} khác)` : ''}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">{item.loan_number || 'Phiếu mượn'}</div>
            <div className="mt-1 text-[12px] text-slate-500">Ngày mượn: {formatDateTime(item.borrow_date)}</div>
            <div className={`text-[12px] ${isOverdue ? 'text-rose-700' : isDueSoon ? 'text-amber-700' : 'text-slate-500'}`} style={{ fontWeight: isOverdue || isDueSoon ? 600 : 500 }}>
              Hạn trả: {formatDateTime(item.due_date)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={item.status} />
          <button
            onClick={() => onView(item.id)}
            className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700 hover:bg-slate-50"
            style={{ fontWeight: 600 }}
          >
            Xem chi tiết
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Build và xác minh thủ công qua toàn bộ chuỗi (cần Docker stack đang chạy)**

Run: `pnpm --filter web build`
Expected: build thành công.

Run: `docker compose up -d --build inventory-service borrow-service api-gateway web`
Mở `/customer/reservations` và `/customer/loans` trên trình duyệt với một khách có đặt trước/phiếu mượn thật.
Expected: mỗi thẻ hiển thị ảnh bìa (hoặc placeholder theo thể loại) và tên sách thật, không còn chỉ có mã phiếu.

- [ ] **Step 9: Commit**

```bash
git add services/inventory-service/src/controllers/borrow-integration.controller.js services/inventory-service/src/routes/borrow-integration.routes.js services/borrow-service/src/services/inventory-integration.service.js services/borrow-service/src/controllers/my.controller.js apps/web/src/components/pages/customer/_shared/reservation-item.tsx apps/web/src/components/pages/customer/_shared/loan-item.tsx
git commit -m "feat(customer): show book title and cover on reservation and loan cards"
```

---

## Task 6: Thêm lối vào cho "Nhập kho thông minh", gỡ route mồ côi putaway-execute

**Files:**
- Modify: `apps/web/src/lib/nav-groups.ts`
- Delete: `apps/web/src/components/pages/putaway-execute.tsx`
- Modify: `apps/web/src/app/routes.ts`

**Interfaces:**
- Consumes: không phụ thuộc task nào trước.
- Produces: không có interface mới.

**Vấn đề:** `/receiving-smart` (686 dòng, tính năng nhập kho có AI hỗ trợ) có route đầy đủ nhưng không nằm trong sidebar — chỉ vào được bằng cách tự gõ URL. `/putaway/:id/execute` là file 5 dòng redirect về `/receiving-putaway` và làm mất `:id`; xác minh không có bất kỳ nơi nào trong toàn bộ `apps/web/src` liên kết tới route này, và `receiving-putaway.tsx` không đọc bất kỳ tham số nào để "tiếp tục" một phiếu cụ thể — nên vá lại redirect để giữ `:id` cũng không giải quyết được gì. Xóa hẳn route chết này trung thực hơn là vá một thứ không ai dùng.

- [ ] **Step 1: Thêm "Nhập kho thông minh" vào sidebar**

Mở `apps/web/src/lib/nav-groups.ts`, tìm nhóm `sidebar.group.purchasing`, thêm mục mới ngay sau `/ai-import`:

```javascript
      { to: "/receiving-smart", icon: Sparkles, labelKey: "sidebar.receiving_smart", access: ROUTE_ACCESS.managerStockDecision, activeColor: "from-cyan-500/15 to-teal-500/10", textColor: "text-cyan-700", iconBg: "bg-cyan-500/10" },
```

`Sparkles` đã có sẵn trong import của file (dùng cho `ai-import`) nên không cần thêm import mới.

- [ ] **Step 2: Thêm khóa dịch cho nhãn mới**

Mở `apps/web/src/lib/i18n.tsx`, thêm vào khối `vi` cạnh `'sidebar.ai_import'`:

```javascript
    'sidebar.receiving_smart': 'Nhập kho thông minh',
```

Nếu file có khối `en` tương ứng (kiểm tra bằng `grep -n "'sidebar.ai_import'" apps/web/src/lib/i18n.tsx` để xem có bao nhiêu chỗ), thêm cùng key vào khối đó với giá trị `'Smart Receiving'`.

- [ ] **Step 3: Xóa route và file mồ côi**

Mở `apps/web/src/app/routes.ts`, xóa dòng:

```javascript
      { path: "putaway/:id/execute", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/putaway-execute")).PutawayExecutePage } },
```

Run: `rm apps/web/src/components/pages/putaway-execute.tsx`

- [ ] **Step 4: Build và kiểm tra thủ công**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: cả hai thành công.

Mở dev server, đăng nhập WAREHOUSE_MANAGER, xác nhận sidebar nhóm "Mua hàng & NCC" có thêm mục "Nhập kho thông minh" dẫn đúng tới trang 686 dòng đã có sẵn.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/nav-groups.ts apps/web/src/lib/i18n.tsx apps/web/src/app/routes.ts
git rm apps/web/src/components/pages/putaway-execute.tsx
git commit -m "fix(web): surface Smart Receiving in sidebar, remove dead putaway-execute route"
```

---

## Task 7: Thêm lớp phòng thủ lỗi (Error Boundary) cho toàn ứng dụng

**Files:**
- Create: `apps/web/src/components/route-error-boundary.tsx`
- Modify: `apps/web/src/components/layout.tsx`
- Modify: `apps/web/src/components/pages/customer/layout.tsx`
- Modify: `apps/web/src/app/routes.ts`

**Interfaces:**
- Consumes: `authService.getCurrentUser()`, `getHomePathForUser(user)` từ `apps/web/src/lib/rbac.ts` (đã dùng ở `forbidden.tsx`).
- Produces: `RouteErrorBoundary` (class component, props `{ resetKey: string, children: ReactNode }`) và `RouteErrorPage` (function component, dùng làm `errorElement`) — export từ `apps/web/src/components/route-error-boundary.tsx`.

**Vấn đề:** Không có `ErrorBoundary`/`componentDidCatch`/`getDerivedStateFromError` nào trong 196 file `.tsx`, và không route nào khai báo `errorElement`. Một lỗi render nhỏ (trường dữ liệu null không được phòng thủ) hoặc một lần tải lazy-chunk thất bại giữa lúc mạng chập chờn sẽ đưa cả ứng dụng về màn hình lỗi trần trụi của React Router, mất sidebar/topbar, không có nút thử lại.

Giải pháp có hai lớp: (1) một `RouteErrorBoundary` React thường bọc `<Outlet/>` bên trong layout — bắt lỗi render trong nội dung trang mà vẫn giữ nguyên sidebar/topbar; (2) `errorElement` gắn ở 3 route gốc — bắt lỗi từ loader hoặc từ chính việc tải lazy-chunk thất bại (loại lỗi mà một boundary React thường không chạm tới, vì nó xảy ra ở tầng dữ liệu của router trước khi React kịp render). Lớp (2) hiếm khi kích hoạt hơn lớp (1), nhưng khi kích hoạt sẽ mất luôn sidebar — đây là đánh đổi chấp nhận được vì vẫn tốt hơn hẳn màn hình mặc định hiện tại.

- [ ] **Step 1: Tạo component chung**

Tạo `apps/web/src/components/route-error-boundary.tsx`:

```tsx
import { Component, type ReactNode } from 'react';
import { NavLink, useRouteError, isRouteErrorResponse } from 'react-router';
import { AlertTriangle, Home, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { authService } from '@/services/auth';
import { getHomePathForUser } from '@/lib/rbac';

interface RouteErrorBoundaryProps {
  resetKey: string;
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('RouteErrorBoundary caught a render error:', error, info);
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return <InlineErrorFallback onReload={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}

function InlineErrorFallback({ onReload }: { onReload: () => void }) {
  const user = authService.getCurrentUser();
  const homePath = getHomePathForUser(user);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg rounded-xl border-border/70 shadow-sm">
        <CardContent className="p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-rose-600 dark:text-rose-400">Đã xảy ra lỗi</p>
              <h1 className="mt-2 text-xl font-bold tracking-tight text-foreground">Trang này không tải được</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Đã có lỗi khi hiển thị nội dung. Vui lòng tải lại trang; nếu lỗi vẫn tiếp diễn, hãy quay về trang chủ.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button type="button" onClick={onReload}>
                  <RotateCw className="h-4 w-4" />
                  Tải lại trang
                </Button>
                <Button asChild variant="outline">
                  <NavLink to={homePath}>
                    <Home className="h-4 w-4" />
                    Về trang chủ
                  </NavLink>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function RouteErrorPage() {
  const error = useRouteError();
  const user = authService.getCurrentUser();
  const homePath = getHomePathForUser(user);

  const description = isRouteErrorResponse(error)
    ? `Lỗi ${error.status}: ${error.statusText || 'Không thể tải trang này'}`
    : 'Đã có lỗi ngoài dự kiến khi tải trang. Vui lòng tải lại trang; nếu lỗi vẫn tiếp diễn, hãy quay về trang chủ.';

  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-lg rounded-xl border-border/70 shadow-sm">
        <CardContent className="p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-rose-600 dark:text-rose-400">Đã xảy ra lỗi</p>
              <h1 className="mt-2 text-xl font-bold tracking-tight text-foreground">Không thể tải ứng dụng</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button type="button" onClick={() => window.location.reload()}>
                  <RotateCw className="h-4 w-4" />
                  Tải lại trang
                </Button>
                <Button asChild variant="outline">
                  <NavLink to={homePath}>
                    <Home className="h-4 w-4" />
                    Về trang chủ
                  </NavLink>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Bọc `<Outlet/>` trong layout nội bộ**

Mở `apps/web/src/components/layout.tsx`, thay toàn bộ nội dung:

```tsx
import { Outlet, useLocation } from "react-router";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { AIChatbot } from "./ai-chatbot";
import { useState } from "react";
import { SocketProvider } from "@/lib/socket";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { RouteErrorBoundary } from "./route-error-boundary";

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const currentUser = authService.getCurrentUser();
  const location = useLocation();
  // ADMIN/WAREHOUSE_MANAGER have the dedicated /ai-assistant page instead of the floating widget.
  const hasDedicatedAssistant = canAccess(currentUser, ROUTE_ACCESS.aiAssistant);

  return (
    <SocketProvider>
      <div className="h-screen flex overflow-hidden bg-background">
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 overflow-y-auto scroll-smooth">
            <RouteErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </RouteErrorBoundary>
          </main>
        </div>
        {!hasDedicatedAssistant && <AIChatbot />}
      </div>
    </SocketProvider>
  );
}
```

- [ ] **Step 3: Bọc `<Outlet/>` trong layout khách hàng**

Mở `apps/web/src/components/pages/customer/layout.tsx`, thay toàn bộ nội dung:

```tsx
import { Outlet, useLocation } from 'react-router';
import { CustomerAppShell } from './_shared/customer-app-shell';
import { SocketProvider } from '@/lib/socket';
import { RouteErrorBoundary } from '@/components/route-error-boundary';

export function CustomerLayout() {
  const location = useLocation();

  return (
    <SocketProvider>
      <CustomerAppShell>
        <RouteErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </RouteErrorBoundary>
      </CustomerAppShell>
    </SocketProvider>
  );
}
```

- [ ] **Step 4: Gắn `errorElement` cho 3 route gốc**

Mở `apps/web/src/app/routes.ts`, thêm import ở đầu file:

```typescript
import { RouteErrorPage } from "@/components/route-error-boundary";
```

Thêm `errorElement: createElement(RouteErrorPage)` vào route object `/` (route có `hydrateFallbackElement`), route `/customer`, và route `/supplier` (không phải route `/supplier/portal/:token` — chỉ route cha `/supplier`). Ví dụ với route `/`:

```typescript
  {
    path: "/",
    loader: requireAuthLoader,
    hydrateFallbackElement,
    errorElement: createElement(RouteErrorPage),
    lazy: { Component: async () => (await import("@/components/layout")).AppLayout },
    children: [
      // ... giữ nguyên toàn bộ children hiện có
```

Áp dụng tương tự cho route `path: '/customer'` và route `path: "/supplier"`.

- [ ] **Step 5: Build và kiểm tra thủ công**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: cả hai thành công.

Kiểm tra thủ công lớp (1): mở dev server, vào bất kỳ trang nội bộ nào, mở DevTools console, tạm thời gõ vào React DevTools hoặc thêm tạm `throw new Error('test')` vào đầu một component trang bất kỳ (ví dụ `catalog.tsx`), tải lại — xác nhận sidebar/topbar vẫn còn, chỉ vùng nội dung hiện thẻ lỗi màu đỏ với nút "Tải lại trang"/"Về trang chủ". Xóa dòng `throw` thử nghiệm sau khi xác nhận.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/route-error-boundary.tsx apps/web/src/components/layout.tsx apps/web/src/components/pages/customer/layout.tsx apps/web/src/app/routes.ts
git commit -m "feat(web): add error boundary around route content and root routes"
```

---

## Task 8: Nối hai nút "Xuất"/"Tải xuống" đang chết vào chức năng thật

**Files:**
- Modify: `apps/web/src/components/pages/orders.tsx`
- Modify: `apps/web/src/components/pages/order-detail.tsx`

**Interfaces:**
- Consumes: `exportToCsv(data, columns, filename)` có sẵn từ `apps/web/src/lib/export-utils.ts`.
- Produces: không có interface mới.

**Vấn đề:** Nút "Xuất" ở `orders.tsx:122-124` và nút "Tải xuống" ở `order-detail.tsx:264-266` là `<button>` không có `onClick` — bấm vào không có phản hồi gì, không toast, không file. Đây là loại lỗi trông giống hệ thống hỏng khi hội đồng bấm thử.

**Lưu ý phạm vi:** Task này chỉ nối nút vào `exportToCsv` hiện có (xuất CSV). Việc font tiếng Việt trong PDF bị lỗi dấu (`jsPDF` dùng font mặc định không hỗ trợ Unicode) là một vấn đề riêng, lớn hơn (cần nhúng file font `.ttf` dạng base64) — nằm trong roadmap sub-plan "Nền tảng & kho vận", không sửa ở đây vì CSV không bị ảnh hưởng bởi lỗi font này.

- [ ] **Step 1: Nối nút "Xuất" trong `orders.tsx`**

Mở `apps/web/src/components/pages/orders.tsx`, thêm import:

```typescript
import { exportToCsv } from "@/lib/export-utils";
```

Thêm hàm xử lý bên trong `OrdersPage`, ngay sau khai báo `filtered` (dùng đúng danh sách đã lọc theo bộ lọc hiện tại của người dùng):

```typescript
  const handleExport = () => {
    exportToCsv(
      filtered.map((r) => ({
        receipt_number: r.receipt_number,
        po_number: r.po_number || '',
        warehouse_name: r.warehouse_name || '',
        item_count: r.item_count,
        total_amount: r.total_amount,
        status: r.status,
        created_at: formatDate(r.created_at),
      })),
      [
        { header: 'Số phiếu', key: 'receipt_number' },
        { header: 'Số PO', key: 'po_number' },
        { header: 'Kho', key: 'warehouse_name' },
        { header: 'Số mặt hàng', key: 'item_count' },
        { header: 'Tổng tiền', key: 'total_amount' },
        { header: 'Trạng thái', key: 'status' },
        { header: 'Ngày tạo', key: 'created_at' },
      ],
      'phieu-nhap-kho',
    );
  };
```

Sửa nút ở dòng 122-124 để gọi hàm này:

```tsx
              <button onClick={handleExport} className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-blue-100 dark:border-blue-500/20 bg-card text-blue-700 dark:text-blue-400 text-[13px] hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all shadow-sm font-medium">
                <Download className="w-3.5 h-3.5" /> Xuất
              </button>
```

- [ ] **Step 2: Nối nút "Tải xuống" trong `order-detail.tsx`**

Mở `apps/web/src/components/pages/order-detail.tsx`, thêm import:

```typescript
import { exportToCsv } from "@/lib/export-utils";
```

Thêm hàm xử lý bên trong component (đặt cạnh các hàm xử lý khác, sau khi `receipt` đã được load — kiểm tra `receipt` không null trước khi export):

```typescript
  const handleDownload = () => {
    if (!receipt) return;
    exportToCsv(
      receipt.items.map((item) => ({
        barcode: item.barcode || '',
        book_title: item.book_title,
        location_code: item.location_code || '',
        quantity: item.quantity,
        actual_quantity: item.actual_quantity ?? '',
        unit_cost: item.unit_cost,
        line_total: item.line_total,
      })),
      [
        { header: 'Mã vạch', key: 'barcode' },
        { header: 'Tên sách', key: 'book_title' },
        { header: 'Vị trí', key: 'location_code' },
        { header: 'Số lượng đặt', key: 'quantity' },
        { header: 'Số lượng thực nhận', key: 'actual_quantity' },
        { header: 'Đơn giá', key: 'unit_cost' },
        { header: 'Thành tiền', key: 'line_total' },
      ],
      `phieu-nhap-${receipt.receipt_number}`,
    );
  };
```

Sửa nút ở dòng 264-266:

```tsx
          <button onClick={handleDownload} className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-blue-100 bg-card text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm font-medium dark:border-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/10">
            <Download className="w-3.5 h-3.5" /> Tải xuống
          </button>
```

- [ ] **Step 3: Build và kiểm tra thủ công**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: cả hai thành công.

Mở dev server, vào `/orders`, bấm "Xuất" — xác nhận một file `phieu-nhap-kho.csv` được tải xuống, mở bằng Excel thấy đúng cột và dữ liệu hiện tại đang lọc. Vào một phiếu nhập cụ thể ở `/orders/:id`, bấm "Tải xuống" — xác nhận file `phieu-nhap-<receipt_number>.csv` chứa đúng danh sách hàng nhận.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/pages/orders.tsx apps/web/src/components/pages/order-detail.tsx
git commit -m "fix(web): wire up dead export buttons on goods receipt pages"
```

---

## Xác minh tổng thể sau khi hoàn tất cả 8 task

- [ ] Run: `pnpm lint:ci && pnpm typecheck && pnpm build` (từ thư mục gốc `smartbook-system`) — toàn bộ workspace phải build sạch.
- [ ] Run: `pnpm test:node` — toàn bộ test Node hiện có (bao gồm `membership-dates.test.js` mới) phải pass.
- [ ] Run: `docker compose up -d --build && pnpm demo:seed && node scripts/demo-smoke.mjs` — cả 3 luồng demo (RBAC, mua hàng/nhập kho, mượn trả) phải pass, đặc biệt xác nhận luồng mượn trả không còn 409 vì membership hết hạn.
- [ ] Đăng nhập thủ công lần lượt ADMIN, LIBRARIAN, WAREHOUSE_MANAGER và một khách hàng demo, lướt qua sidebar — xác nhận không còn "Liên lạc nội bộ", có "Nhập kho thông minh", nút xuất trên trang phiếu nhập hoạt động, trang phạt/ví của khách không còn nút tự thanh toán.
