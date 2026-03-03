# SpacetimeDB Auth Demo - Client + Auth for Railway
# Builds React client and Node auth server; auth serves both OIDC and static client.

# --- Stage 1: Build client ---
FROM node:20-alpine AS client-builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY client ./client
COPY vite.config.ts tsconfig*.json ./
RUN npm run build

# --- Stage 2: Build auth ---
FROM node:20-alpine AS auth-builder
WORKDIR /app

COPY auth/package.json auth/package-lock.json* ./auth/
WORKDIR /app/auth
RUN npm ci

COPY auth ./
RUN npm run build

# --- Stage 3: Production image ---
FROM node:20-alpine
WORKDIR /app

# Copy auth server (dist has compiled JS; run from /app)
COPY --from=auth-builder /app/auth/dist ./dist
COPY --from=auth-builder /app/auth/package.json ./
COPY --from=auth-builder /app/auth/node_modules ./node_modules

# Copy built client (auth serves SPA from /)
COPY --from=client-builder /app/dist ./client-dist

# Railway sets PORT; default 4001 for local
ENV NODE_ENV=production
ENV PORT=4001
EXPOSE 4001

CMD ["node", "dist/index.js"]
