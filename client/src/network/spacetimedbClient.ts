/// <reference types="vite/client" />
/**
 * SpacetimeDB client - connects with auth token, subscribes to tables, invokes reducers.
 */

import { DbConnection } from "../generated/index.ts";

const isDev = import.meta.env.DEV || window.location.hostname === "localhost";
const SPACETIME_URI = isDev ? "http://localhost:3000" : "https://maincloud.spacetimedb.com";
const DB_NAME = isDev ? "spacetimedb-auth-demo-local" : "spacetimedb-auth-demo";

let connection: DbConnection | null = null;
let connectionToken: string | null = null;
let connectionStatus: "disconnected" | "connecting" | "connected" = "disconnected";
let activeConnectionId = 0;

export type Identity = import("spacetimedb").Identity;

function decodeJwtSubject(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = JSON.parse(window.atob(padded)) as { sub?: unknown; userId?: unknown };
    if (typeof json.sub === "string" && json.sub.length > 0) return json.sub;
    if (typeof json.userId === "string" && json.userId.length > 0) return json.userId;
  } catch {
    // If token is opaque or malformed, fall back to strict token equality.
  }
  return null;
}

function isSameAuthPrincipal(a: string, b: string | null): boolean {
  if (!b) return false;
  if (a === b) return true;
  const subA = decodeJwtSubject(a);
  const subB = decodeJwtSubject(b);
  return !!subA && !!subB && subA === subB;
}

export function connect(
  token: string,
  onIdentity?: (identity: Identity) => void,
  onConnectError?: (error: unknown) => void,
  onDisconnect?: () => void
): DbConnection {
  // Reuse an existing connection for the same authenticated principal.
  // Token refresh can rotate token strings without changing identity.
  if (connection && connectionStatus !== "disconnected" && isSameAuthPrincipal(token, connectionToken)) {
    connectionToken = token;
    const conn = connection as { identity?: import("spacetimedb").Identity };
    if (connectionStatus === "connected" && conn.identity && onIdentity) onIdentity(conn.identity);
    return connection;
  }
  if (connection) {
    try {
      connection.disconnect();
    } catch {
      // Ignore disconnect errors while replacing a stale connection.
    }
    connection = null;
    connectionToken = null;
    connectionStatus = "disconnected";
  }

  const connectionId = ++activeConnectionId;
  connectionToken = token;
  connectionStatus = "connecting";
  const conn = DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(DB_NAME)
    .withToken(token)
    .onConnect((_conn, identity) => {
      if (connectionId !== activeConnectionId) return;
      connectionStatus = "connected";
      console.log("[SpacetimeDB] Connected, identity:", identity.toHexString());
      onIdentity?.(identity);
    })
    .onConnectError((_ctx, error) => {
      if (connectionId !== activeConnectionId) return;
      connectionStatus = "disconnected";
      connection = null;
      connectionToken = null;
      console.error("[SpacetimeDB] Connection failed:", error);
      onConnectError?.(error);
    })
    .onDisconnect(() => {
      if (connectionId !== activeConnectionId) return;
      connectionStatus = "disconnected";
      connection = null;
      connectionToken = null;
      console.log("[SpacetimeDB] Disconnected");
      onDisconnect?.();
    })
    .build();

  connection = conn;
  return conn;
}

export function disconnect(): void {
  activeConnectionId++;
  if (connection) {
    connection.disconnect();
    connection = null;
    connectionToken = null;
    connectionStatus = "disconnected";
  }
}

export function getConnection(): DbConnection | null {
  return connection;
}

export function isConnected(): boolean {
  return connection !== null && connectionStatus === "connected";
}
