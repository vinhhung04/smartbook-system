# Kiến trúc SmartBook

README ở thư mục gốc là nguồn mô tả kiến trúc hiện hành duy nhất:

- [Kiến trúc tổng quan](../../README.md#kiến-trúc-tổng-quan)
- [Service catalog](../../README.md#service-catalog)
- [Ba database và Redis](../../README.md#kiến-trúc-tổng-quan)
- [HTTP Gateway và WebSocket](../../README.md#real-time--thông-báo)

Hệ thống hiện gồm Web UI, API Gateway, năm service nghiệp vụ (Auth, Inventory, Borrow, Analytics, AI), PostgreSQL với ba database domain và Redis. AI/Ollama và pgAdmin là profile tùy chọn; database, Redis và service nội bộ không publish port ra host.
