# SpacetimeDB Auth Demo

A SpacetimeDB app with a hardened OIDC password flow: verified-email registration,
PKCE login, short-lived identity tokens, rotating refresh sessions, account recovery,
username selection, and logout.

- **Frontend:** React, TypeScript, Vite
- **Backend:** SpacetimeDB (Rust/WASM)
- **Auth:** OIDC/PKCE auth server in `auth/`

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

## Environment Variables

### Client (`client/.env`)

- `VITE_AUTH_SERVER_URL` - Auth server URL (default: `http://localhost:4001` in dev)
- `VITE_AUTH_CLIENT_ID` - OIDC client ID (default: `vibe-survival-game-client`)

### Auth server (`auth/.env`)

- `NODE_ENV` - `development` or `production`
- `PORT` - Auth server port (default: `4001`)
- `ISSUER_URL` - Public base URL for OIDC issuer (required in production)
- `AUTH_CLIENT_ID` - OIDC audience/client ID; use the same value for the client and module build
- `JWT_PRIVATE_KEY` - Required in production
- `JWT_PUBLIC_KEY` - Required in production and validated against the private key
- `DATABASE_URL` - Required in production; development uses a protected JSON file
- `RESEND_API_KEY` - Required in production for verification and recovery mail
- `RESEND_FROM` - Required production sender identity
- `ALLOWED_ORIGINS` - Required production HTTPS CORS origins (see below)
- `ALLOWED_REDIRECT_URIS` - Optional exact callback URI allowlist
- `TRUST_PROXY` - Set to `true` only behind a trusted proxy that overwrites forwarding headers

Notes:
- Generate JWT keys with `cd auth && npm run keys`.
- Production startup fails closed when required security configuration is absent.
- New passwords use scrypt. Existing bcrypt passwords are migrated after a successful login.

### CORS Whitelist

The auth server only accepts browser requests from its allowlist. Development permits
HTTP localhost origins; production requires explicit HTTPS origins:

```env
ALLOWED_ORIGINS=https://myapp.com,https://www.myapp.com
```

Development defaults are `http://localhost:5173` and `http://localhost:5176`.
Production has no permissive fallback.

### Session security

- Identity/access tokens expire after 15 minutes.
- The refresh credential is stored only in a `HttpOnly`, `SameSite=Strict` cookie.
- Refresh credentials rotate on every use, are hashed in storage, detect reuse,
  expire after 7 idle days, and have a 30-day absolute lifetime.
- Password reset consumes its token atomically and revokes every refresh session.
- Registration requires email verification before an authorization code can be issued.

## Project Structure

```
├── client/           # React + Vite frontend
│   └── src/
│       ├── generated/   # SpacetimeDB bindings (run spacetime generate)
│       ├── contexts/    # Auth + SpacetimeDB
│       └── ui/          # LoginScreen, WelcomeScreen
├── server/           # SpacetimeDB Rust module (User table, set_username)
│   └── src/lib.rs
├── auth/             # OIDC/PKCE auth server
└── package.json
```

## Production Deployment (Concise Checklist)

1. **Publish SpacetimeDB module to production**
   ```bash
   npm run deploy:prod
   ```
2. **Configure auth server env** (`ISSUER_URL`, PostgreSQL, JWT keys, Resend, and HTTPS origins).
   Set the same issuer while compiling/publishing the SpacetimeDB module:
   ```powershell
   $env:AUTH_ISSUER_URL = "https://auth.example.com"
   $env:AUTH_CLIENT_ID = "vibe-survival-game-client"
   npm run deploy:prod
   ```
3. **Set client env** so `VITE_AUTH_SERVER_URL` points to your deployed auth URL.
4. **Build and run services**:
   - Client: `npm run build`
   - Auth server: `cd auth && npm run build && npm start`

### Docker + Railway (optional)

- Railway can use the root `Dockerfile`.
- The production image runs as the unprivileged `node` user.
- Before building, generate bindings:
  ```bash
  spacetime build -p ./server
  spacetime generate --lang typescript --out-dir ./client/src/generated -p ./server
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

`deploy:prod-clean` is destructive and requires
`CONFIRM_PRODUCTION_RESET=spacetimedb-auth-demo`. Production deploy scripts
regenerate bindings but never stage, commit, or push Git changes.

## License

This project is licensed under the [MIT License](LICENSE). You may use, modify, and distribute it under the terms of that license.

## Disclaimer

This repository is an independent personal project for educational/demo purposes.

- It is **not** affiliated with, endorsed by, sponsored by, or officially connected to SpacetimeDB or Clockwork Labs.
- The project is provided **"AS IS"**, without warranties of any kind.
- You assume all risk for use, modification, deployment, and operation, including security, legal, and data-handling responsibilities.
- To the maximum extent permitted by law, authors/contributors are not liable for damages resulting from use of this project.

In the running app, see the full disclaimer text on the `DISCLAIMER` legal page (`/disclaimer`).
