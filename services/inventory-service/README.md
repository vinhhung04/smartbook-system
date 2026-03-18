# inventory-service (root)

Lightweight inventory / lookup service used by the main docker-compose.

- Language: Node.js (CommonJS)
- Entrypoint: `src/index.js`
- DB: uses Prisma (`@prisma/client`) and a shared Postgres from root `docker-compose.yml`.

How to run (development):

```
cd inventory-service
npm install
npm run start
```

Note: There is another `inventory-service` under `smartbook-backend/`. Consider consolidating or renaming to avoid duplication.

