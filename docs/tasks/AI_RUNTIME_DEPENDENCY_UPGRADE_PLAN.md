# AI runtime/dependency plan — Phase 6 preparation

Status: **IMPLEMENTED / RUNTIME VERIFIED; residual security review remains**. Planning prepared2026-11-18; execution addendum2026-11-19 below supersedes the earlier candidate base/pip values. The preparation itself changed no application source, Dockerfile, requirements or project lock and performed resolution only. Phase6GO subsequently authorized the scoped implementation and isolated verification recorded below. Passing runtime tests does not imply zero image advisories or production approval.

## Minimal candidate

Use the supported Python3.12 security branch, specifically **3.12.16**, released2026-10-25. The official release page states security-only support through October2028 ([Python release](https://www.python.org/downloads/release/python-31216/)). This deliberately avoids another feature-version migration.

Verified with `docker buildx imagetools inspect` and an actual pull/run:

```text
python:3.12.16-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
linux/amd64 manifest sha256:0f086103b026048cc50cb5da25ec435c023c5241a83fc44daea593377abc61c4
runtime reported Python 3.12.16
```

The official image annotation identifies docker-library/python revision `3d7e95597e56a415d9e4abc0f15877e005d2cb2e`, directory `3.12/slim-bookworm`, image created2026-11-05 ([official image](https://hub.docker.com/_/python)). Pin the index digest and declared deployment platform; reverify at implementation time if registry state changes. Base digest pinning alone does not freeze future `apt-get` results or prove OS CVE clearance.

| Component | Measured QA version | Minimal candidate | Rationale / primary metadata |
|---|---|---|---|
| Python |3.10.22|3.12.16| Supported branch; enables fixed Pillow/filelock wheels |
| Pillow |12.3.0|13.0.0| Floor covering the prior42 advisory IDs; requiresPython>=3.11, cp312 Linux wheel exists; [PyPI metadata](https://pypi.org/pypi/Pillow/13.0.0/json) |
| filelock |4.1.0|4.2.1| Prior17 advisory IDs fixed floor; requiresPython>=3.11; [PyPI metadata](https://pypi.org/pypi/filelock/4.2.1/json) |
| pip |23.0.1|26.2| Prior7 unique advisory IDs fixed floor; Python>=3.10; [PyPI metadata](https://pypi.org/pypi/pip/26.2/json) |
| setuptools |79.0.1|84.1.0| Prior2 unique advisory IDs fixed floor; Python>=3.10; [PyPI metadata](https://pypi.org/pypi/setuptools/84.1.0/json) |
| torch CPU |2.14.1+cpu|2.14.1+cpu| Keep current version; official cp312 CPU wheel exists and metadata requiresPython>=3.10 |
| transformers |5.20.2|5.20.2| Keep current API family; metadata requiresPython>=3.10; [PyPI metadata](https://pypi.org/pypi/transformers/5.20.2/json) |
| Other measured distributions | Existing68-distribution inventory | Exact existing pins unless proven incompatible | Avoid blind major updates; the isolated Python3.12 resolver accepted the complete candidate |

The advisory counts refer to the earlier exact image audit in [DEPENDENCY_ADVISORY_TRIAGE.md](DEPENDENCY_ADVISORY_TRIAGE.md), not newly discovered exploit paths. Primary examples are [Pillow image issue](https://github.com/advisories/GHSA-4558-3h8r-v8xp), [filelock lock-file issue](https://github.com/advisories/GHSA-2g95-wg33-c5x2), [setuptools wheel issue](https://github.com/advisories/GHSA-xmj3-9gf7-h52w) and [setuptools sdist issue](https://github.com/advisories/GHSA-h35f-9h28-mq5c). The selected fixed-package PyPI metadata presently returns no vulnerability records. That metadata is not a substitute for a fresh full installed-image audit or review of advisories published after this check.

## CPU wheel provenance and reproducible graph

The [official PyTorch CPU index](https://download.pytorch.org/whl/cpu/torch/) supplies `torch-2.14.1+cpu-cp312-cp312-manylinux_2_28_x86_64.whl`. Metadata was fetched without a model download; version2.14.1+cpu, Python>=3.10. Exact candidate source:

```text
https://download-r2.pytorch.org/whl/cpu/torch-2.14.1%2Bcpu-cp312-cp312-manylinux_2_28_x86_64.whl
sha256:5a6363570c753812540a05eb82380e329469cbe668643e88111414c12627711f
```

Use an explicit hashed CPU wheel URL, with other packages from PyPI. Replace the unpinned mixed-index Torch installation; `--extra-index-url` does not constitute a source-provenance guarantee. Keep CPU version2.14.1; no torchvision/torchaudio/CUDA addition is needed by current source. Other deployment architectures need their own official wheel/hash/lock; the amd64 lock is not an ARM compatibility claim.

Ignored preparation artifacts: `test-results/remediation/phase6-ai-prep/primary-package-metadata.json`, `candidate-pins.txt`, `resolution.json`, `resolver.log`, and `resolved-linux-amd64-py312.lock`. The official Python3.12.16 container ran pip `--dry-run --ignore-installed --only-binary=:all: --report` over the complete measured pins with only the four floor changes and explicit Torch URL. **All68 distributions resolved, all68 have SHA256 entries, and no nvidia/CUDA distribution was selected.** This proves graph/wheel availability on that target, not import/model inference correctness. Existing conditional Python3.10 helper packages remain pinned in this conservative candidate; pruning them is not required for remediation.

After Phase6GO, promote reviewed results into a committed, platform-specific hashed runtime lock and separate hashed bootstrap toolchain pins. Install with `--require-hashes --only-binary=:all:` and the exact official wheel URL; bootstrap the fixed pip/setuptools versions before runtime dependency installation. Freeze every transitive version/hash rather than add unconstrained `>=` requirements. Regenerate deliberately with the recorded resolver Python/pip/platform, review the entire diff, then build from the final source/lock/base. Do not copy host Windows site-packages into Linux images.

## Actual application compatibility boundary

- `image_input.py` opens/loads and transposes uploaded images; `book_ocr/images.py` checks decompression bombs, converts/composites images and uses `Image.Resampling.LANCZOS`; `cover_embeddings.py` decodes/converts cover images. These are real Pillow runtime paths. Review Pillow13 removals against these calls and run malformed/oversize/PNG/JPEG/WebP tests. Allowlisting codecs does not prove all prior42 recipes unreachable.
- `cover_embeddings.py` lazily imports torch/Transformers, calls `CLIPModel`/`CLIPProcessor.from_pretrained`, disables gradients and normalizes features. Keep the existing Tensor-versus-output-object handling. Test offline imports, a CPU tensor operation and synthetic processor/model configuration without fetching weights; existing mocked cover tests do not prove real cached-model inference. A real, approved locally cached-model canary remains a separate gate if no model artifact is available.
- Filelock is a transitive model/cache dependency, not an application endpoint import. Keep the non-root app UID and private owned HF/cache directories. Shared writable cache mitigation complements the patch; it does not replace it.
- CloakBrowser/Playwright/Chromium and ddgs are real lookup paths. Keep their measured package versions and existing browser system dependencies initially. Verify imports, subprocess timeout/cleanup and a bounded local browser smoke test; no external provider or model download is required. Record OS package versions in the resulting image.
- Python3.12 can expose removed stdlib/build-tool assumptions. Run the complete AI unit suite and the mandatory12 PostgreSQL tests on the rebuilt image. Owner `python migrate.py` precedes runtime `AI_SCHEMA_MANAGED_EXTERNALLY=true`; preserve the no-runtime-DDL proof and private audit-target guards.

## Security gates and remaining Torch gap

Run pip-audit against the **installed rebuilt image**, preserve exact inventory, unique advisory IDs, package origins and raw report, and compare each previous Pillow/filelock/pip/setuptools advisory. Run `pip check`, offline import/CPU smoke, all AI regressions, image/OS/binary scan, non-root/write-path verification and startup/shutdown/health checks. A successful resolver or old Python3.10 test run cannot satisfy these gates.

The original audit skipped `torch==2.14.1+cpu` because that local-version distribution was absent from PyPI. Pinning the official wheel resolves provenance/reproducibility, **not advisory coverage**. Review [PyTorch maintainer advisories](https://github.com/pytorch/pytorch/security/advisories), compare upstream base2.14.1 ranges with CPU provenance, and independently scan bundled native libraries/base OS. If a normalized base-version advisory query is used, label that normalization explicitly and retain the original installed local version. No zero-advisory claim is allowed while Torch/native scanning is incomplete. No source/model deserialization from untrusted artifacts or paid inference is introduced to test the upgrade.

No downgrade rollback across incompatible data is proposed: this phase changes runtime/dependencies, not database schema. Keep the old image as a diagnostic artifact; deploy/rollback authorization and production canary remain parent release gates. If source compatibility fixes are required, first reproduce the failure with a focused regression and keep the scope within this runtime migration.

## Phase6 execution — 2026-11-19

Final local image: `smartbook-remediation-ai312:phase6`, exact OCI index `sha256:d666321aadb1b4e9bc765195d25ef615f6d0c4ef3b79ac04dabcb9b3a4202e1e`. This is a local verified candidate, not a published production digest. The final Dockerfile uses official `python:3.12.16-slim-trixie@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b`. Controlled same-Python/same68-package Trixie comparison passed the complete runtime tests and reduced OS critical records4→1 versus Bookworm. [Debian13's lifecycle](https://www.debian.org/releases/trixie/) provides full support through2028-08-09 and LTS through2030-06-30. No app API/business-source changes or broker/database major migration were included.

Actual fixed versions are Pillow13.0.0, filelock4.2.1, **pip26.3**, setuptools84.1.0; Torch2.14.1+cpu and Transformers5.20.2 are retained. Pip26.3 supersedes the original26.2 floor because image scanning exposed old certifi/msgpack/urllib3 vendored inside26.2. The [official26.3 changelog](https://pip.pypa.io/en/stable/news/) and hashed official wheel were checked;26.3 vendors patched certifi2026.10.23, msgpack1.2.4 and urllib3 2.8.0. The prior image failed the new vendor-floor probe before the lock change; both raw scans and RED/GREEN logs remain retained.

Committed installation interface:

1. `requirements-build.lock`: two hashed bootstrap wheels, pip26.3/setuptools84.1.0.
2. `requirements-linux-amd64-py312.lock`: all68 exact runtime distributions/hashes, including explicit official CPU Torch URL; install using `--require-hashes --only-binary=:all:`.
3. `requirements-test.lock`: five hashed test-tool distributions including pytest9.2.0; installed only into the QA container layer, not the production runtime image.

`requirements.txt` preserves the exact direct dependency intent and points installers to the complete locks. Docker keeps UID/GID1000, `python run.py`, HOME/model/browser caches and lifespan behavior. The only additional runtime path fix is `XDG_CONFIG_HOME=/tmp/smartbook-config`: a real non-root/read-only browser RED failed when crashpad could not write under immutable HOME; the same engine passed with writable temporary configuration, then the Dockerfile was updated. No browser package was removed to improve a scanner count.

| Final image check | Observed result / artifact |
|---|---|
| Python/UID/fixed and vendored floors | PASS, Python3.12.16 and UID1000; `phase6-ai/runtime-proof-9cba7e11.log` |
| CPU tensor + synthetic CLIP config/model | PASS; no pretrained artifact/model/provider download |
| Bounded browser | PASS, network-none/read-only rootfs and inline data:HTML; `browser-offline-9cba7e11.log` |
| Explicit owner then no runtime DDL | PASS; actual `python migrate.py` on a new empty audit DB, followed by live reads with DDL loader forbidden |
| Mandatory PostgreSQL cases | **12/12PASS,0skip**, `postgres12-9cba7e11.log` |
| Quota/vision/billable boundary selector | **32/32PASS,0skip**, `quota32-9cba7e11.log` |
| Full AI pytest | **1639PASS +166subtests**;12PG-only skips are separately covered by the mandatory12/12 gate above. `full-ai-9cba7e11.log`. Focused32 overlaps this suite; do not add it as32 unique tests. |
| Installed-image package audit |68distribution records; **67audited,0known findings,1explicit Torch skip**; `pip-audit-final.json` and `.log` |
| Exact final image Trivy | OS: **1187records,1critical/477high,0vendor FixedVersion**. Python: **3raw vendor-subset matches (1high/1medium/1low)**, no suppression. `phase6-ai-trivy-final.json` / `.log` |
| Source/image provenance | All five dependency/Docker files and271Python source files match host/image hashes; `final-source-hashes.json`, `final-image-inventory.json` |

These artifacts live under `test-results/remediation/phase6-ai/` unless otherwise named. Tests used actual image source (no host source mount), fake provider boundaries, fresh guarded `ai_pg_audit_9cba7e11` plus isolated `ai_audit` quota fixtures. All credentials remained private. Parallel cold probes previously timed out under heavy shared I/O; final serialized probes passed the same bounds. No skipped required gate or old-candidate result was promoted into a final-image PASS.

Browser scope is precise: current application calls `cloakbrowser.launch(headless=True)` without an executable path. Installed0.7.2 honors `CLOAKBROWSER_BINARY_PATH`; otherwise it validates/obtains a license and downloads/caches its signed vendor engine, with free keys forcing latest. The offline smoke used a **test-only `/usr/bin/chromium` override**, not the production default vendor engine. It verifies Python/Playwright/browser launch/HTML compatibility, not licensing, third-party engine provenance or Fahasa anti-bot behavior. No default engine was silently changed; a cached vendor-engine canary remains necessary before relying on that optional path. The CLIP smoke similarly does not establish real pretrained-model retrieval or semantic quality.

The installed Torch `direct_url.json` confirms the official cp312 CPU URL/hash above. Pip-audit still explicitly skips its `+cpu` distribution. A limited OSV query for normalized base2.14.1 returned no advisory matches (`torch-base-osv-query.json`); this is **not** a native CPU-wheel scan. Runtime lxml reports its own compiled/runtime libxml2 **2.14.6**, with no system-libxml2 dynamic link in the inspected etree binary; do not automatically assign a distro libxml2 record to that separate wheel. Do not infer that every other native consumer is safe from this fact.

Final image-level Trivy report/log are `test-results/remediation/phase6-ai-trivy-final.json` and `.log`; preserve all OS/vendor-subset findings and scanner warnings. The remaining distro libxml2 critical is **CVE-2026-6653, vendor status affected**, with no vendor FixedVersion. Critical/high records joined to actual dpkg source packages/statuses are `os-critical-high-final.json`; the full raw report includes all severities. Pip's three reported setuptools70.3 records refer to vendored **pkg_resources only**: the official hashed26.3 wheel contains neither the vulnerable `setuptools/package_index.py`, `setuptools/wheel.py` nor `_distutils/filelist.py`; the full installed setuptools is84.1.0. The source/subset evidence is `pip-setuptools-subset.json`, with primary advisories linked above. Keep the raw matches and configuration/platform assessment; no scanner suppression or vendor-code surgery was used. Remaining OS/native/browser/Torch coverage is an explicit release-review boundary, not an automatic zero-risk acceptance. Owner role: AI runtime/infrastructure maintainer; review before release and again by2026-11-26 if still unresolved. No named operator or risk acceptance is invented here.
