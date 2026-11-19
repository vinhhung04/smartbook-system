# Runbook sự cố giám sát SmartBook

Mỗi alert rule trong `observability/grafana/provisioning/alerting/rules.yaml` trỏ tới một mục ở đây (`runbook_url`). Quy trình chung cho mọi sự cố:

1. Mở sự cố trong **Giám sát hệ thống → Sự cố** và bấm **Tiếp nhận** để người khác biết bạn đang xử lý.
2. Làm theo mục tương ứng bên dưới. Ghi lại những gì đã kiểm tra bằng **Thêm ghi chú xử lý**.
3. Khi nguồn cảnh báo phục hồi, sự cố tự chuyển sang **Đã xử lý (Tự phục hồi)** và hệ thống gửi thông báo phục hồi. Chỉ bấm **Đánh dấu đã xử lý** khi đã khắc phục mà cảnh báo không tự tắt (ví dụ healthcheck không còn chạy), và luôn ghi nguyên nhân.
4. Không sửa dữ liệu nghiệp vụ chỉ để làm tắt cảnh báo.

Trên VPS, mọi lệnh compose chạy qua `deploy/scripts/dc` trong `/opt/smartbook`. Grafana chỉ mở tại `127.0.0.1:3100`; truy cập qua SSH tunnel: `ssh -L 3100:127.0.0.1:3100 sb-deploy`.

<a id="service-metrics-unavailable"></a>
## Mất metrics của dịch vụ (Service metrics unavailable)

Prometheus không scrape được `service_name` trong 2 phút. Dịch vụ đang ngừng, đang khởi động lại, hoặc endpoint metrics không phản hồi.

- `dc ps <service>`, `dc logs --tail 200 <service>`: container còn chạy không, có crash/OOM không.
- Dịch vụ nghiệp vụ ngừng: kiểm tra `https://api.smartbook.io.vn/ready`; với deploy dở dang, xem `state/releases.log`.
- `rabbitmq`, `postgres`, `redis`, `vps`, `docker`: exporter/broker tương ứng ngừng. Khi mục này mở, các cảnh báo khác của cùng dịch vụ được ghi nhận nhưng **không gửi** (inhibition), để tránh dồn dập.
- `ai-service`: AI là phụ thuộc không bắt buộc; nghiệp vụ thư viện vẫn chạy.

<a id="database-unavailable"></a>
## Mất kết nối cơ sở dữ liệu

`db_up` của một dịch vụ bằng 0, hoặc `pg_up` (postgres-exporter) bằng 0.

- `dc ps db`, `dc logs --tail 200 db`; `df -h` (đầy đĩa là nguyên nhân phổ biến).
- `dc exec -T db pg_isready`.
- Kết nối cạn: xem mục [database-pressure](#database-pressure).
- monitoring-service dùng chung PostgreSQL. Khi DB ngừng, sự cố mới có thể không được ghi; đường cảnh báo độc lập lúc này là `healthcheck.sh` (webhook trực tiếp) và heartbeat bên ngoài.

<a id="redis-unavailable"></a>
## Redis không truy cập được

Ảnh hưởng: kiểm tra thu hồi token (đọc vẫn được phép, ghi bị từ chối 503 sau 60 giây), rate limit, cache.

- `dc ps redis`, `dc logs --tail 100 redis`, `dc exec -T redis redis-cli ping`.

<a id="rabbitmq-consumers"></a>
## RabbitMQ: queue không có consumer, tồn đọng, publish lỗi

- `dc exec -T rabbitmq rabbitmqctl list_queues name messages_ready consumers`.
- Không có consumer: dịch vụ tiêu thụ (api-gateway, borrow-service) đang ngừng hoặc mất kết nối broker. Xem log của dịch vụ đó.
- Publish lỗi: outbox của inventory-service tự thử lại; theo dõi [outbox](#outbox).

<a id="rabbitmq-dlq"></a>
## Dead-letter queue không rỗng

Event đã xử lý lỗi và bị chuyển vào `*.dlq`. Không xóa queue.

- `dc exec -T rabbitmq rabbitmqctl list_queues name messages_ready | grep dlq`.
- Đọc nội dung qua RabbitMQ management (loopback ở dev), xác định nguyên nhân (thường là dữ liệu tham chiếu không tồn tại), sửa nguyên nhân rồi mới replay có kiểm soát.

<a id="monitoring-pipeline"></a>
## Đường giám sát: Grafana không truy vấn được Prometheus

Rule canary này chỉ bắn khi truy vấn lỗi. Lúc đó mọi rule khác đang "mù".

- `dc ps prometheus grafana`, `dc logs --tail 100 prometheus`.
- Đĩa đầy làm TSDB lỗi: `df -h`; dữ liệu Prometheus giới hạn 15 ngày / 2 GB.
- Monitoring ngừng **không** ảnh hưởng dịch vụ nghiệp vụ; `healthcheck.sh` vẫn giám sát độc lập.

<a id="alert-delivery-failing"></a>
## Gửi thông báo thất bại

monitoring-service đã bỏ cuộc sau số lần thử tối đa (mặc định 6, lùi 30s → 2m → 10m → 30m → 1h → 2h).

- Xem **Lịch sử gửi thông báo** của sự cố: mã lỗi từng lần thử (`SMTP_NOT_CONFIGURED`, `ECONNREFUSED`, `HTTP_404`, `DNS_FAILURE`…).
- Email: kiểm tra `SMTP_*` trong `.env` và thử **Gửi thử** ở **Cài đặt thông báo**.
- Webhook: URL Slack/Discord có thể đã bị thu hồi (404/401) → nhập URL mới.
- Hàng đợi tồn > 20: monitoring-service có đang chạy không (`dc ps monitoring-service`).

<a id="error-rate-high"></a>
## Tỷ lệ lỗi HTTP 5xx cao

- Dashboard **SmartBook → System overview**: dịch vụ nào có tỷ lệ lỗi tăng.
- `dc logs --since 15m <service> | grep '"status":5'`; đối chiếu với lần deploy gần nhất (`state/releases.log`).
- Ngưỡng ban đầu: toàn hệ thống 5%, theo dịch vụ 10% (chỉ khi có ≥ 3 yêu cầu/phút).

<a id="latency-high"></a>
## Độ trễ p95 cao

- Dashboard độ trễ theo dịch vụ; kiểm tra truy vấn chậm ([database-pressure](#database-pressure)) và CPU ([host-resources](#host-resources)).
- api-gateway không nằm trong rule này vì nó proxy cả các lời gọi AI/LLM vốn chậm.

<a id="host-resources"></a>
## Tài nguyên VPS (CPU, RAM, đĩa)

- `docker stats --no-stream`, `free -h`, `df -h`.
- Đĩa: log Docker đã xoay vòng; kiểm tra `backups/` (giữ theo `BACKUP_KEEP_DAYS`) và dữ liệu Prometheus.
- RAM: ai-service giới hạn 3 GB, Postgres 2 GB; tổng giới hạn xem `docs/MONITORING.md`.

<a id="container-resources"></a>
## Container gần giới hạn bộ nhớ hoặc bị OOM

- `docker stats --no-stream`; `docker inspect <container> --format '{{.State.OOMKilled}} {{.RestartCount}}'`.
- Container bị OOM lặp lại: điều tra rò rỉ trước khi tăng `limits` trong `compose.prod.yml`.

<a id="database-pressure"></a>
## PostgreSQL: áp lực kết nối, deadlock

- `dc exec -T db psql -U "$POSTGRES_USER" -d postgres -c "select datname, usename, state, count(*) from pg_stat_activity group by 1,2,3 order by 4 desc"`.
- Truy vấn chạy lâu: `select pid, now()-query_start, left(query,120) from pg_stat_activity where state='active' order by 2 desc`.
- Deadlock: xem log `db` quanh thời điểm cảnh báo.

<a id="outbox"></a>
## Outbox tồn đọng hoặc FAILED (nghiệp vụ)

Event của inventory-service chưa được publish sau 5 phút, hoặc đã bỏ cuộc (FAILED).

- Kiểm tra đọc trước: `select id, event_type, status, retry_count, occurred_at from integration_outbox where status <> 'PUBLISHED' order by occurred_at limit 50;` (inventory_db).
- Nguyên nhân thường gặp: RabbitMQ ngừng ([rabbitmq-consumers](#rabbitmq-consumers)).
- Không đổi trạng thái bản ghi chỉ để tắt cảnh báo; replay theo `docs/PRODUCTION_OPERATIONS.md`.

<a id="reconciliation"></a>
## Đối soát mượn trả cần xem xét / bị kẹt

Theo `docs/tasks/BORROW_RECONCILIATION_OPERATIONS.md`. Đọc hàng đợi trước, giữ correlation id, không sửa tay khi chưa được duyệt.

<a id="payment"></a>
## Thanh toán: tiền chưa phân bổ, callback lỗi

- Tiền đã nhận nhưng chưa áp vào khoản phạt/nạp ví: xử lý phân bổ hoặc hoàn tiền theo quy trình tài chính.
- Callback VNPay lỗi: bao gồm chữ ký sai (`97`), có thể là thử nghiệm hoặc giả mạo. Kiểm tra log borrow-service, không tắt cảnh báo bằng cách sửa dữ liệu.

<a id="reservation-conflicts"></a>
## Xung đột đặt trước tăng bất thường

Ngưỡng ban đầu 5 lần/phút (chưa có baseline). Kiểm tra tồn kho khả dụng của các đầu sách được đặt nhiều. Đây là cảnh báo nghiệp vụ, không phải lỗi hệ thống.

<a id="low-stock"></a>
## Tồn kho thấp

Có biến thể ở mức hoặc dưới điểm đặt hàng lại trong 30 phút. Xem trang **Gợi ý đặt hàng lại**; mặc định chỉ thông báo trong ứng dụng.

<a id="warehouse-flow"></a>
## Phiếu nhập kẹt / ngoại lệ kho tăng

- Phiếu nhập ở DRAFT quá 24 giờ (`GOODS_RECEIPT_STUCK_HOURS`): liên hệ kho để hoàn tất hoặc hủy.
- Nhiều báo cáo ngoại lệ trong 24 giờ cho một loại tác vụ: xem **Báo cáo ngoại lệ** để tìm nguyên nhân chung (nhà cung cấp, vị trí, nhân sự).

<a id="business-metrics-missing"></a>
## Metrics nghiệp vụ không được thu thập

Dịch vụ vẫn trả metrics, nhưng các gauge đọc từ DB (outbox, thanh toán) đang thiếu, thường do truy vấn DB lỗi. Các cảnh báo nghiệp vụ của dịch vụ đó đang "mù". Xem log `[metrics] collection failed` và [database-unavailable](#database-unavailable).

<a id="ai-provider"></a>
## AI provider lỗi / quota bị từ chối

- Lỗi OpenRouter: kiểm tra trạng thái nhà cung cấp và `OPENROUTER_API_KEY`; nghiệp vụ không phụ thuộc AI vẫn chạy.
- Từ chối do quota/ngân sách: đây là hành vi bảo vệ chi phí; chỉ nâng hạn mức khi có phê duyệt.

<a id="ai-ocr"></a>
## Tỷ lệ OCR sách thất bại cao

Hơn 30% lượt quét thất bại trong 30 phút (khi có ≥ 5 lượt). Xem `ai_book_ocr_scans_total` theo `outcome` trên dashboard AI; kiểm tra model OCR và timeout.

<a id="ai-cost"></a>
## Chi phí LLM vượt ngân sách ngày

Chi phí OpenRouter 24 giờ vượt 2 USD (ngưỡng trong `rules.yaml`, sửa theo ngân sách đã duyệt). Xem dashboard AI theo `feature` để biết tính năng nào tăng chi phí.

<a id="ai-catalog-sync"></a>
## Đồng bộ catalog cho AI bị chậm

Không có lần đồng bộ thành công trong 60 phút: sách mới chưa tìm được bằng AI. Xem log `catalog_sync` của ai-service và kết nối tới inventory-service.
