# Kiến trúc SmartBook

README ở thư mục gốc là nguồn mô tả kiến trúc hiện hành duy nhất:

- [Kiến trúc tổng quan](../../README.md#kiến-trúc-tổng-quan)
- [Service catalog](../../README.md#service-catalog)
- [Database và Redis](../../README.md#kiến-trúc-tổng-quan)
- [HTTP Gateway và WebSocket](../../README.md#real-time--thông-báo)

Hệ thống hiện gồm Web UI, App di động (Expo), API Gateway, năm service nghiệp vụ (Auth, Inventory, Borrow, Analytics, AI), PostgreSQL + pgvector với bốn database (`auth_db`, `inventory_db`, `borrow_db` cho ba domain nghiệp vụ và `ai_db` riêng của AI Service), Redis, RabbitMQ (transactional outbox) và bộ observability (Tempo, Prometheus, Grafana, Loki/Promtail). AI Service gọi OpenRouter (Qwen) làm backend inference — không cần container/GPU riêng. AI và pgAdmin là profile tùy chọn; database, Redis và service nội bộ không publish port ra host.
