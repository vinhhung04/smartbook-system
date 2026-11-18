# Request log redaction and upload edge verification

Application request logging uses `safeLogPath`: removes the whole query/fragment and URL userinfo, decodes the pathname defensively, replaces supplier portal bearer path segments, and fails closed on malformed encodings. Ordinary resource IDs and route patterns remain available with request ID, method, status and latency. Borrow's extra request/error metadata uses the same helper. Request bodies, authorization and cookies are not logged by this logger. Supplier portal controller error paths log a controlled Prisma error code and request ID instead of raw exception messages/meta, which can embed the JSON token lookup argument. A synthetic database-exception test proved RED before the change and GREEN after it.

Caddy applies a JSON field filter to **both** global runtime/error logs and site access logs: request URI, request headers and response headers are removed. Site access logs retain a separately appended request correlation ID plus method/status/timing. The real `caddy:2.8.4-alpine` integration test exercises a502 from an unavailable upstream and asserts a synthetic bearer is absent from the entire combined log output, while its safe correlation ID remains present. This is deliberately stronger than redacting access logs alone.

Caddy also caps `/ai`, `/api/ai` and their descendants (plus public discovery) at exactly16MiB/16,777,216 bytes, matching Gateway/application total-body policy. A real upstream test verifies unchanged valid bytes, Content-Length overflow413 and explicit chunked overflow413. The baseline config returned200 for the same oversized test. AI per-image decode limits and admission/concurrency budgets are enforced separately before inference.

Verification commands:

```
node --test packages/shared/test/*.test.cjs
node --test tests/production-readiness/integration/caddy-logging.test.mjs
node --test tests/production-readiness/integration/caddy-body-limit.test.mjs
```

Shared tests were also run on Node20 in the isolated QA image (34/34 at this checkpoint). Caddy tests use stopped-after-test, independently named containers with no external network and a bounded synthetic payload. They do not read production logs or real supplier/payment tokens. Baseline/green artifacts are under `test-results/remediation/`.

Historical log retention/access and invalidation of any previously exposed live supplier links remain an operator task; no production logs were read, deleted or rewritten and no live token was rotated during this remediation.

Primary syntax references: [Caddy log filter](https://caddyserver.com/docs/caddyfile/directives/log), [request body limit](https://caddyserver.com/docs/caddyfile/directives/request_body). Runtime execution against the pinned2.8.4 image verifies compatibility independently of newer documentation.
