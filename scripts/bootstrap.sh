#!/bin/bash
# SmartBook Dev Bootstrap Script (Unix/macOS/Linux)
# Usage: ./scripts/bootstrap.sh

set -e

echo "======================================"
echo "SmartBook System - Bootstrap"
echo "======================================"

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not installed"
    echo "Install with: npm install -g pnpm"
    exit 1
fi

echo "Installing dependencies..."
pnpm install

echo ""
echo "Checking environment..."
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
        echo "Please edit .env with your configuration"
    else
        echo "Warning: No .env or .env.example found"
    fi
else
    echo ".env already exists"
fi

echo ""
echo "======================================"
echo "Bootstrap complete!"
echo "======================================"
echo ""
echo "To start development:"
echo "  pnpm dev          - Start all services"
echo "  pnpm dev:web     - Start web only"
echo "  pnpm dev:auth    - Start auth service only"
echo "  pnpm dev:inventory - Start inventory service only"
