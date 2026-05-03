#!/bin/bash
# SmartBook Health Check Script (Unix/macOS/Linux)
# Usage: ./scripts/healthcheck.sh

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
TIMEOUT=30

check_service() {
    local name="$1"
    local url="$2"

    echo -n "Checking $name... "
    if curl -s --max-time "$TIMEOUT" "$url" > /dev/null 2>&1; then
        echo "OK"
        return 0
    else
        echo "FAILED"
        return 1
    fi
}

echo "======================================"
echo "SmartBook Health Check"
echo "======================================"
echo ""

FAILED=0

check_service "Web Frontend" "$BASE_URL" || ((FAILED++))
check_service "API Gateway" "http://localhost:3001/health" || ((FAILED++))
check_service "Auth Service" "http://localhost:3001/api/auth/health" || ((FAILED++))
check_service "Inventory Service" "http://localhost:3002/api/health" || ((FAILED++))
check_service "Borrow Service" "http://localhost:3003/api/health" || ((FAILED++))

echo ""
echo "======================================"
if [ $FAILED -eq 0 ]; then
    echo "All services healthy!"
    exit 0
else
    echo "$FAILED service(s) failed"
    exit 1
fi
