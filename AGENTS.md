\# SmartBook System - Agent Instructions



\## Project

This repository is `smartbook-system`.



It is a pnpm workspace:

\- apps/\*

\- services/\*

\- packages/\*



Main areas:

\- apps/web: React + Vite frontend

\- services/auth-service: Express + Prisma authentication service

\- services/inventory-service: Express + Prisma inventory service

\- services/borrow-service: Express + Prisma borrow/reservation/fine service

\- services/analytics-service: Express reporting service (reads inventory_db/borrow_db, no Prisma)

\- services/ai-service: Python + FastAPI AI service (OpenRouter, ai_db)

\- apps/api-gateway: Express gateway (HTTP proxy + Socket.IO)

\- apps/mobile: Expo/React Native app for warehouse staff and customers

\- packages/shared: shared Node utilities and service contracts



\## Branch rules

\- Current working branch: `hungg`.

\- Do not push directly to `main`.

\- All fixes should be committed to `hungg`.

\- Before merging `hungg` into `main`, run lint/build checks.

\- `main` previously merged branch `khoa` by mistake in PR #18 and reverted it in PR #19.

\- Do not reintroduce unwanted logic from branch `khoa` or PR #18.



\## Required commands

Use pnpm workspace commands where possible:



```bash

pnpm install

pnpm lint

pnpm build

