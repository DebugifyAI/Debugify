# ─────────────────────────────────────────────
#  Stage 1 – install workspace dependencies
# ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY . .
RUN corepack enable && pnpm install --frozen-lockfile

# ─────────────────────────────────────────────
#  Stage 2 – copy service code
# ─────────────────────────────────────────────
FROM node:20-alpine AS sources
WORKDIR /app
# Bring node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
# Copy *only* the server package
COPY . .

# ─────────────────────────────────────────────
#  Stage 3 – runtime image
# ─────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000

# Copy compiled JS (or raw JS if you don’t transpile)
COPY --from=sources /app .

EXPOSE 4000
# Runs the migrations and seed the database 
CMD ["sh","-c","npx knex migrate:latest && npx knex seed:run && exec node src/index.js"]
