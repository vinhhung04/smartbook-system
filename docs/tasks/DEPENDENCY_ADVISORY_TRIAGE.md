# PRA-21 — Dependency advisory triage trước Phase 6

## Phase 6 implementation checkpoint — 18/11/2026

Phần dưới giữ nguyên bằng chứng trước sửa. Snapshot sau nâng cấp ban đầu: `pnpm audit --prod --json` còn **4 entries:0critical/2high/2moderate** (`p6-pnpm-audit-current.json`). Lượt sau khi pin Multer2.5.0 và cài `--frozen-lockfile`, lockSHA256 `938b5d875b8a4e6cb5ac0a3def8414bc08d009ea080726e659081998bd49c4af`, pnpm trả **3 entries:0critical/1high/2moderate** (`p6-pnpm-audit-final.json`). Picomatch vẫn2.3.2 và Trivy vẫn báo advisory; không coi việc biến mất khỏi pnpm response là đã sửa. Đây **không phải audit clean**. Các scanner có độ phủ/feed khác nhau; không cộng raw counts như các defect độc lập.

Quét **image thực** phát hiện Multer1.4.5-lts.2 trong authenticated procurement-document (memory storage) và packing-video (disk storage), dù pnpm response không báo. Trivy nhận diện10high+1low với các fixed floors đến2.3.0. Đối chiếu [maintainer releases](https://github.com/expressjs/multer/releases) còn có bản vá2.4 (aborted disk writes) và [2.5 pending async fileFilter](https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m). Do đó pin trực tiếp **2.5.0**, thay vì dừng ở scanner floor. Filter hiện tại synchronous nên không tuyên bố recipe async2.5 được tái hiện qua endpoint hiện tại; multipart middleware là đường gọi thật cho các lỗi khác.

**Version upgrade alone chưa đủ:** installed2.5 source/README vẫn mặc định `fieldNameSize`, `fieldNestingDepth`, `fieldArrayIndexLimit` là Infinity. Bốn test child-isolated cho field names đã ghi nhận tên nested được nhận200 và array-index parser vượt deadline3s trên cả graph cũ và graph2.5 chưa cấu hình. Hai middleware nay đặt giới hạn tên100, depth4, index100; giữ nguyên fileSize/files/fields hiện tại. UI gửi field names phẳng và JSON-string values; các control đảm bảo không đổi giá trị `lines`/`metadata`. Không thêm proxy/body-buffer để xử lý upload300MiB.

`services/inventory-service/test/upload-multipart.test.js`: **15/15PASS** trên image mới, gồm valid bytes, repeated fields, missing/truncated boundary, duplicate files, abort/recovery, actual300MiB packing size refusal và bốn field-name regressions. Full Inventory **503/503PASS,0skip** (`node24-inventory-3dde3442.log`). Exact final runtime image `sha256:4a14c5626a264770e23a172424f5a0e42344d35fb37506c4f045a2e0329ebc1f` có mountpoints thuộc UID1000; actual fresh-volume writes/startup/metrics/SIGTERM đềuPASS. Trivy cuối `p6-inventory-multer-scan/summary.json` hết11 Multer records; app còn Picomatch, npm tooling và OS records vẫn tách riêng. Không coi việc scanner hết Multer records là thay thế test giới hạn parser.

Runtime Node được chốt24.16.0; Docker base có digest, cùng patch line Bookworm. Nâng trực tiếp Nodemailer9→10.1.4 và OpenTelemetry SDK1→2.11.0/exporter0.222.0 vì bản sửa không có ở major cũ; các framework/React/Expo major được giữ nguyên. Các override còn lại chọn bản sửa tương thích major. HTTP metric đổi sang `http_server_request_duration_*` (seconds) và `http_response_status_code`; dashboards/alerts đổi tên và nhân1000 để giữ hiển thịms. Business metrics giữ tên/labels. Không dùng tùy chọn semantic conventions đã bị upstream xóa.

| Advisory còn lại | Installed/fixed | Đường phụ thuộc và kết luận có giới hạn |
|---|---|---|
| [Zod oversized collections](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), high |3.25.76 /4.6.6 | Các audit paths đi qua Expo CLI58.1.17. Điều kiện là collection không tin cậy được đưa vào schema có constraint bị ảnh hưởng. Không có public backend endpoint nhập Zod từ graph này; chỉ chạy Expo/config/build với source/config do nhóm phát triển kiểm soát. Không ép Zod4 vào contract Zod3 của Expo. Bundle/native release reachability vẫn cần đối chiếu artifact cuối. |
| [Glob cancellation](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), moderate |13.0.6 /14.0.2 | Expo config/config-plugins/Metro/fingerprint/expo-updates. Cần filesystem traversal dựa vào AbortSignal như security deadline. Các build/config inputs hiện thuộc repository tin cậy; CI job timeout vẫn là giới hạn process độc lập. Không cung cấp build/Metro server công khai hoặc chạy build từ project không tin cậy. Không coi package này vắng mặt chỉ vì không được app import trực tiếp. |
| [Minimatch amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate |10.2.5 /11.0.1 | Glob13 và Expo fingerprint. Pattern từ cấu hình/source build có quyền kiểm soát, chưa tìm thấy đường public API nhận pattern. Major override cần Expo compatibility riêng; không tự ép vào graph hiện tại. |
| [Picomatch extglob ReDoS](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), high |2.3.2 /scanner không công bố bản sửa | Graph gồm build tools và gateway `http-proxy-middleware→micromatch`. Đã đọc installed `dist/path-filter.js`: các7 `pathFilter` của gateway là prefix literal; nhánh `matchSingleStringPath` dùng `pathname.indexOf(prefix)`, không biên dịch request path thành glob. Exploit cần attacker điều khiển **pattern**, không chỉ URL đầu vào. Giữ pattern tĩnh, không thêm cấu hình glob từ request. Đây là đánh giá đường gọi hiện tại, không phải chứng minh mọi phụ thuộc ngoài gateway không thể khai thác. |

Kiểm chứng trực tiếp trên graph mới: **44/44 PASS,0skip** (`p6-node-focused-green.log`), gồm shared/lifecycle/logging/telemetry, malformed URL qua Prometheus exporter thật, gzip JSON/malformed compressed body qua Express thật, EIO transport handshake qua Socket.IO thật, SMTP loopback của cả ba mailer và bounded address-parser CPU. Baseline exporter process-crash, Socket.IO invalid EIO và address parser đã có RED. Riêng compressed body chỉ chứng minh version floor và hành vi hợp lệ/từ chối input trên graph mới; không tuyên bố đã tái hiện exploit upstream. Email synthetic chỉ gửi vào loopback SMTP fixture.

Caddy custom build giữ Caddy2.11.9, dùng Go1.27.4 và `golang.org/x/net0.62.0`; local image index `sha256:e52735ac85459ac864c27b0d245a6572bf8733cb7d793d270bd7eaebadfa9ef8`. Actual body/log tests **2/2PASS,0skip** (`p6-caddy-runtime.log`). Trivy final Caddy (`trivy-caddy-phase6.json`) có0 OS findings nhưng Go binary còn1high/5medium/1unknown; go-jose/v3 JWK parsing cần caller/config triage, không được gọi image là sạch. SHA trong local tag là baseline source identifier; working tree còn chưa commit và không phải published release digest.

Expo static web export đã được kiểm tra bằng45 external source maps (1.701 unique source modules), artifact `p6-mobile-bundle-reachability.json` lưu hash từng map. Không có Zod/Glob/Minimatch/Picomatch hoặc Expo fingerprint trong sources. Có Expo CLI `metro-require/require.js` runtime helper, vì vậy không kết luận toàn bộ CLI package vắng mặt. Bằng chứng này chỉ xác định nội dung **static web export**; chưa chứng minh native iOS/Android binary và không xóa cảnh báo build tooling.

Full backend trên Node24, Python3.12 final image và release gates đang kiểm chứng riêng; không thay kết quả đó bằng checkpoint44test.

Ngày kiểm tra: **2026-11-18, Asia/Saigon**. Đây là chuẩn bị read-only trong lúc remediation đang ở Phase 3; **chưa nâng package, sửa lockfile, requirements, Dockerfile hoặc telemetry code**. Không thay thế kết quả kiểm chứng sau remediation.

## 1. Bằng chứng mới và phạm vi

| Kiểm tra | Kết quả thực thi | Phạm vi và giới hạn |
|---|---|---|
| `pnpm audit --prod --json`, pnpm 10.6.2 | Exit 1; **100 advisory entries: 2 critical, 38 high, 46 moderate, 14 low** | Lockfile toàn workspace; không phải 100 đường khai thác production |
| So với audit trước | Tăng 1 high: picomatch `GHSA-fc5q-39xc-vjpf` | Advisory có cập nhật 2026-11-17; không có thay đổi lockfile để tạo chênh lệch này |
| Python package inventory | 68 installed distribution records, Python **3.10.22**, QA AI image digest `sha256:b48ef70f302e42f142b94baf6f090d9c8fef2349959371da4afc9d3dc3c6632c` | Image QA có sẵn, đọc bằng container `--network none --read-only`; không khởi động ứng dụng |
| pip-audit 2.10.1 | Exit 1; **76 raw advisory records** trên 4 package; **68 advisory IDs riêng** sau bỏ trùng IDs | pip/setuptools có duplicate distribution/advisory records. Không cộng raw records thành số defect độc lập |
| Python coverage gap | `torch==2.14.1+cpu` bị skip vì local-version distribution không có trên PyPI | **NOT AUDITED**, không coi là sạch. Chưa scan binary/base-image OS CVEs hoặc image production thực |

SHA256 của `pnpm-lock.yaml` tại lượt audit: `0d72d930025e03f1024bf2982550ba313534b1ab9ad575b1c79f4484da63bdb1`.

Artifacts dưới `test-results/production-readiness/dependency-triage/`: `pnpm-prod.json`, `summary.json`, `pip-audit-qa-ai.json`, `pip-audit-summary.json`, `qa-ai-packages.json`, `qa-ai-installed-pins.txt`, `qa-ai-image-id.txt`, `fixed-package-metadata.json` và stdout/stderr logs. Raw pnpm report rất lớn do nhiều dependency paths; dùng `summary.json` để review. Artifacts không chứa project credentials hoặc package registry tokens.

Host không có pip-audit; đã bootstrap **chỉ công cụ audit** bằng uvx trong `.git/pip-audit-tool-cache`, không cài vào project/venv/runtime image. `--no-deps --disable-pip` audit đúng các installed pins đã lấy từ image, không resolve/install lại requirements. PyPI/npm registry và GitHub maintainer advisories là nguồn công khai đã đọc.

## 2. Runtime production cần ưu tiên

| Package / hiện tại | Reachability thực tế | Hướng sửa tối thiểu cần kiểm ở Phase 6 |
|---|---|---|
| **body-parser 2.2.2**, 2 entries | Express runtime; `express.json()` chạy trước routing ở Auth/Inventory/Borrow/Analytics, default inflation chưa tắt. Primary advisory mô tả compressed body với trailing bytes có thể gây uncaught stream error. **Code path present; chưa gửi crash payload** | Cùng major lên **2.4.0** qua scoped override/resolution nếu Express chưa kéo bản đó; không đổi API. Regression compressed request trong child process/network-isolated container; test error/413 và service còn sống. [Maintainer advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828) |
| **engine.io 6.6.7**, 1 high | Gateway tạo Socket.IO server, không tắt transport upgrades (`apps/api-gateway/src/index.js:97–103`); kiểm auth Socket.IO không thay thế transport-parser safety. **Affected feature enabled; chưa tái hiện crash** | Sửa override đang pin **6.6.7 → 6.6.10**; kiểm polling→WebSocket upgrade/missing-or-mismatched EIO trong child/container. Không dùng tắt upgrades làm thay đổi client UX. [Maintainer advisory](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv) |
| **@opentelemetry/exporter-prometheus 0.52.1**, 1 high | `packages/shared/telemetry/index.cjs` trực tiếp tạo built-in HTTP exporter, port9464. Mọi Node backend preload telemetry. Port không public trong production Compose, nhưng có đường nội bộ. **Direct affected API present; chưa chạy malformed URL** | Fixed exporter **>=0.217.0**. Đây thuộc SDK2 generation, **không blind override một package**. Đồng bộ compatible resources/sdk-metrics/instrumentation/core; đổi `new Resource` theo migration guide; kiểm metric names/dashboard, malformed URL400 và graceful exporter shutdown. [Maintainer advisory](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-q7rr-3cgh-j5r3), [SDK2 migration](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/upgrade-to-2.x.md) |
| **@opentelemetry/core 1.25.1**, 1 moderate | HTTP instrumentation hiện hữu; baggage propagation là tính năng cần xét trong dependency implementation. **Chưa chứng minh exploit input cụ thể** | Fixed **>=2.8.0**; không chỉ nâng exporter0.217 vì metadata exporter0.217/0.218 vẫn kéo core2.7.1. Chọn một họ version tương thích và kiểm toàn graph. [Advisory](https://github.com/advisories/GHSA-8988-4f7v-96qf) |
| **proxy-addr 2.0.7**, 1 critical | Express có dependency này. Advisory yêu cầu cấu hình trust subnet IPv4-mapped IPv6 không đúng. Không tìm thấy `app.set('trust proxy', mappedSubnet)` trong service sources; limiter dùng hàm resolveClientIp riêng với hop count. **Precondition cụ thể không hiện diện trong source đã review**, không nói package bị loại khỏi runtime | Patch **2.0.8** cùng major; giữ hop trust contract; test spoofed XFF và mapped subnet rejection. [Maintainer advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) |
| **nodemailer 9.0.1**, 14 entries | Auth/Borrow/Inventory gửi mail thật; recipient có nguồn từ tài khoản/NCC. Một số advisories cần special address structure, custom transport hoặc malicious SMTP server; **không mặc định tất cả 14 reachable**, chưa có payload probe | 9.1.1 chỉ giải quyết subset; floor để bao phủ các patched advisories hiện trả về là **10.1.4**, Node>=20 (registry metadata đã xác minh). Upgrade major có phạm vi ba email modules, giữ templates/API; SMTP simulator + OTP/reset/delivery rejection tests. [Address parser advisory](https://github.com/advisories/GHSA-v53p-9fqp-m79j), [10.1.4 parser fix](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8) |
| **qs 6.15.0**, 4 moderate | Inventory/Borrow có `express.urlencoded({extended:true})`; các qs stringify recipes không tự suy ra từ parser usage. **Parser reachable; từng stringify option chưa chứng minh** | Cùng major **6.16.1**, kiểm nested/bracket/comma limits và form-compatible requests; phối hợp body-parser để graph không còn bản cũ. [Parser advisory](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) |
| **picomatch 2.3.2**, 1 high mới | Có trong gateway qua http-proxy-middleware→micromatch. `pathFilter` tại gateway là các prefix literal do source cố định (`/auth`, `/api`, ...), không lấy glob từ request. **Untrusted glob precondition chưa thấy**; request URL là candidate string, không phải pattern | Advisory hiện **không có patched version** (`<0.0.0` là sentinel, không phải version để cài). Giữ static patterns; negative regression không cho user điều khiển glob; review khi thêm pattern động. Không blind nâng major4 hoặc xóa package chỉ để audit xanh. [Advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) |

Các hàng “code path present” là phân tích source + advisory, không phải kết quả exploit thành công. Chưa ghi nhận production bị tấn công. Bản vá và regression chỉ được áp dụng khi parent cho phép Phase 6.

## 3. Browser runtime và build/mobile toolchain

`--prod` không đồng nghĩa VPS backend runtime: Expo/React Native tooling nằm trong dependencies của mobile; web `morphicons` cũng kéo nhánh React Native. Phải phân loại đường call và bundle/artifact thật, không chỉ nhìn importer hay direct-import search.

| Package / số entries | Installed | Phân loại, bằng chứng/giới hạn | Fixed floor / thay đổi đề xuất |
|---|---|---|---|
| axios / 12 |1.19.0| Web/browser HTTP clients; Node HTTP/2/data-URI/proxy recipes không tự chạy trong browser adapter. Prototype/fetch recipes còn phải xét config và pollution precondition | **1.20.0**, cùng major; test interceptors/auth/error/upload. [Advisories](https://github.com/axios/axios/security/advisories) |
| follow-redirects / 4 |1.15.11,1.16.0| Nhánh axios web và transitive tooling; Node-only adapter/code không mặc định có execution trong browser bundle | **1.16.2**; ưu tiên parent axios/resolution compatible; xác nhận không còn bản1.15.11 ở nhánh khác. Xem exact IDs ở mục6 |
| dompurify / 17 |3.3.3| Web qua jsPDF. `export-utils.ts`/`print-utils.ts` dùng `doc.text` và AutoTable arrays; không tìm `doc.html`, direct DOMPurify, `IN_PLACE` hoặc mutable hooks trong caller đã review. **Các exploit options cụ thể chưa hiện diện**, package vẫn cần xét bundle | **3.4.17** giải quyết các entries có fix; **1 entry vẫn no-fix sentinel**. Giữ export contract; không kết luận zero từ version bump. [Unfixed conditional case](https://github.com/advisories/GHSA-x4vx-rjvf-j5p4) |
| fflate / 1 |0.8.2| jsPDF browser compression; cần xét advisory codec/input tương ứng, không đồng nhất xuất report với giải nén arbitrary archive | **0.8.3**, same minor-line patch; PDF export regression |
| shell-quote / 1 critical |1.10.0| React Native devtools/Expo build tooling. Không import trực tiếp không đủ kết luận an toàn; advisory cần quote tokens có comment rồi untrusted newline. Chưa trace được một user-controlled shell execution trong artifact release | **1.11.0**, same major; test devtool/build command compatibility. [Maintainer advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) |
| node-forge / 21 |1.4.0| Expo CLI/code-signing certificate tooling; signing/trust code là security-sensitive build path, không phải VPS request handler. Cần xét từng ASN.1/TLS/PKCS/API recipe | **1.4.3** xử lý patched subset; **1 high entry chưa có fix**. Không override tuyên bố hết lỗi; hạn chế certificate inputs/build trust boundary. [Unfixed RSA case](https://github.com/advisories/GHSA-86w9-cpqp-85rv) |
| js-yaml / 4 |4.1.1| Expo/xcpretty/config tooling, potentially repository-controlled YAML. Chưa chứng minh unauthenticated runtime parsing | **4.3.2**, cùng major; config/build tests |
| brace-expansion / 6 |5.0.6| Expo glob/minimatch toolchain; glob-pattern trust boundary cần giữ repo/config-controlled | **5.0.12**, cùng major |
| browserslist / 2 |4.28.1| Babel/build target resolution, không mặc định browser runtime | **4.28.7**, cùng major; build artifacts |
| @babel/core / 1 |7.29.0| Codegen/build source-map loading; untrusted source/maps cần review trong CI | **7.29.6**, cùng major; source-map/build tests |
| baseline-browser-mapping / 1 |2.10.9| Browserslist build data/tooling | **2.11.0**, cùng major |
| source-map-js / 1 |1.2.1| PostCSS/Expo build maps; không gọi an toàn chỉ vì transitive | **1.2.2**, patch |
| compression / 1 |1.8.1| Expo dev/server toolchain, không có middleware này trong VPS gateway code đã review | **1.8.2**, patch; dev-server aborted-response test |
| zod / 1 |3.25.76| Expo CLI validators; bounded collections exploit recipe phải xét CLI/tool-server inputs | Advisory chỉ fix **4.6.6**; không blind override Zod3→4. Ưu tiên upstream Expo compatible patch hoặc reviewed backport/mitigation |
| glob / 1 |13.0.6| Expo filesystem matching/toolchain | Advisory fix **14.0.2**; major boundary, chọn upstream-compatible release thay vì global forced override |
| minimatch / 1 |10.2.5| Expo matching/toolchain | Advisory fix **11.0.1**; major boundary, xét parent/API/runtime engine requirements |

Không thay dependency chỉ để xóa nhánh khỏi báo cáo. Các floor trên xuất phát từ `patched_versions` của exact audit; trước update phải đọc changelog/engines và xác minh package vẫn có release đó. OTel, Nodemailer, Zod/glob/minimatch cần các thay đổi riêng, không gộp major upgrades thành một lần sửa.

## 4. Python runtime/image triage

`services/ai-service/requirements.txt` hiện **không pin version**, Dockerfile cài torch riêng không pin và dùng Python3.10. Kết quả dưới đây dành cho image QA đã định danh ở mục1; không đại diện mọi build tương lai từ requirements này.

| Package | Installed | Raw / unique IDs | Reachability và phương án |
|---|---|---:|---|
| Pillow |12.3.0|42 /42| AI giải mã ảnh upload bằng `Image.open`/`load` trong `image_input.py:64`, `book_ocr/images.py:67`, `cover_embeddings.py:61`. JPEG/PNG/WebP allowlist giảm một số codec paths; **không suy ra toàn bộ42 reachable hoặc unreachable**. Audit fix floor **13.0.0**, nhưng [PyPI metadata](https://pypi.org/pypi/Pillow/13.0.0/json) yêu cầu **Python>=3.11**. Không thể pin13 vào image3.10. Cần scoped Python3.11 image migration + build/test tương ứng, hoặc reviewed maintained backport; nếu chưa có phải giữ unresolved và mitigation cụ thể. [Ví dụ advisory](https://github.com/advisories/GHSA-4558-3h8r-v8xp) |
| filelock |4.1.0|17 /17| Transformer/torch/cache dependency. Một số recipes cần attacker ghi cùng lock directory/local UID race; chưa chứng minh public HTTP path. Fixed **4.2.1**, [metadata](https://pypi.org/pypi/filelock/4.2.1/json) cũng yêu cầu **Python>=3.11**. Cache private ownership/non-root là mitigation cho local boundary, không thay patch/reachability review. [Ví dụ advisory](https://github.com/advisories/GHSA-2g95-wg33-c5x2) |
| pip |23.0.1|14 /7| Image/build installation tooling. Runtime app không được cài package từ user request; vẫn là supply-chain path khi image build | Floor bao phủ audit **26.2**, metadata Python>=3.10; pin/update trong image build riêng, verify reproducible installs. Không diễn giải package manager CVE thành HTTP exploit |
| setuptools |79.0.1|3 /2| Wheel/sdist build tooling; Windows/macOS-specific recipes không mặc định reachable trong Linux production container | Floor **84.1.0**, metadata Python>=3.10; [wheel advisory](https://github.com/advisories/GHSA-xmj3-9gf7-h52w) và [sdist advisory](https://github.com/advisories/GHSA-h35f-9h28-mq5c). Không đổi trên host/project lúc chuẩn bị |
| torch |2.14.1+cpu|**SKIPPED**| Local version không có record PyPI phù hợp. Cần normalize upstream base version với distribution provenance, official PyTorch advisories và OS/binary scan; chưa thực hiện, **NOT_VERIFIABLE** |

Đã xác minh metadata fixed versions trực tiếp từ registry và lưu `fixed-package-metadata.json`; chưa khẳng định compatibility của full Python3.11 inference/Chromium/model stack. Những thay đổi Phase4 khác đang diễn ra có thể bổ sung image validation; phải triage lại exact resulting source/image thay vì chép kết luận tĩnh ở đây.

## 5. Kế hoạch thay đổi/kiểm chứng khi tới Phase 6

1. Ghi lại exact lock/source SHA trước đổi; không chạy audit fix/force. Tách runtime patch group (body-parser, Engine.IO, proxy-addr, qs) khỏi telemetry family, mail major, web client/export, mobile tooling và Python image.
2. Với mỗi group: đối chiếu primary advisory/changelog/engines → chọn minimal compatible version → cập nhật manifest/lock đồng bộ, review diff → cài frozen với script policy đã kiểm tra → focused regression và test Node20/image đúng runtime.
3. OTel: kiểm cả version graph và API migration (`Resource`/provider/exporter/readers), metric compatibility, malformed metrics request và shutdown. Không pin core2.8 vào family1.x để che audit.
4. Mail: SMTP simulator cục bộ, bounded malicious address fixture trong process riêng, delivery rejected/failed không báo sent; OTP/password reset notifications giữ nguyên contract.
5. Python: chốt Python3.11+ hoặc backport có nguồn và test. Tạo lock/constraints có versions/hashes, gồm torch CPU source/version; audit exact rebuilt image và base OS. Không dùng image inventory cũ làm bằng chứng bản mới đã sạch.
6. Unfixed advisories: record exact ID, precondition/call-path evidence, mitigation, owner role và ngày review cụ thể trước release; **không bịa tên người trực hoặc tự duyệt chấp nhận rủi ro**. Triage note này chưa phải acceptance.
7. Chạy lại native audit sau mọi lock change; mandatory test không skip; cập nhật số còn tồn tại thực tế. PRA-21 chưa được đánh dấu FIXED trong đợt chuẩn bị này.

## 6. Exact pnpm advisory index

Bảng sau được sinh từ lượt audit mới, giữ từng primary advisory link và fixed-version expression. `<0.0.0` là no-fix sentinel. Phân loại call-path/mitigation theo các bảng trên; index không tuyên bố mọi entry khai thác được.

| # | Module / installed | Severity | Fixed expression | Primary advisory |
|---:|---|---|---|---|
|1|dompurify / 3.3.3|moderate|`>=3.4.0`|[GHSA-h7mw-gpvr-xq4m](https://github.com/advisories/GHSA-h7mw-gpvr-xq4m)|
|2|dompurify / 3.3.3|moderate|`>=3.4.0`|[GHSA-crv5-9vww-q3g8](https://github.com/advisories/GHSA-crv5-9vww-q3g8)|
|3|dompurify / 3.3.3|moderate|`>=3.4.0`|[GHSA-v9jr-rg53-9pgp](https://github.com/advisories/GHSA-v9jr-rg53-9pgp)|
|4|qs / 6.15.0|moderate|`>=6.15.2`|[GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26)|
|5|dompurify / 3.3.3|moderate|`>=3.4.6`|[GHSA-hpcv-96wg-7vj8](https://github.com/advisories/GHSA-hpcv-96wg-7vj8)|
|6|dompurify / 3.3.3|moderate|`>=3.4.6`|[GHSA-r47g-fvhr-h676](https://github.com/advisories/GHSA-r47g-fvhr-h676)|
|7|dompurify / 3.3.3|moderate|`>=3.4.7`|[GHSA-rp9w-3fw7-7cwq](https://github.com/advisories/GHSA-rp9w-3fw7-7cwq)|
|8|js-yaml / 4.1.1|moderate|`>=4.2.0`|[GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68)|
|9|@babel/core / 7.29.0|low|`>=7.29.6`|[GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8)|
|10|brace-expansion / 5.0.6|high|`>=5.0.7`|[GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp)|
|11|js-yaml / 4.1.1|high|`>=4.3.0`|[GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m)|
|12|body-parser / 2.2.2|low|`>=2.3.0`|[GHSA-v422-hmwv-36x6](https://github.com/advisories/GHSA-v422-hmwv-36x6)|
|13|dompurify / 3.3.3|moderate|`>=3.4.11`|[GHSA-cmwh-pvxp-8882](https://github.com/advisories/GHSA-cmwh-pvxp-8882)|
|14|dompurify / 3.3.3|low|`>=3.4.9`|[GHSA-vxr8-fq34-vvx9](https://github.com/advisories/GHSA-vxr8-fq34-vvx9)|
|15|dompurify / 3.3.3|low|`>=3.4.8`|[GHSA-gvmj-g25r-r7wr](https://github.com/advisories/GHSA-gvmj-g25r-r7wr)|
|16|dompurify / 3.3.3|low|`<0.0.0`|[GHSA-x4vx-rjvf-j5p4](https://github.com/advisories/GHSA-x4vx-rjvf-j5p4)|
|17|dompurify / 3.3.3|moderate|`>=3.4.7`|[GHSA-76mc-f452-cxcm](https://github.com/advisories/GHSA-76mc-f452-cxcm)|
|18|dompurify / 3.3.3|moderate|`>=3.4.0`|[GHSA-39q2-94rc-95cp](https://github.com/advisories/GHSA-39q2-94rc-95cp)|
|19|brace-expansion / 5.0.6|high|`>=5.0.8`|[GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)|
|20|brace-expansion / 5.0.6|high|`>=5.0.9`|[GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895)|
|21|js-yaml / 4.1.1|high|`>=4.3.1`|[GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj)|
|22|dompurify / 3.3.3|moderate|`>=3.4.13`|[GHSA-55q2-fjhq-7xh7](https://github.com/advisories/GHSA-55q2-fjhq-7xh7)|
|23|browserslist / 4.28.1|high|`>=4.28.7`|[GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx)|
|24|browserslist / 4.28.1|high|`>=4.28.7`|[GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g)|
|25|@opentelemetry/core / 1.25.1|moderate|`>=2.8.0`|[GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf)|
|26|qs / 6.15.0|moderate|`>=6.16.0`|[GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx)|
|27|qs / 6.15.0|moderate|`>=6.16.0`|[GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g)|
|28|fflate / 0.8.2|moderate|`>=0.8.3`|[GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98)|
|29|baseline-browser-mapping / 2.10.9|moderate|`>=2.11.0`|[GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv)|
|30|js-yaml / 4.1.1|high|`>=4.3.2`|[GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh)|
|31|nodemailer / 9.0.1|moderate|`>=9.1.1`|[GHSA-8m3c-c648-2xjj](https://github.com/advisories/GHSA-8m3c-c648-2xjj)|
|32|nodemailer / 9.0.1|moderate|`>=9.1.0`|[GHSA-wmmp-3585-3rmp](https://github.com/advisories/GHSA-wmmp-3585-3rmp)|
|33|nodemailer / 9.0.1|high|`>=9.1.0`|[GHSA-2x7j-588g-ccc2](https://github.com/advisories/GHSA-2x7j-588g-ccc2)|
|34|nodemailer / 9.0.1|moderate|`>=9.1.0`|[GHSA-cc9r-2j5m-2m83](https://github.com/advisories/GHSA-cc9r-2j5m-2m83)|
|35|nodemailer / 9.0.1|moderate|`>=10.0.2`|[GHSA-6vj9-mwq6-2f5v](https://github.com/advisories/GHSA-6vj9-mwq6-2f5v)|
|36|nodemailer / 9.0.1|moderate|`>=10.0.2`|[GHSA-8vvx-rff5-p5rq](https://github.com/advisories/GHSA-8vvx-rff5-p5rq)|
|37|brace-expansion / 5.0.6|moderate|`>=5.0.12`|[GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)|
|38|brace-expansion / 5.0.6|high|`>=5.0.11`|[GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7)|
|39|brace-expansion / 5.0.6|high|`>=5.0.10`|[GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)|
|40|engine.io / 6.6.7|high|`>=6.6.10`|[GHSA-2gc4-cqfq-p2gv](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv)|
|41|nodemailer / 9.0.1|high|`>=10.0.6`|[GHSA-v53p-9fqp-m79j](https://github.com/advisories/GHSA-v53p-9fqp-m79j)|
|42|axios / 1.19.0|moderate|`>=1.20.0`|[GHSA-vh66-26gq-q6x8](https://github.com/advisories/GHSA-vh66-26gq-q6x8)|
|43|axios / 1.19.0|moderate|`>=1.20.0`|[GHSA-9fr6-4gfg-395g](https://github.com/advisories/GHSA-9fr6-4gfg-395g)|
|44|axios / 1.19.0|high|`>=1.20.0`|[GHSA-c29m-xwm3-cm6r](https://github.com/advisories/GHSA-c29m-xwm3-cm6r)|
|45|axios / 1.19.0|high|`>=1.20.0`|[GHSA-mghh-pgcx-3jjj](https://github.com/advisories/GHSA-mghh-pgcx-3jjj)|
|46|axios / 1.19.0|high|`>=1.20.0`|[GHSA-x97p-jq2g-jp4f](https://github.com/advisories/GHSA-x97p-jq2g-jp4f)|
|47|axios / 1.19.0|high|`>=1.20.0`|[GHSA-3pq3-5fj3-cg6v](https://github.com/advisories/GHSA-3pq3-5fj3-cg6v)|
|48|axios / 1.19.0|high|`>=1.20.0`|[GHSA-542g-h47m-68v8](https://github.com/advisories/GHSA-542g-h47m-68v8)|
|49|axios / 1.19.0|moderate|`>=1.20.0`|[GHSA-j8rh-479h-cp32](https://github.com/advisories/GHSA-j8rh-479h-cp32)|
|50|axios / 1.19.0|moderate|`>=1.20.0`|[GHSA-4hqw-qxg8-jxx2](https://github.com/advisories/GHSA-4hqw-qxg8-jxx2)|
|51|axios / 1.19.0|high|`>=1.20.0`|[GHSA-m8m8-qj5v-23w3](https://github.com/advisories/GHSA-m8m8-qj5v-23w3)|
|52|axios / 1.19.0|moderate|`>=1.20.0`|[GHSA-44g4-m2mj-wpvx](https://github.com/advisories/GHSA-44g4-m2mj-wpvx)|
|53|axios / 1.19.0|high|`>=1.20.0`|[GHSA-r4gj-5m52-g5wh](https://github.com/advisories/GHSA-r4gj-5m52-g5wh)|
|54|node-forge / 1.4.0|high|`<0.0.0`|[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)|
|55|dompurify / 3.3.3|low|`>=3.4.12`|[GHSA-c2j3-45gr-mqc4](https://github.com/advisories/GHSA-c2j3-45gr-mqc4)|
|56|dompurify / 3.3.3|low|`>=3.4.16`|[GHSA-6688-9rhm-gjv2](https://github.com/advisories/GHSA-6688-9rhm-gjv2)|
|57|source-map-js / 1.2.1|high|`>=1.2.2`|[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)|
|58|proxy-addr / 2.0.7|critical|`>=2.0.8`|[GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)|
|59|compression / 1.8.1|high|`>=1.8.2`|[GHSA-vc2v-76pw-4v95](https://github.com/advisories/GHSA-vc2v-76pw-4v95)|
|60|shell-quote / 1.10.0|critical|`>=1.11.0`|[GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv)|
|61|@opentelemetry/exporter-prometheus / 0.52.1|high|`>=0.217.0`|[GHSA-q7rr-3cgh-j5r3](https://github.com/advisories/GHSA-q7rr-3cgh-j5r3)|
|62|follow-redirects / 1.16.0|high|`>=1.16.1`|[GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8)|
|63|follow-redirects / 1.16.0|high|`>=1.16.1`|[GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c)|
|64|nodemailer / 9.0.1|moderate|`>=10.0.10`|[GHSA-39m8-27wv-hr27](https://github.com/advisories/GHSA-39m8-27wv-hr27)|
|65|dompurify / 3.3.3|high|`>=3.4.17`|[GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr)|
|66|dompurify / 3.3.3|low|`>=3.4.17`|[GHSA-c6gr-qvv4-5v3f](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f)|
|67|zod / 3.25.76|high|`>=4.6.6`|[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)|
|68|body-parser / 2.2.2|high|`>=2.4.0`|[GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)|
|69|nodemailer / 9.0.1|moderate|`>=10.1.4`|[GHSA-8c8m-p3m8-cjg8](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8)|
|70|nodemailer / 9.0.1|moderate|`>=10.1.4`|[GHSA-m943-m63m-w62w](https://github.com/advisories/GHSA-m943-m63m-w62w)|
|71|nodemailer / 9.0.1|moderate|`>=10.1.4`|[GHSA-85x2-q946-cp5h](https://github.com/advisories/GHSA-85x2-q946-cp5h)|
|72|nodemailer / 9.0.1|moderate|`>=10.0.13`|[GHSA-4ffr-jq9g-5ffx](https://github.com/advisories/GHSA-4ffr-jq9g-5ffx)|
|73|nodemailer / 9.0.1|moderate|`>=10.0.13`|[GHSA-g73g-hqqh-jr95](https://github.com/advisories/GHSA-g73g-hqqh-jr95)|
|74|nodemailer / 9.0.1|moderate|`>=10.0.10`|[GHSA-4g23-2xm8-66gc](https://github.com/advisories/GHSA-4g23-2xm8-66gc)|
|75|qs / 6.15.0|moderate|`>=6.16.1`|[GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw)|
|76|follow-redirects / 1.16.0|high|`>=1.16.2`|[GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p)|
|77|glob / 13.0.6|moderate|`>=14.0.2`|[GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)|
|78|node-forge / 1.4.0|low|`>=1.4.1`|[GHSA-4642-5mcj-2rqw](https://github.com/advisories/GHSA-4642-5mcj-2rqw)|
|79|node-forge / 1.4.0|moderate|`>=1.4.1`|[GHSA-6wvx-3r32-xmcg](https://github.com/advisories/GHSA-6wvx-3r32-xmcg)|
|80|node-forge / 1.4.0|moderate|`>=1.4.1`|[GHSA-525v-9gp9-w22h](https://github.com/advisories/GHSA-525v-9gp9-w22h)|
|81|node-forge / 1.4.0|high|`>=1.4.1`|[GHSA-7wch-p9px-956x](https://github.com/advisories/GHSA-7wch-p9px-956x)|
|82|node-forge / 1.4.0|low|`>=1.4.1`|[GHSA-h6cr-wjv9-3cpp](https://github.com/advisories/GHSA-h6cr-wjv9-3cpp)|
|83|node-forge / 1.4.0|low|`>=1.4.1`|[GHSA-4487-j8r4-4g2f](https://github.com/advisories/GHSA-4487-j8r4-4g2f)|
|84|node-forge / 1.4.0|moderate|`>=1.4.1`|[GHSA-5cwg-6vw7-rj6p](https://github.com/advisories/GHSA-5cwg-6vw7-rj6p)|
|85|node-forge / 1.4.0|high|`>=1.4.1`|[GHSA-jc66-7q78-782g](https://github.com/advisories/GHSA-jc66-7q78-782g)|
|86|node-forge / 1.4.0|high|`>=1.4.1`|[GHSA-8hrf-8g6f-7xwp](https://github.com/advisories/GHSA-8hrf-8g6f-7xwp)|
|87|node-forge / 1.4.0|high|`>=1.4.1`|[GHSA-hqq3-7jhf-c5jx](https://github.com/advisories/GHSA-hqq3-7jhf-c5jx)|
|88|node-forge / 1.4.0|high|`>=1.4.1`|[GHSA-5x38-2vff-x55p](https://github.com/advisories/GHSA-5x38-2vff-x55p)|
|89|follow-redirects / 1.15.11|moderate|`>=1.16.0`|[GHSA-r4q5-vmmm-2653](https://github.com/advisories/GHSA-r4q5-vmmm-2653)|
|90|minimatch / 10.2.5|moderate|`>=11.0.1`|[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)|
|91|node-forge / 1.4.0|low|`>=1.4.1`|[GHSA-9wg5-mj3p-v49q](https://github.com/advisories/GHSA-9wg5-mj3p-v49q)|
|92|node-forge / 1.4.0|low|`>=1.4.1`|[GHSA-2vgq-wchc-25w7](https://github.com/advisories/GHSA-2vgq-wchc-25w7)|
|93|node-forge / 1.4.0|moderate|`>=1.4.1`|[GHSA-h46v-rmh6-fq4f](https://github.com/advisories/GHSA-h46v-rmh6-fq4f)|
|94|node-forge / 1.4.0|high|`>=1.4.1`|[GHSA-rhr8-3pm8-cq29](https://github.com/advisories/GHSA-rhr8-3pm8-cq29)|
|95|node-forge / 1.4.0|high|`>=1.4.1`|[GHSA-6qrw-m8cv-hcxf](https://github.com/advisories/GHSA-6qrw-m8cv-hcxf)|
|96|node-forge / 1.4.0|low|`>=1.4.3`|[GHSA-6889-vf6x-f3g5](https://github.com/advisories/GHSA-6889-vf6x-f3g5)|
|97|node-forge / 1.4.0|moderate|`>=1.4.3`|[GHSA-w4xr-hqv8-ch44](https://github.com/advisories/GHSA-w4xr-hqv8-ch44)|
|98|node-forge / 1.4.0|moderate|`>=1.4.3`|[GHSA-6cv4-p8m7-4r25](https://github.com/advisories/GHSA-6cv4-p8m7-4r25)|
|99|node-forge / 1.4.0|moderate|`>=1.4.3`|[GHSA-j8rw-jp99-435v](https://github.com/advisories/GHSA-j8rw-jp99-435v)|
|100|picomatch / 2.3.2|high|`<0.0.0`|[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)|
