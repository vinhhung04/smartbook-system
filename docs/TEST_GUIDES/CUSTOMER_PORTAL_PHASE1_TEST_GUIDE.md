# CUSTOMER PORTAL PHASE 1 - Local Test Guide

This guide validates Phase 1 scope implemented with real services and real DB:
- Customer registration/login/logout
- Customer profile (view/update)
- Customer membership summary
- Route protection and role-based separation

## 1. Prerequisites

- Docker services are up (gateway, auth-service, borrow-service, postgres, web).
- `JWT_SECRET` is the same across auth-service and borrow-service.
- If not set, internal provisioning key defaults to `smartbook-internal-dev-key` in code.

## 2. Start stack

```bash
cd smartbook-system
docker compose up --build
```

Open web at `http://localhost:5173`.

## 3. API smoke (gateway)

### 3.1 Register customer

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username":"customer.phase1",
    "email":"customer.phase1@example.com",
    "full_name":"Customer Phase1",
    "password":"Passw0rd!"
  }'
```

Expected:
- HTTP 201
- body contains `user`
- In DB, user has role `CUSTOMER`
- In borrow DB, corresponding customer profile is auto-provisioned

### 3.2 Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"customer.phase1@example.com","password":"Passw0rd!"}'
```

Expected:
- HTTP 200
- returns JWT token and user roles includes `CUSTOMER`

Save token as `TOKEN`.

### 3.3 Me endpoint

```bash
curl http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN"
```

Expected: HTTP 200 + current user profile.

### 3.4 My profile via `/my/*`

```bash
curl http://localhost:3000/my/profile -H "Authorization: Bearer $TOKEN"
```

Expected: HTTP 200 + customer profile data only for logged in user.

### 3.5 Update my profile

```bash
curl -X PATCH http://localhost:3000/my/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Customer Phase1 Updated","phone":"0900000001"}'
```

Expected: HTTP 200 + updated data.

### 3.6 My membership

```bash
curl http://localhost:3000/my/membership -H "Authorization: Bearer $TOKEN"
```

Expected: HTTP 200 + membership limits and active_loan_count.

### 3.7 Logout

```bash
curl -X POST http://localhost:3000/auth/logout -H "Authorization: Bearer $TOKEN"
```

Expected: HTTP 200.

## 4. UI flow checks

1. Go to `/customer/register`, create a new account.
2. Go to `/customer/login`, sign in with new account.
3. Verify redirect to `/customer` dashboard.
4. Open `My Profile`, update fields, confirm success toast and persisted values.
5. Open `My Membership`, confirm real limits loaded.
6. Logout from customer layout.
7. Try opening `/customer/profile` when logged out -> should redirect to `/customer/login`.
8. Login with non-customer account at `/customer/login` -> should be blocked for customer portal.

## 5. Mandatory test cases covered (Phase 1)

A. Auth/Profile:
- Register success with real account + real customer mapping.
- Login success through auth-service.
- Logout success.
- View own profile success.
- Update own profile success.
- Unauthenticated blocked from customer private routes.
- Customer cannot access other customer data through `/my/profile` design (self-resolved only).

## 6. Notes

- This guide is Phase 1 only (auth/profile/membership foundation).
- Reservations, loans, fines, notifications are Phase 2+.
