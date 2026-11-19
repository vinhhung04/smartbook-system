# Runtime container advisory triage — pre-Phase6

Status: **PENDING_FINAL / NO PRODUCTION CHANGE**. Checked2026-11-18. Trivy0.76.2 was provided with an already verified official checksum. Scans used only `--scanners vuln --image-src docker`; no secret scanner, source/credential upload, exploit payload, production connection, container deletion or data-volume mutation was performed. Baselines use exact local image IDs, not a moving tag. At most two scan processes ran. One AI attempt failed on Trivy's shared filesystem-cache lock; its sequential retry succeeded. Later parallel scans used the in-memory analysis cache with the same public vulnerability database.

Feed metadata: UpdatedAt2026-11-18T07:15:21Z, DownloadedAt2026-11-18T08:00:09Z, NextUpdate2026-11-19T07:15:21Z. Raw reports, identities, public registry tag metadata, candidate index manifests, build info and summary are retained under `test-results/remediation/container-triage/`.

## Exact baselines

Counts are **package/advisory records**, including duplicate CVE IDs across packages/components. C/H mean critical/high; fixable means a nonempty scanner FixedVersion across all severities. Neither severity nor package presence proves a reachable exploit. Do not add the bare nginx and built-web rows as two distinct production applications.

| Local image / version | Exact local image ID | OS / OS records C,H,total,fixable | Language records C,H,total,fixable |
|---|---|---|---|
| Caddy2.8.4 | `sha256:af32e97399febea808609119bb21544d0265c58a02836576e32a2d082c262c17` | Alpine3.20.4: **2,26,63,63** | Go: **5,66,165,160** |
| nginx1.27.5, bare runtime base | `sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10` | Alpine3.21.3: **3,67,219,219** | No language findings detected |
| Built QA web | `sha256:1781b9f999c301b234c637f93851741d577e0f1b192932c0dda64b9aa0788fa1` | Alpine3.21.3: **3,67,219,219** | No language files detected; this does **not** audit emitted browser JavaScript |
| Redis7.4.11 | `sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf` | Alpine3.21.7: **0,7,50,50** | No native Redis advisory coverage inferred from zero language results |
| RabbitMQ3.13.7 | `sha256:606d8c0d6b3c18d1da9afc53bc7cdb2a8d5486df91b5a9830e9e07626c9ae281` | Alpine3.22.2: **2,74,236,236** | Erlang/RabbitMQ native/application coverage remains separate |
| PostgreSQL15.19 / pgvector0.8.6 | `sha256:a947c45cdc5906a1bc951f20a8709e321256343ee0f251e4ae00b5e7def4e6da` | Debian12.15: **15,199,680,178** | gosu Go: **1,25,62,62** |
| QA AI Python3.10.22 | `sha256:b48ef70f302e42f142b94baf6f090d9c8fef2349959371da4afc9d3dc3c6632c` | Debian13.7: **1,479,1192,5** | Python: **5,27,71,71**; node tooling zero detected findings |

The old Alpine3.20/3.21 rows are flagged EOSL by Trivy. [Alpine's published lifecycle](https://alpinelinux.org/releases/) ends3.20 support2026-04-01 and3.21 support2026-11-01; supported3.22 main continues through2027-05-01 and3.24 through2028-06-01. Low scanner fixable counts on a Debian row are not proof that all remaining findings lack a remedy; inspect vendor status and rebuilt-image contents individually.

## Public edge priority: Caddy

`compose.prod.yml` publishes80/TCP,443/TCP and443/UDP. `deploy/Caddyfile` uses TLS sites/reverse_proxy and does not disable HTTP/2. Caddy's [protocol documentation](https://caddyserver.com/docs/caddyfile/options#protocols) defaults to h1/h2/h3. Baseline Caddy embeds Go1.22.3 and an old x/net. [GO-2026-6611 / CVE-2026-78669](https://pkg.go.dev/vuln/GO-2026-6611) describes HTTP/2 SETTINGS CPU exhaustion in client/server; the public server path is present. This is a justified patch priority, not a claim that a production exploit was executed.

Same-major candidate **Caddy2.11.9-alpine** was fetched by exact official index digest and inspected in a retained `--network none --read-only` container with no production mounts:

```text
index sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
amd64 sha256:fc9cbc100585871d18d4e451cca7021785c90a7006087427ae5ceb3e4efe6424
Alpine3.24.4 / Go1.27.3 / Caddy2.11.9 / x/net0.60.0
grpc1.83.2 / smallstep certificates0.30.2
```

The same Trivy scan reports **0critical,2high,8medium,1unknown**: OS1medium(zlib), Go2high/7medium/1unknown. It closes the baseline SETTINGS issue through patched Go/x/net, but it is **not fully patched**. Main residuals:

For the controlled same-version rebuild, public registry configuration verifies official `caddy:2.11.9-builder-alpine@sha256:646fee578e680989ca5c7fd1ce6f1de574d19fd71ef2221810cc0510a9f40c86` (amd64 `sha256:29f98311e17e583811355fa62cc080f71d6f3aa19cf09a9e1494d30579f8bebf`) already contains Go1.27.4, xcaddy0.4.7 and Caddy2.11.9. This is metadata verification, not a completed build. Source annotation is official caddy-docker revision `d322e6686bbce5622d98a04c84fadd43b5eb8c58:2.11/builder`; extracted public provenance is `caddy-builder-metadata.json`. Keep runtime base and resulting binary/module scan separate from builder provenance.

| Residual | Actual relevance / next action |
|---|---|
| CVE-2026-97054 / Go1.27.3, medium; fixed1.27.4 | [Official GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859) requires HTTP/1 concurrent body-read/header-write when MaxBytesReader limit is exceeded. Our AI request_body limit invokes [Caddy's affected API](https://raw.githubusercontent.com/caddyserver/caddy/v2.11.9/modules/caddyhttp/requestbody/requestbody.go), so API presence is proven; the exact concurrent race through our proxy has not been reproduced. Prefer a refreshed official artifact or same-Caddy rebuild using patched Go>=1.27.4 and rescan before release. |
| CVE-2026-78661 / x/net0.60.0, high; fixed0.62.0 | [GO-2026-6860](https://pkg.go.dev/vuln/GO-2026-6860) is quadratic HTML parsing, **not** the SETTINGS vulnerability. No arbitrary HTML-parser endpoint appears in our Caddy config. Review actual module callers and a compatible x/net update; do not call the binary clean merely because the old HTTP/2 issue is fixed. |
| CVE-2026-116587 / go-jose/v3, high; no3.x fix in scanner | [Maintainer advisory](https://github.com/go-jose/go-jose/security/advisories/GHSA-mgcc-cww5-fp2q) requires parsing attacker-controlled JWK RSA parameters. Caddy config does not expose an arbitrary JWK parser. Keep the conditional risk and traced upstream caller assessment; do not force a module-major replacement without compatibility evidence. Two related go-jose records also remain. |
| zlib medium, Go OTel medium records and unknown x/crypto record | Preserve raw records, vendor status, module origin and next patched build. UNKNOWN does not mean safe. |

[Caddy2.11.9 release notes](https://github.com/caddyserver/caddy/releases/tag/v2.11.9) include security fixes and behavioral tightening around FastCGI/TLS policy merging. Our configuration has no PHP/FastCGI/file_server/forward_auth, so those recipes are not assumed exposed. Regression must still validate the final Caddyfile, TLS/HTTP routing, 16MiB body413, WebSocket upgrade, request-ID propagation and log redaction. No disabling protocol/features is proposed to conceal findings.

### Phase6 custom build: remaining go-jose/v3 caller assessment

The parent's patched Caddy scan `test-results/remediation/trivy-caddy-phase6.json` reports OS0 findings and Go1high/5medium/1unknown. The high CVE-2026-116587 remains **unfixed/conditional**, not erased from the report. Its [maintainer advisory](https://github.com/go-jose/go-jose/security/advisories/GHSA-mgcc-cww5-fp2q) requires attacker-controlled RSA JWK parsing; no3.x patch is published.

The exact source chain is Caddy2.11.9's optional [`http.handlers.acme_server`](https://raw.githubusercontent.com/caddyserver/caddy/v2.11.9/modules/caddypki/acmeserver/acmeserver.go) → smallstep certificates0.30.2 [`acme/api` JWS parsing](https://raw.githubusercontent.com/smallstep/certificates/v0.30.2/acme/api/middleware.go) → [`go.step.sm/crypto`0.91.0 JOSE aliases](https://raw.githubusercontent.com/smallstep/crypto/v0.91.0/jose/types.go) → go-jose/v3. If an embedded ACME server is enabled, untrusted ACME JWS headers are a real parser input; rejecting private keys later does not justify claiming safe parsing before that validation.

The **actual custom image** adapted the current production Caddyfile in a retained network-none/read-only container. Its handler set is encode/headers/log_append/request_body/reverse_proxy/rewrite/static_response/subroute: **no acme_server handler**. Evidence: `container-triage/caddy-phase6-adapted.json` and `caddy-jwk-caller-assessment.json`. [Caddy documents](https://caddyserver.com/docs/caddyfile/directives/acme_server) that the embedded server serves ACME requests when explicitly enabled. Ordinary automatic HTTPS certificate acquisition uses the separate certmagic/acmez client graph; the current [certmagic0.25.6 manifest](https://raw.githubusercontent.com/caddyserver/certmagic/v0.25.6/go.mod) and [acmez3.1.7 manifest](https://raw.githubusercontent.com/mholt/acmez/v3.1.7/go.mod) do not make the embedded smallstep server route public. Current config also does not publish the admin listener or load untrusted JWK/key configuration.

Assessment: **the identified public embedded-server path is absent in the reviewed configuration**, while the vulnerable library remains in the binary. This is a configuration-scoped call-path finding, not a complete binary reachability proof, a patch or risk acceptance. Re-review before enabling acme_server/local CA issuance endpoints, untrusted JWK loaders, plugins or public admin access. Do not force v3→v4 substitution or suppress the raw finding solely for an audit score. Owner role: edge/runtime maintainer; review at every Caddy/config change and before production release.

## Same-major candidates; not deployment approval

The following registry index digests and amd64 manifests were read directly from public registry metadata on this date. Except Caddy, candidates were not pulled/scanned/executed in this task. A digest is provenance, not security clearance.

| Runtime | Candidate index pin | Scope / required follow-up |
|---|---|---|
| nginx, same major1 | `nginx:1.30.6-alpine3.24@sha256:901e593c95dc85f5a729f5765516321366ef4ac401821431d408897e95287d0a` | amd64 `sha256:bb8f722b4be005fcd7827816a136ab779fd40185d85b5171be915cc7fc0575c7`. [Official nginx advisory table](https://nginx.org/en/security_advisories.html) lists1.30.6/1.31.7 patched boundaries for recent issues. Keep stable1.30; test existing envsubst/CSP/SPA404/assets behavior. Current nginx config lacks TLS/HTTP3/alias/AIO directives needed by several recipes; OS/parser updates are still needed. |
| Redis, same7.4 line | `redis:7.4.12-alpine3.22@sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe` | amd64 `sha256:e4ee3e03ce8f75471f40937a7c6b2b0e500390b6812fcdf5cb32c01295ded446`. [Official7.4.12 release](https://github.com/redis/redis/releases/tag/7.4.12); the [earlier security notice](https://redis.io/blog/security-advisory-cve-2026-81934/) already includes7.4.11, so don't falsely report that specific issue as still open in local7.4.11. Test cache/limiter behavior and persistence/restart in disposable state. No Redis8 jump. |
| PostgreSQL15 + pgvector | `pgvector/pgvector:0.8.7-pg15-bookworm@sha256:e0b617fffc06dd37323ee99873c7a8683f19f1dce34633670262b0113ce32638` | amd64 `sha256:bbba5bcbcd2ccb8d8a577a3db2d7de9af71d8a6bbdddbc3d9d8a3723d290f078`. Published2026-11-12; public registry config confirms PG_MAJOR15 / PG_VERSION15.20-1.pgdg12+1 (`pgvector-candidate-config.json`). PostgreSQL's [versioning policy](https://www.postgresql.org/support/versioning/) lists current15.20 and support through2027-11-11. Verify actual binary, installed extension and OS scan before promoting; [Debian12 LTS](https://www.debian.org/releases/bookworm/) remains available for amd64 through2028-06-30. Keep PGmajor15 and distro family initially. |
| RabbitMQ3.13 | **No supported public patched same-major replacement verified** | Public3.13.7-management-alpine still resolves to the exact old baseline digest, last updated2025-12-02. [Official3.13 docs](https://www.rabbitmq.com/docs/3.13) state community support is over; patches require paid support. Commercial dates differ between current documentation pages; do not infer an entitlement from them. A supported operator-led upgrade or entitled patched distribution remains a separate, tested migration. |
| AI | See [AI_RUNTIME_DEPENDENCY_UPGRADE_PLAN.md](AI_RUNTIME_DEPENDENCY_UPGRADE_PLAN.md) | Supported Python3.12 + reviewed pinned/hash graph; fresh rebuilt image scan still mandatory. No interpretation of this Trivy result closes the earlier local-version Torch advisory gap. |

The [pgvector0.8.7 changelog](https://github.com/pgvector/pgvector/blob/v0.8.7/CHANGELOG.md) fixes an IVFFlat build buffer overflow; current AI schema uses HNSW, so this specific IVFFlat path is not inferred from its schema. Installing new extension binaries alone does not prove each database's extension SQL version is updated. Before any extension DDL: inventory extversion/indexes, inspect exact update SQL/locks, take verified backup and rehearse restore, test vector12 plus query/index compatibility on isolated copies, and document forward-fix. No ALTER EXTENSION, reindex or data-directory change occurred here.

The baseline PG Go findings belong to **gosu1.19 built with Go1.24.6**, verified via its version command. The [gosu main flow](https://github.com/tianon/gosu/blob/master/main.go) and [Postgres entrypoint](https://github.com/docker-library/postgres/blob/master/15/bookworm/docker-entrypoint.sh) use it to switch identity and exec PostgreSQL, not serve HTTP. Therefore an embedded net/http advisory is not automatically a remotely reachable database vulnerability. Preserve the inventory and separate binary call-path analysis from the PostgreSQL server/OS/extension findings; no blanket dismissal of all Go records is made.

Parent Phase6 follow-up scans are retained separately: `trivy-postgres-phase6.json` (PG15.20/Bookworm12.15) reports OS3critical/116high with no vendor FixedVersion, plus the gosu binary1critical/25high; `trivy-redis-phase6.json` reports Redis7.4.12/Alpine3.22.8 with0critical/0high/1medium. The PostgreSQL entrypoint's root-start branch executes `gosu postgres` to re-enter the local startup script under the database UID, after which the helper execs its target. That path handles trusted startup arguments and account lookup, not incoming HTTP/TLS sessions. HTTP/TLS recipes in its embedded Go inventory are therefore not established remotely reachable by these scanner matches. This narrower assessment does not clear PostgreSQL's own server protocol, extension, role/configuration, native library or OS findings; preserve their independent evidence and residual review.

## Broker containment and remaining release work

Production Compose currently places RabbitMQ only on `data: internal:true`, publishes neither AMQP5672 nor management15672, requires explicit broker credentials, and limits it to1CPU/768MiB. Preserve and verify these boundaries in rendered production configuration. They reduce exposure but **do not repair an unsupported broker** or provide an accepted residual-risk signoff. Do not publish management ports to make testing convenient. A major upgrade needs its own queue-type/feature-flag/consumer-confirm/requeue/persistence/backup rehearsal and operator-owned maintenance plan; no broker major change is part of this preparation.

Final gates must pin approved rebuilt/image artifacts, run new Trivy OS/language scans and primary-advisory review, exercise relevant local regressions and actual final image versions, and retain unsupported/no-fix/unknown records with owner role and review date. Do not use an audit-green tag alias, old scan, assumed nonreachability or pending support purchase as a production GO.
