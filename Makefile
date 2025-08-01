.PHONY: help install dev build test lint clean docker-build docker-up docker-down db-migrate db-seed db-reset

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install all dependencies
	pnpm install

dev: ## Start development environment
	pnpm run dev

build: ## Build all packages
	pnpm run build

test: ## Run tests
	pnpm run test

lint: ## Run linting
	pnpm run lint

clean: ## Clean all build artifacts
	pnpm run clean
	rm -rf node_modules
	find . -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true

docker-build: ## Build Docker images
	pnpm run docker:build

docker-up: ## Start Docker services
	pnpm run docker:up

docker-down: ## Stop Docker services
	pnpm run docker:down

db-migrate: ## Run database migrations
	pnpm run db:migrate

db-seed: ## Seed database with sample data
	pnpm run db:seed

db-reset: ## Reset database (migrate + seed)
	pnpm run db:reset

setup: install docker-up db-migrate db-seed ## Complete setup (install, docker, db)
	@echo "Setup complete! Run 'make dev' to start development." 