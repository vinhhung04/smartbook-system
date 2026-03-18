.PHONY: help setup up down restart logs logs-all status health clean clean-volumes reset-hard \
        migrate check-env shell-db shell-api bootstrap check-ports

# Default target
help:
	@echo "╔════════════════════════════════════════════════════════════════╗"
	@echo "║          SmartBook Docker Development Commands                ║"
	@echo "╚════════════════════════════════════════════════════════════════╝"
	@echo ""
	@echo "🚀 QUICK START:"
	@echo "  make setup              Automated bootstrap (copy .env, build, start, migrate)"
	@echo "  make up                 Start all services"
	@echo "  make down               Stop all services"
	@echo ""
	@echo "🔍 MONITORING:"
	@echo "  make status             Show container status"
	@echo "  make logs               Show logs (all services, tail 100)"
	@echo "  make logs-all           Show all logs (all services, tail 200)"
	@echo "  make logs-SVC=api-gateway"
	@echo "                          Show logs for specific service"
	@echo "  make health             Check health endpoints"
	@echo ""
	@echo "🔧 MAINTENANCE:"
	@echo "  make restart            Restart all services"
	@echo "  make restart-SVC=api-gateway"
	@echo "                          Restart specific service"
	@echo "  make rebuild            Rebuild docker images"
	@echo "  make build-SVC=auth-service"
	@echo "                          Rebuild specific service"
	@echo ""
	@echo "🗄️  DATABASE:"
	@echo "  make migrate            Run migrations (auth + inventory db push)"
	@echo "  make shell-db           Connect to PostgreSQL shell"
	@echo "  make clean-volumes      Stop stack and remove volumes (⚠️ DELETES DATA)"
	@echo ""
	@echo "🧹 CLEANUP:"
	@echo "  make check-env          Validate environment"
	@echo "  make check-ports        Check if ports are in use"
	@echo "  make clean              Stop containers"
	@echo "  make reset-hard         Full reset: stop, remove images, rebuild"
	@echo ""
	@echo "🐚 DEBUG:"
	@echo "  make shell-db           PostgreSQL shell"
	@echo "  make shell-api          Shell into api-gateway container"
	@echo ""

# Bootstrap - Full setup from scratch
setup:
	@echo "[INFO] Running automated bootstrap..."
	@bash scripts/bootstrap.sh

# Basic Docker commands
up:
	@echo "[INFO] Starting Docker stack..."
	docker compose up -d --build
	@echo "[INFO] Services starting (wait 15-20 seconds)..."

down:
	@echo "[INFO] Stopping Docker stack..."
	docker compose down

restart:
	@echo "[INFO] Restarting all services..."
	docker compose restart

restart-SVC:
	@echo "[INFO] Restarting $(SVC)..."
	docker compose restart $(SVC)

# Build
rebuild:
	@echo "[INFO] Rebuilding all services..."
	docker compose build --no-cache

build-SVC:
	@echo "[INFO] Rebuilding $(SVC)..."
	docker compose build --no-cache $(SVC)

# Status & Monitoring
status:
	@echo "[INFO] Container status:"
	docker compose ps

health:
	@echo "[INFO] Checking health endpoints..."
	@echo ""
	@echo "API Gateway:  http://localhost:3000/health"
	@curl -s http://localhost:3000/health 2>/dev/null | jq . || echo "❌ Not responding"
	@echo ""
	@echo "Auth Service: http://localhost:3004/health"
	@curl -s http://localhost:3004/health 2>/dev/null | jq . || echo "❌ Not responding"
	@echo ""
	@echo "AI Service:   http://localhost:8000/health"
	@curl -s http://localhost:8000/health 2>/dev/null | jq . || echo "❌ Not responding"
	@echo ""
	@echo "Ollama:       http://localhost:11434/api/tags"
	@curl -s http://localhost:11434/api/tags 2>/dev/null | jq .models || echo "❌ Not responding"

# Logs
logs:
	docker compose logs -f --tail 100

logs-all:
	docker compose logs -f --tail 200

logs-SVC:
	docker compose logs -f $(SVC)

# Database
migrate:
	@echo "[INFO] Running database migrations..."
	docker compose --profile dev run --rm auth-db-push
	docker compose --profile dev run --rm inventory-db-push
	@echo "[INFO] Migrations complete!"

shell-db:
	@echo "[INFO] Connecting to PostgreSQL..."
	docker compose exec db psql -U $${POSTGRES_USER:-user} -d $${AUTH_DB_NAME:-auth_db}

shell-api:
	@echo "[INFO] Opening shell in api-gateway container..."
	docker compose exec api-gateway sh

# Cleanup
check-env:
	@echo "[INFO] Validating environment..."
	bash scripts/check-env.sh

check-ports:
	@echo "[INFO] Checking port availability..."
	@for port in 3000 3001 3002 3003 3004 5173 5432 8000 8080 11434; do \
		if command -v lsof >/dev/null 2>&1; then \
			if lsof -i :$$port >/dev/null 2>&1; then \
				echo "⚠️  Port $$port is in use"; \
			else \
				echo "✅ Port $$port is free"; \
			fi; \
		elif command -v netstat >/dev/null 2>&1; then \
			echo "Checking port $$port..."; \
		fi; \
	done

clean:
	@echo "[INFO] Stopping containers..."
	docker compose down

clean-volumes:
	@echo "⚠️  WARNING: This will delete all database volumes and data!"
	@read -p "Continue? (y/N) " -n 1 -r; \
	echo ""; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		echo "[INFO] Removing containers and volumes..."; \
		docker compose down -v; \
		echo "[INFO] Data removed. Run 'make up' to rebuild."; \
	else \
		echo "[INFO] Cancelled."; \
	fi

reset-hard:
	@echo "⚠️  WARNING: This will completely reset the Docker environment!"
	@echo "This will permanently delete:"
	@echo "  - All containers"
	@echo "  - All volumes (databases, ollama data)"
	@echo "  - All built images"
	@read -p "Continue? (y/N) " -n 1 -r; \
	echo ""; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		echo "[INFO] Stopping stack..."; \
		docker compose down -v || true; \
		echo "[INFO] Removing images..."; \
		docker rmi $$(docker images | grep "smartbook\|api-gateway\|auth-service\|inventory-service\|ai-service" | awk '{print $$3}') 2>/dev/null || true; \
		echo "[INFO] Pruning system..."; \
		docker system prune -af --volumes || true; \
		echo "[INFO] Reset complete. Run 'make setup' to rebuild."; \
	else \
		echo "[INFO] Cancelled."; \
	fi

# Aliases for common dev workflow
ps: status
log: logs
restart-all: restart
clean-all: clean-volumes

# Service-specific shortcuts
api: restart-SVC
	@docker compose exec api-gateway sh

auth: restart-SVC
	@docker compose exec auth-service sh

db: shell-db

# Local web UI
web-ui:
	@echo "[INFO] Opening http://localhost:5173 in browser..."
	@if command -v $(BROWSER) >/dev/null 2>&1; then \
		$(BROWSER) http://localhost:5173; \
	elif command -v open >/dev/null 2>&1; then \
		open http://localhost:5173; \
	elif command -v xdg-open >/dev/null 2>&1; then \
		xdg-open http://localhost:5173; \
	else \
		echo "Please open http://localhost:5173 in your browser"; \
	fi

version:
	@echo "[INFO] Version info:"
	@docker --version
	@docker compose version

.PHONY: version web-ui
