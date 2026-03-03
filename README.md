# Selo Empire

A 3D multiplayer farming game built with Three.js and SpacetimeDB. Think Farmville meets Balkan village life. Till your land, plant crops, and build your homestead in a shared persistent world.

- **Frontend:** React, TypeScript, Vite, Three.js
- **Backend:** SpacetimeDB (Rust/WASM)
- **Auth:** OpenAuth (auth-server-openauth)

## Prerequisites

- **Node.js** 18+ and npm
- **Rust** (for SpacetimeDB server build): [rustup.rs](https://rustup.rs)
- **SpacetimeDB CLI** 2.0.x: [spacetimedb.com/install](https://spacetimedb.com/install)
  - Windows: `iwr https://windows.spacetimedb.com -useb | iex`
  - macOS/Linux: `curl -sSf https://install.spacetimedb.com | sh`
- **Binaryen** (optional, for smaller WASM): [github.com/WebAssembly/binaryen](https://github.com/WebAssembly/binaryen)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/SeloSlav/selo-empire.git
cd selo-empire
npm install
```

### 2. Start SpacetimeDB local server

In a terminal, start the SpacetimeDB server (listens on port 3000):

```bash
spacetime start
```

### 3. Deploy the database and generate bindings

From the project root:

```bash
npm run deploy:local
```

This builds the Rust server, publishes to `selo-empire-local`, and regenerates TypeScript bindings in `client/src/generated`.

### 4. Start the auth server (required)

```bash
cd auth-server-openauth
cp .env.example .env
npm install
```

**Generate JWT keys.** The auth server needs RSA keys to sign tokens. Run:

```bash
npm run keys
```

This prints two long lines. Copy both lines exactly and paste them into your `.env` file, replacing the placeholder `JWT_PRIVATE_KEY=your_private_key_here` and `JWT_PUBLIC_KEY=your_public_key_here` lines. The output will look like:

```
JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANB...(long string)...\n-----END PRIVATE KEY-----
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...(long string)...\n-----END PUBLIC KEY-----
```

Your `.env` should contain (with your generated values):

```
NODE_ENV=development
PORT=4001
ISSUER_URL=http://localhost:4001

JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
```

Save `.env`, then start the auth server:

```bash
npm run dev
```

Auth server runs on port 4001. It is required to play the game.

### 5. Run the game (Vite dev server)

Open a third terminal. From the project root:

```bash
npm run dev
```

This starts the Vite dev server. Open [http://localhost:5173](http://localhost:5173) in your browser to play.

You need all three running: SpacetimeDB (`spacetime start`), the auth server, and the Vite client (`npm run dev`). Use separate terminals for each.

## Build Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server; this is how you play the game |
| `npm run deploy:local` | Publish to local SpacetimeDB, regenerate bindings |
| `npm run deploy:local-clean` | Clear local DB and republish (fresh start). Use this to seed a new procedural world (trees, stones, terrain). |

## Project Structure

```
selo-empire/
├── client/           # React + Vite + Three.js frontend
│   └── src/
│       ├── generated/   # SpacetimeDB TypeScript bindings (auto-generated)
│       ├── ui/          # UI components
│       └── ...
├── server/           # SpacetimeDB Rust module
│   └── src/
├── auth-server-openauth/   # OpenAuth auth server (Node.js)
└── package.json
```

## SpacetimeDB Workflow

After changing server code in `server/src/`:

1. `npm run deploy:local` (or `deploy:local-clean` for a fresh DB)
2. Restart `npm run dev` if the client was already running

Manual commands (from project root):

```bash
# Build server
spacetime build -p ./server

# Publish to local
spacetime publish -p ./server selo-empire-local

# Generate client bindings
spacetime generate --lang typescript --out-dir ./client/src/generated -p ./server

# View logs
spacetime logs selo-empire-local
```

## License

Private. See repository for details.
