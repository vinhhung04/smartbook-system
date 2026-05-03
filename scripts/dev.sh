#!/bin/bash
# SmartBook Development Server (Unix/macOS/Linux)
# Usage: ./scripts/dev.sh [service]

set -e

SERVICE="${1:-all}"

case "$SERVICE" in
  all)
    echo "Starting all services..."
    pnpm dev
    ;;
  web)
    echo "Starting web frontend..."
    pnpm dev:web
    ;;
  auth)
    echo "Starting auth service..."
    pnpm dev:auth
    ;;
  inventory)
    echo "Starting inventory service..."
    pnpm dev:inventory
    ;;
  gateway)
    echo "Starting API gateway..."
    pnpm dev:gateway
    ;;
  *)
    echo "Usage: $0 [all|web|auth|inventory|gateway]"
    exit 1
    ;;
esac
