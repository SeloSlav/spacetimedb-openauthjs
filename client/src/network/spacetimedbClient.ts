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

export function connect(
  token: string,
  onIdentity?: (identity: Identity) => void,
  onConnectError?: (error: unknown) => void,
  onDisconnect?: () => void
): DbConnection {
  // Reuse only a fully connected instance for the same token.
  // Never reuse "connecting" instances: they can carry stale callbacks
  // from an earlier mount/effect and lead to ghost sessions.
  if (connection && connectionToken === token && connectionStatus === "connected") {
    const conn = connection as { identity?: import("spacetimedb").Identity };
    if (conn.identity && onIdentity) onIdentity(conn.identity);
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
