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
RUN npm prune --omit=dev

# --- Stage 3: Production image ---
FROM node:20-alpine
WORKDIR /app

# Copy auth server (dist has compiled JS; run from /app)
COPY --chown=node:node --from=auth-builder /app/auth/dist ./dist
COPY --chown=node:node --from=auth-builder /app/auth/package.json ./
COPY --chown=node:node --from=auth-builder /app/auth/node_modules ./node_modules
COPY --chown=node:node --from=auth-builder /app/auth/favicon.png ./favicon.png
COPY --chown=node:node --from=auth-builder /app/auth/login_background_v2.jpg ./login_background_v2.jpg

# Copy built client (auth serves SPA from /)
COPY --chown=node:node --from=client-builder /app/dist ./client-dist
COPY --chown=node:node --from=client-builder /app/client/src/theme ./client/src/theme

# Railway sets PORT; default 4001 for local
ENV NODE_ENV=production
ENV PORT=4001
EXPOSE 4001

USER node

CMD ["node", "dist/index.js"]
