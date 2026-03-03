# SpacetimeDB Auth Demo

A minimal SpacetimeDB app with OpenAuth: login, choose username, welcome screen, and logout.

- **Frontend:** React, TypeScript, Vite
- **Backend:** SpacetimeDB (Rust/WASM)
- **Auth:** OpenAuth (auth server in `auth/`)

## Prerequisites

- **Node.js** 18+ and npm
- **Rust** (for SpacetimeDB server): [rustup.rs](https://rustup.rs)
- **SpacetimeDB CLI** 2.0.x: [spacetimedb.com/install](https://spacetimedb.com/install)

## Quick Start

### 1. Install and build

```bash
npm install
spacetime build -p ./server
spacetime generate --lang typescript --out-dir ./client/src/generated -p ./server
```

### 2. Start SpacetimeDB (terminal 1)

```bash
spacetime start
```

### 3. Publish the module (terminal 2)

```bash
npm run deploy:local
```

Or manually: `spacetime publish -p ./server spacetimedb-auth-demo-local`

### 4. Start the auth server (terminal 2 or 3)

```bash
cd auth
cp .env.example .env
npm run keys   # Copy output into .env for JWT_PRIVATE_KEY and JWT_PUBLIC_KEY
npm run dev
```

### 5. Run the client (terminal 3 or 4)

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Sign in, choose a username, and you'll see a welcome message with logout.

## Environment

- `VITE_AUTH_SERVER_URL` – Auth server URL (default: `http://localhost:4001` in dev)
- `VITE_AUTH_CLIENT_ID` – OIDC client ID (default: `vibe-survival-game-client`)

## Project Structure

```
├── client/           # React + Vite frontend
│   └── src/
│       ├── generated/   # SpacetimeDB bindings (run spacetime generate)
│       ├── contexts/    # Auth + SpacetimeDB
│       └── ui/          # LoginScreen, WelcomeScreen
├── server/           # SpacetimeDB Rust module (User table, set_username)
│   └── src/lib.rs
├── auth/             # OpenAuth server
└── package.json
```

## Docker + Railway

Deploy client and auth together to Railway:

1. **Generate SpacetimeDB bindings** (required before build):
   ```bash
   spacetime build -p ./server
   spacetime generate --lang typescript --out-dir ./client/src/generated -p ./server
   ```

2. **Push to Railway** – Railway auto-detects the root `Dockerfile`.

3. **Set environment variables** in Railway:
   - `ISSUER_URL` – Your Railway deployment URL (e.g. `https://your-app.up.railway.app`). Railway sets `RAILWAY_STATIC_URL` automatically.
   - `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` – From `cd auth && npm run keys`
   - `DATABASE_URL` – PostgreSQL connection string (optional; uses in-memory if unset)

4. **Build locally** (optional):
   ```bash
   docker build -t spacetimedb-auth-demo .
   docker run -p 4001:4001 -e JWT_PRIVATE_KEY="..." -e JWT_PUBLIC_KEY="..." spacetimedb-auth-demo
   ```

## SpacetimeDB Commands

```bash
spacetime build -p ./server
npm run deploy:local          # Publish to spacetimedb-auth-demo-local
npm run deploy:local-clean   # Clear + republish local
npm run deploy:prod          # Publish to spacetimedb-auth-demo (maincloud)
npm run deploy:prod-clean    # Delete + republish production
spacetime logs spacetimedb-auth-demo-local
```

## License

This project is licensed under the [MIT License](LICENSE). You may use, modify, and distribute it under the terms of that license.

## Disclaimer

This repository is an independent personal project for educational/demo purposes.

- It is **not** affiliated with, endorsed by, sponsored by, or officially connected to SpacetimeDB or Clockwork Labs.
- The project is provided **"AS IS"**, without warranties of any kind.
- You assume all risk for use, modification, deployment, and operation, including security, legal, and data-handling responsibilities.
- To the maximum extent permitted by law, authors/contributors are not liable for damages resulting from use of this project.

In the running app, see the full disclaimer text on the `DISCLAIMER` legal page (`/disclaimer`).
