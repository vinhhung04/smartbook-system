#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE_FILE="$ROOT_DIR/.env.example"

REQUIRED_ENV_KEYS=(
  POSTGRES_USER
  POSTGRES_PASSWORD
  DB_HOST
  DB_PORT
  DB_USER
  DB_PASSWORD
  AUTH_DB_NAME
  INVENTORY_DB_NAME
  JWT_SECRET
  PGADMIN_DEFAULT_EMAIL
  PGADMIN_DEFAULT_PASSWORD
)

REQUIRED_SERVICES=(
  db
  pgadmin
  inventory-service
  auth-service
  ai-service
  api-gateway
  smartbook-ui
  ollama
)

warn() { echo "[WARN] $*"; }
info() { echo "[INFO] $*"; }
error() { echo "[ERROR] $*" >&2; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "Thiếu lệnh '$1'."
    exit 1
  fi
}

env_value() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d'=' -f2-
}

main() {
  need_cmd docker

  if ! docker info >/dev/null 2>&1; then
    error "Docker daemon chưa chạy. Hãy mở Docker Desktop / start docker service trước."
    exit 1
  fi

  if [[ ! -f "$COMPOSE_FILE" ]]; then
    error "Không tìm thấy docker-compose.yml tại $COMPOSE_FILE"
    exit 1
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    if [[ -f "$ENV_EXAMPLE_FILE" ]]; then
      cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
      info "Đã tạo .env từ .env.example"
    else
      error "Thiếu .env và cũng không có .env.example"
      exit 1
    fi
  fi

  local missing=0
  for key in "${REQUIRED_ENV_KEYS[@]}"; do
    if ! grep -qE "^${key}=" "$ENV_FILE"; then
      error "Thiếu biến môi trường bắt buộc: $key"
      missing=1
      continue
    fi

    local value
    value="$(env_value "$key" || true)"
    if [[ -z "$value" ]]; then
      error "Biến môi trường bắt buộc đang rỗng: $key"
      missing=1
    fi
  done

  if [[ "$missing" -ne 0 ]]; then
    error "Vui lòng cập nhật .env rồi chạy lại."
    exit 1
  fi

  local services
  services="$(docker compose -f "$COMPOSE_FILE" config --services)"

  for svc in "${REQUIRED_SERVICES[@]}"; do
    if ! echo "$services" | grep -qx "$svc"; then
      error "Thiếu service bắt buộc trong docker-compose.yml: $svc"
      exit 1
    fi
  done

  if [[ ! -d "$ROOT_DIR/db-init" ]]; then
    warn "Không tìm thấy thư mục db-init. DB extension/init script có thể không chạy."
  fi

  if [[ ! -f "$ROOT_DIR/db-init/01-extensions.sql" ]]; then
    warn "Thiếu db-init/01-extensions.sql (pg_trgm có thể chưa được bật)."
  fi

  info "Kiểm tra môi trường hoàn tất: OK"
}

main "$@"
