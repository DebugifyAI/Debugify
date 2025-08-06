# Environment Configuration for Debugify

This document outlines the required environment variables for the Debugify application with JWT authentication.

## JWT Authentication Variables

### Required for Production
- `JWT_SECRET`: **CRITICAL** - Secret key used to sign JWT tokens. Must be a long, random string in production.
- `JWT_EXPIRES_IN`: Token expiration time (default: 24h). Examples: "1h", "30d", "7 days"

### Example Production Values
```bash
# Generate a secure secret (recommended):
# openssl rand -base64 64
JWT_SECRET=your-generated-secure-secret-here
JWT_EXPIRES_IN=24h
```

## Database Configuration

### Option 1: Connection String (Recommended)
```bash
DATABASE_URL=postgresql://username:password@host:port/database_name
```

### Option 2: Individual Parameters
```bash
PG_HOST=localhost
PG_PORT=5432
PG_USER=debugify
PG_PASS=your-secure-password
PG_DB=debugify
```

## Server Configuration

```bash
NODE_ENV=production  # or development
PORT=3001
SERVER_PORT=3001  # External port mapping for Docker
```

## Docker-Specific Configuration

### Database Variables (Docker Compose)
```bash
POSTGRES_DB=debugify
POSTGRES_USER=debugify
POSTGRES_PASSWORD=your-secure-db-password
POSTGRES_PORT=5432  # External port mapping
```

## Security Notes

1. **Never commit actual secrets to version control**
2. **Use different JWT secrets for different environments**
3. **Use strong, unique passwords for database connections**
4. **Consider shorter JWT expiration times for sensitive applications**

## Docker Compose Usage

The docker-compose.yml file will use:
1. Environment variables from your shell
2. Variables from `.env` file (if present)
3. Default values (suitable for development only)

### Creating your .env file
Create a `.env` file in the project root with your specific values:

```bash
# Generate a secure JWT secret first:
# openssl rand -base64 64
JWT_SECRET=your-generated-secure-secret-here
JWT_EXPIRES_IN=24h

# Database credentials (change for production)
POSTGRES_PASSWORD=your-secure-database-password

# Optional: Custom port mappings
SERVER_PORT=3001
POSTGRES_PORT=5432

# Add other variables as needed
```

## Quick Setup Commands

### Generate Secure JWT Secret
```bash
# Linux/macOS
openssl rand -base64 64

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

## React Client to Backend Connection

### Development Setup (Separate Frontend/Backend Services)
```bash
# Development with hot reloading
docker-compose up

# Frontend: http://localhost:5173 (Vite dev server)
# Backend API: http://localhost:3001
# Database: localhost:5432
```

### Production Setup (Static Build Served by Backend)
```bash
# Production build (frontend served by backend)
JWT_SECRET=$(openssl rand -base64 64) docker-compose -f docker-compose.prod.yml up -d

# Application: http://localhost:3001 (backend serves static frontend)
# API: http://localhost:3001/api/*
# Database: localhost:5432
```

### Local Development (Without Docker)
```bash
# Terminal 1: Start backend
cd services/server
JWT_SECRET=dev-secret npm run dev

# Terminal 2: Start frontend  
cd services/frontend
npm run dev

# Frontend: http://localhost:5173
# Backend: http://localhost:3001
```

## Frontend Configuration Variables

```bash
# API endpoint configuration
VITE_API_URL=http://localhost:3001  # For local development
VITE_API_URL=http://server:3001     # For Docker development

# Frontend port
FRONTEND_PORT=5173  # External port mapping for Docker
```

## API Connection Patterns

### Development Mode (docker-compose up)
- **Frontend**: Runs on port 5173 with Vite dev server
- **Backend**: Runs on port 3001 
- **API Calls**: Proxied through Vite (`/api/*` → `http://server:3001/api/*`)
- **Hot Reloading**: ✅ Enabled for both frontend and backend

### Production Mode (docker-compose.prod.yml)
- **Application**: Single port 3001 (backend serves everything)
- **Static Files**: Built frontend served by Express
- **API Calls**: Direct to same origin (`/api/*`)
- **Hot Reloading**: ❌ Disabled (static build)

## Troubleshooting Connection Issues

### Common Issues and Solutions

1. **CORS Errors**
   ```bash
   # Check if frontend is making requests to correct backend URL
   # In browser network tab, verify API calls go to: http://localhost:3001/api/*
   ```

2. **Port Conflicts**
   ```bash
   # Check if ports are already in use
   lsof -i :3001  # Backend port
   lsof -i :5173  # Frontend port
   lsof -i :5432  # Database port
   ```

3. **Docker Network Issues**
   ```bash
   # Recreate Docker network
   docker-compose down
   docker-compose up --build
   ```

4. **Environment Variable Issues**
   ```bash
   # Check Docker environment
   docker-compose exec server env | grep JWT
   docker-compose exec frontend env | grep VITE
   ```

### Verifying Connections

```bash
# Test backend API directly
curl http://localhost:3001/api/auth/me

# Test frontend access  
curl http://localhost:5173

# Check Docker services
docker-compose ps
docker-compose logs frontend
docker-compose logs server
```