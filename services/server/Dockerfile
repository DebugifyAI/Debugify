### Stage 1 - install the workspace dependencies ### 
FROM node:20-alpine AS deps
WORKDIR /app 
COPY package.json ./
RUN npm install

### Stage 2 - Build the frontend assets ###
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY services/frontend/package.json ./
RUN npm install
COPY services/frontend ./
RUN npm run build
RUN ls -la 
RUN cat ./dist/index.html || echo "index.html not found"
WORKDIR /app/dist
RUN ls -la
# ─────────────────────────────────────────────
#  Stage 3 – runtime image
# ─────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001

# Copy the server source code.
COPY services/server/ ./

# Install the server dependencies 
RUN npm install

# Copy the built assets to the static-assets folder.
COPY --from=frontend-builder /app/dist ../static-assets
RUN ls -la 

EXPOSE 3001
# Runs the migrations and seed the database 
CMD ["sh","-c","npx knex migrate:rollback && npx knex migrate:latest && npx knex seed:run && exec node index.js"]
