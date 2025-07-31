
# FROM node:20-alpine AS builder
# WORKDIR /app
# COPY services/frontend/package.json ./
# RUN npm install
# COPY services/frontend/ ./
# RUN npm run build

# FROM node:20-alpine
# WORKDIR /app
# COPY services/frontend/package.json ./
# RUN npm install --production
# COPY --from=builder /app/dist ./dist
# COPY services/server/index.js ./index.js
# RUN npm install
# EXPOSE 3000
# CMD ["npm", "run", "preview", "--port", "--strictPort"]

###############  Stage 1 – deps  ###############
FROM node:20-alpine AS deps
WORKDIR /app
# copy workspace manifests so npm can resolve workspace graph
COPY package.json ./
RUN npm install                             

###############  Stage 2 – build ###############
FROM node:20-alpine AS builder
WORKDIR /app/services/frontend
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY services/frontend/ ./
RUN npm run build

###############  Stage 3 – runtime ###########
FROM node:20-alpine
WORKDIR /app
ENV PORT=3000 NODE_ENV=production
# static assets
COPY --from=builder /app/services/frontend/dist ./dist
# only vite preview + peer deps are needed; reuse layer from deps
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "exec", "--", "vite", "preview", "--port", "3000", "--strictPort"]
