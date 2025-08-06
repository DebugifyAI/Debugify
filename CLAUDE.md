# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Debugify is a full-stack web application using React frontend and Express.js backend, with PostgreSQL database. The project uses a monorepo structure with pnpm workspaces and is containerized with Docker.

## Essential Commands

### Development
```bash
# Install dependencies (use pnpm, not npm)
pnpm install

# Start development environment (frontend + backend)
pnpm dev

# Run with Docker
pnpm docker:up
```

### Database Management
```bash
# Run migrations
pnpm db:migrate

# Seed database
pnpm db:seed

# Reset database (rollback, migrate, seed)
pnpm db:reset
```

### Build & Deploy
```bash
# Build all packages
pnpm build

# Build Docker images
pnpm docker:build

# Lint all packages
pnpm lint
```

### Testing
```bash
# Run tests (when implemented)
pnpm test

# Run specific test file (frontend)
cd services/frontend && pnpm test path/to/test.spec.js

# Run specific test file (backend)
cd services/server && pnpm test path/to/test.spec.js
```

## Architecture

### Monorepo Structure
- `/services/frontend/` - React application (Vite)
- `/services/server/` - Express.js API server
- Root `package.json` manages workspace scripts
- Use `pnpm` for all package operations

### Frontend Architecture
- **Adapters** (`/services/frontend/src/adapters/`): API communication layer
  - `auth-adapter.js`: Authentication API calls
  - `user-adapter.js`: User CRUD operations
- **Contexts**: React Context for global state (CurrentUserContext)
- **Pages**: Route components mapped to URLs
- **Components**: Reusable UI components
- **Routing**: React Router v6 with protected routes

### Backend Architecture
- **Controllers** (`/services/server/controllers/`): Route handlers
  - `authControllers.js`: Authentication logic
  - `userControllers.js`: User CRUD logic
- **Middleware**: 
  - `checkAuthentication.js`: Protects routes
  - `handleCookieSessions.js`: Cookie-based sessions
- **Models** (`/services/server/models/`): Data models with Knex.js
- **Database**: PostgreSQL with Knex migrations

### Authentication Flow
1. Cookie-based sessions (encrypted)
2. Bcrypt password hashing (12 rounds)
3. Session stored in `req.session.userId`
4. Protected routes use `checkAuthentication` middleware

### API Structure
- Base URL: `/api`
- Auth endpoints: `/api/auth/*`
- User endpoints: `/api/users/*` (protected)
- Frontend proxies to backend on port 3001 in development

## Database Schema

### Users Table
```sql
- id: integer, primary key, auto-increment
- username: string, unique, not null
- password_hash: string, not null
- created_at: timestamp
- updated_at: timestamp
```

## Development Workflow

### Adding New Features
1. Create database migration if schema changes needed:
   ```bash
   cd services/server
   npx knex migrate:make migration_name
   ```

2. Update model in `/services/server/models/`

3. Add controller logic in `/services/server/controllers/`

4. Create frontend adapter in `/services/frontend/src/adapters/`

5. Build React components/pages as needed

### Environment Variables
Create `.env` file in `/services/server/` with:
```
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://user:pass@localhost:5432/debugify
PG_HOST=localhost
PG_PORT=5432
PG_USER=your_user
PG_PASS=your_password
PG_DB=debugify_dev
```

### Docker Development
- PostgreSQL runs on port 5432
- Server runs on port 3001
- Frontend development server on port 5173
- Use `docker-compose.yml` for multi-service setup

## Code Conventions

### Frontend
- Functional components with hooks
- Context for global state management
- Adapters pattern for API calls
- CSS modules or styled-components for styling

### Backend
- Async/await for asynchronous operations
- Error handling with try/catch blocks
- Middleware for cross-cutting concerns
- Model methods for database operations

### General
- Use ESLint configuration provided
- Prefer const over let
- Destructure when possible
- Handle errors appropriately at all levels