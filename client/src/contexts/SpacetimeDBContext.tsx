/// <reference types="vite/client" />
/**
 * SpacetimeDB connection and User table state.
 * Connects when auth token is available; subscribes to User table.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { connect, disconnect, getConnection } from "../network/spacetimedbClient.ts";
import { DbConnection } from "../generated/index.ts";

interface SpacetimeDBContextType {
  connection: DbConnection | null;
  myUsername: string | null;
  isConnected: boolean;
  isLoading: boolean;
  setUsernameError: string | null;
  setUsername: (username: string) => Promise<void>;
}

const SpacetimeDBContext = createContext<SpacetimeDBContextType>({
  connection: null,
  myUsername: null,
  isConnected: false,
  isLoading: true,
  setUsernameError: null,
  setUsername: async () => {},
});

interface SpacetimeDBProviderProps {
  children: ReactNode;
  authToken: string | null;
}

export function SpacetimeDBProvider({ children, authToken }: SpacetimeDBProviderProps) {
  const [connection, setConnection] = useState<DbConnection | null>(null);
  const [myUsername, setMyUsername] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [setUsernameError, setSetUsernameError] = useState<string | null>(null);

  const setUsername = useCallback(async (username: string) => {
    const conn = getConnection();
    if (!conn) {
      setSetUsernameError("Not connected to database");
      return;
    }
    setSetUsernameError(null);
    try {
      await conn.reducers.setUsername({ username });
      // Optimistically update - onUpdate may not fire immediately
      setMyUsername(username.trim());
    } catch (e) {
      setSetUsernameError(e instanceof Error ? e.message : "Failed to set username");
    }
  }, []);

  useEffect(() => {
    if (!authToken) {
      disconnect();
      setConnection(null);
      setMyUsername(null);
      setIsLoading(false);
      return;
    }

    const token = authToken;
    let cancelled = false;
    let myIdentity: import("spacetimedb").Identity | null = null;
    let hasAppliedUserSnapshot = false;
    let profileLoadTimeout: ReturnType<typeof setTimeout> | null = null;

    function lookupMyUsername(
      c: DbConnection,
      id: import("spacetimedb").Identity
    ): string | null {
      const userTable = (c.db as unknown as { user?: { iter: () => Iterable<{ identity: { toHexString: () => string }; username?: string | null }> } }).user;
      if (!userTable) return null;
      for (const row of userTable.iter()) {
        if (row.identity.toHexString() === id.toHexString()) {
          return row.username ?? null;
        }
      }
      return null;
    }

    function resolveUsernameFromDb(conn: DbConnection): void {
      if (cancelled || !myIdentity) return;
      const username = lookupMyUsername(conn, myIdentity);
      // If username exists, we're done immediately.
      if (username !== null) {
        setMyUsername(username);
        setIsLoading(false);
        if (profileLoadTimeout) {
          clearTimeout(profileLoadTimeout);
          profileLoadTimeout = null;
        }
        return;
      }

      // If the user snapshot was fully applied and still no username row, this is a new player.
      if (hasAppliedUserSnapshot) {
        setMyUsername(null);
        setIsLoading(false);
        if (profileLoadTimeout) {
          clearTimeout(profileLoadTimeout);
          profileLoadTimeout = null;
        }
      }
    }

    function doConnect() {
      setIsLoading(true);
      setSetUsernameError(null);
      profileLoadTimeout = setTimeout(() => {
        if (cancelled) return;
        setSetUsernameError("Timed out loading player profile. Please retry.");
        setIsLoading(false);
      }, 8000);
      try {
        const conn = connect(
          token,
          (identity) => {
            myIdentity = identity;
            const c = getConnection();
            if (!c) return;
            // Identity and subscription can arrive in either order.
            // We only resolve once both are available.
            resolveUsernameFromDb(c);
          },
          (error) => {
            if (cancelled) return;
            const message = error instanceof Error ? error.message : "Connection to database failed";
            setSetUsernameError(message);
            setConnection(null);
            setIsLoading(false);
            if (profileLoadTimeout) {
              clearTimeout(profileLoadTimeout);
              profileLoadTimeout = null;
            }
          },
          () => {
            if (cancelled) return;
            setConnection(null);
            setIsLoading(false);
            if (profileLoadTimeout) {
              clearTimeout(profileLoadTimeout);
              profileLoadTimeout = null;
            }
          }
        );
        if (cancelled) return;
        // When reusing an already-connected instance (e.g. Strict Mode remount),
        // onIdentity may not fire for this effect instance. Read identity directly.
        const existingIdentity = (conn as { identity?: import("spacetimedb").Identity }).identity;
        if (existingIdentity) {
          myIdentity = existingIdentity;
        }

        conn.subscriptionBuilder()
          .onApplied(() => {
            if (cancelled) return;
            // Fallback: if identity callback didn't run in this effect instance,
            // hydrate it from the connection object before resolving.
            if (!myIdentity) {
              const connIdentity = (conn as { identity?: import("spacetimedb").Identity }).identity;
              if (connIdentity) myIdentity = connIdentity;
            }
            hasAppliedUserSnapshot = true;
            resolveUsernameFromDb(conn);
          })
          .subscribe("SELECT * FROM user");

        const userTable = (conn.db as unknown as { user?: { onInsert: (cb: (ctx: unknown, row: { identity: { toHexString: () => string }; username?: string | null }) => void) => void; onUpdate: (cb: (ctx: unknown, old: unknown, row: { identity: { toHexString: () => string }; username?: string | null }) => void) => void; onDelete: (cb: (ctx: unknown, row: { identity: { toHexString: () => string } }) => void) => void } }).user;
        if (userTable) {
          userTable.onInsert((_ctx, row) => {
            if (cancelled || !myIdentity) return;
            if (row.identity.toHexString() === myIdentity!.toHexString()) {
              setMyUsername(row.username ?? null);
              setIsLoading(false);
              if (profileLoadTimeout) {
                clearTimeout(profileLoadTimeout);
                profileLoadTimeout = null;
              }
            }
          });
          userTable.onUpdate((_ctx, _old, newRow) => {
            if (cancelled || !myIdentity) return;
            if (newRow.identity.toHexString() === myIdentity!.toHexString()) {
              setMyUsername(newRow.username ?? null);
              setIsLoading(false);
              if (profileLoadTimeout) {
                clearTimeout(profileLoadTimeout);
                profileLoadTimeout = null;
              }
            }
          });
          userTable.onDelete((_ctx, row) => {
            if (cancelled || !myIdentity) return;
            if (row.identity.toHexString() === myIdentity!.toHexString()) {
              setMyUsername(null);
              setIsLoading(false);
              if (profileLoadTimeout) {
                clearTimeout(profileLoadTimeout);
                profileLoadTimeout = null;
              }
            }
          });
        }

        setConnection(conn);
        resolveUsernameFromDb(conn);
      } catch (e) {
        console.error("[SpacetimeDB] Connect failed:", e);
        if (!cancelled) {
          setConnection(null);
          setIsLoading(false);
          if (profileLoadTimeout) {
            clearTimeout(profileLoadTimeout);
            profileLoadTimeout = null;
          }
        }
      }
    }

    doConnect();
    return () => {
      cancelled = true;
      if (profileLoadTimeout) {
        clearTimeout(profileLoadTimeout);
        profileLoadTimeout = null;
      }
      // Don't disconnect here - React Strict Mode double-mounts and would close
      // the connection before the remount establishes a new one. When authToken
      // becomes null we disconnect in the effect body; when remounting, connect()
      // will disconnect any existing connection before creating a new one.
      setConnection(null);
      setMyUsername(null);
    };
  }, [authToken]);

  return (
    <SpacetimeDBContext.Provider
      value={{
        connection,
        myUsername,
        isConnected: connection !== null,
        isLoading,
        setUsernameError,
        setUsername,
      }}
    >
      {children}
    </SpacetimeDBContext.Provider>
  );
}

export const useSpacetimeDB = () => useContext(SpacetimeDBContext);
