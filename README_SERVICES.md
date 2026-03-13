# Services Overview

Short summary of services in this repository:

- `inventory-service/` — Canonical inventory service (backend implementation, exposes inventory endpoints).
- `smartbook-backend/inventory-service/` — (CONSOLIDATED) now removed; code merged into root `inventory-service/`.
- `smartbook-ui/` — Frontend React app.
- `ai-service/` — Python AI helper service (OCR, Ollama).

Recommendations:
- Duplicate `inventory-service` consolidated: root `inventory-service` now holds the backend implementation.
- Fix `smartbook-ui/package.json` git conflict (already resolved).
- Standardize Prisma versions or separate DB ownership per service.
