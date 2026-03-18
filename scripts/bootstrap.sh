#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"

info() { echo "[INFO] $*"; }
warn() { echo "[WARN] $*"; }
error() { echo "[ERROR] $*" >&2; }

check_http() {
  local url="$1"
  local name="$2"

  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      info "$name: OK ($url)"
      return 0
    fi
  elif command -v wget >/dev/null 2>&1; then
    if wget -q --spider --timeout=5 "$url"; then
      info "$name: OK ($url)"
      return 0
    fi
  else
    warn "Không có curl/wget, bỏ qua kiểm tra HTTP cho $name"
    return 0
  fi

  warn "$name chưa sẵn sàng tại $url"
  return 1
}

run_migration() {
  local profile_service="$1"
  local label="$2"

  info "Chạy $label..."
  if ! docker compose -f "$COMPOSE_FILE" --profile dev run --rm "$profile_service"; then
    warn "$label thất bại. Kiểm tra logs và thử chạy lại sau khi DB ready."
    return 1
  fi
  info "$label hoàn tất"
}

main() {
  "$ROOT_DIR/scripts/check-env.sh"

  info "Khởi động toàn bộ stack Docker..."
  docker compose -f "$COMPOSE_FILE" up -d --build

  info "Đợi dịch vụ lên trong 15 giây..."
  sleep 15

  info "Trạng thái container:"
  docker compose -f "$COMPOSE_FILE" ps

  run_migration auth-db-push "Prisma db push (auth)" || true
  run_migration inventory-db-push "Prisma db push (inventory)" || true

  info "Kiểm tra endpoint nhanh:"
  check_http "http://localhost:3000/health" "api-gateway" || true
  check_http "http://localhost:3004/health" "auth-service" || true
  check_http "http://localhost:8000/health" "ai-service" || true

  info "Bootstrap hoàn tất"
  cat <<EOF

=== URL LOCAL ===
Web UI:        http://localhost:5173
API Gateway:   http://localhost:3000/health
Auth Service:  http://localhost:3004/health
AI Service:    http://localhost:8000/health
PostgreSQL:    localhost:5432
pgAdmin:       http://localhost:8080
Ollama:        http://localhost:11434

=== LỆNH HỮU ÍCH ===
Xem trạng thái: docker compose ps
Xem logs:       docker compose logs -f --tail 200
Dừng stack:     docker compose down
Dừng + xoá DB:  docker compose down -v
EOF
}

main "$@"
