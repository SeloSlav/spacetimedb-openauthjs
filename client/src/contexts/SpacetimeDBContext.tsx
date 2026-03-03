/// <reference types="vite/client" />
/**
 * SpacetimeDB connection and User table state.
 * Connects when auth token is available; subscribes to User table.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { connect, disconnect, getConnection } from "../network/spacetimedbClient.ts";
import { DbConnection } from "../generated/index.ts";

export interface OnlineUser {
  username: string | null;
  identity: string;
}

interface SpacetimeDBContextType {
  connection: DbConnection | null;
  myUsername: string | null;
  myBio: string | null;
  isConnected: boolean;
  isLoading: boolean;
  setUsernameError: string | null;
  onlineUsers: OnlineUser[];
  setUsername: (username: string) => Promise<void>;
  setBio: (bio: string) => Promise<void>;
}

const SpacetimeDBContext = createContext<SpacetimeDBContextType>({
  connection: null,
  myUsername: null,
  myBio: null,
  isConnected: false,
  isLoading: true,
  setUsernameError: null,
  onlineUsers: [],
  setUsername: async () => {},
  setBio: async () => {},
});

interface SpacetimeDBProviderProps {
  children: ReactNode;
  authToken: string | null;
}

export function SpacetimeDBProvider({ children, authToken }: SpacetimeDBProviderProps) {
  const MAX_RECONNECT_ATTEMPTS = 5;
  const [connection, setConnection] = useState<DbConnection | null>(null);
  const [myUsername, setMyUsername] = useState<string | null>(null);
  const [myBio, setMyBio] = useState<string | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
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

  const setBio = useCallback(async (bio: string) => {
    const conn = getConnection();
    if (!conn) return;
    setSetUsernameError(null);
    try {
      await conn.reducers.setBio({ bio });
      setMyBio(bio.trim() || null);
    } catch (e) {
      setSetUsernameError(e instanceof Error ? e.message : "Failed to update bio");
    }
  }, []);

  useEffect(() => {
    if (!authToken) {
      disconnect();
      setConnection(null);
      setMyUsername(null);
      setMyBio(null);
      setOnlineUsers([]);
      setIsLoading(false);
      return;
    }

    const token = authToken;
    let cancelled = false;
    let myIdentity: import("spacetimedb").Identity | null = null;
    let hasAppliedUserSnapshot = false;
    let profileLoadTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;

    type UserRow = { identity: { toHexString: () => string }; username?: string | null; bio?: string | null; online?: boolean };
    function lookupMyProfile(c: DbConnection, id: import("spacetimedb").Identity): { username: string | null; bio: string | null } | null {
      const userTable = (c.db as unknown as { user?: { iter: () => Iterable<UserRow> } }).user;
      if (!userTable) return null;
      for (const row of userTable.iter()) {
        if (row.identity.toHexString() === id.toHexString()) {
          return { username: row.username ?? null, bio: row.bio ?? null };
        }
      }
      return null;
    }
    function refreshOnlineUsers(c: DbConnection) {
      const userTable = (c.db as unknown as { user?: { iter: () => Iterable<UserRow> } }).user;
      if (!userTable) return;
      const users: OnlineUser[] = [];
      for (const row of userTable.iter()) {
        if (row.online) {
          users.push({ username: row.username ?? null, identity: row.identity.toHexString() });
        }
      }
      setOnlineUsers(users);
    }

    function resolveUsernameFromDb(conn: DbConnection): void {
      if (cancelled || !myIdentity) return;
      const profile = lookupMyProfile(conn, myIdentity);
      if (profile !== null) {
        setMyUsername(profile.username);
        setMyBio(profile.bio);
        setIsLoading(false);
        if (profileLoadTimeout) {
          clearTimeout(profileLoadTimeout);
          profileLoadTimeout = null;
        }
        return;
      }
      if (hasAppliedUserSnapshot) {
        setMyUsername(null);
        setMyBio(null);
        setIsLoading(false);
        if (profileLoadTimeout) {
          clearTimeout(profileLoadTimeout);
          profileLoadTimeout = null;
        }
      }
    }

    function clearTimers() {
      if (profileLoadTimeout) {
        clearTimeout(profileLoadTimeout);
        profileLoadTimeout = null;
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    }

    function scheduleReconnect(reason: string) {
      if (cancelled || reconnectTimeout) return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        setSetUsernameError(`Connection error: ${reason}. Please try again.`);
        setIsLoading(false);
        return;
      }
      const attempt = reconnectAttempts + 1;
      const delayMs = Math.min(500 * 2 ** reconnectAttempts, 4000);
      reconnectAttempts = attempt;
      setSetUsernameError(`Connection interrupted. Reconnecting (${attempt}/${MAX_RECONNECT_ATTEMPTS})...`);
      setIsLoading(true);
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        if (cancelled) return;
        doConnect();
      }, delayMs);
    }

    function doConnect() {
      setIsLoading(true);
      profileLoadTimeout = setTimeout(() => {
        if (cancelled) return;
        scheduleReconnect("timed out loading player profile");
      }, 8000);
      try {
        const conn = connect(
          token,
          (identity) => {
            reconnectAttempts = 0;
            setSetUsernameError(null);
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
            scheduleReconnect(message);
          },
          () => {
            if (cancelled) return;
            setConnection(null);
            scheduleReconnect("disconnected from server");
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
            if (!myIdentity) {
              const connIdentity = (conn as { identity?: import("spacetimedb").Identity }).identity;
              if (connIdentity) myIdentity = connIdentity;
            }
            hasAppliedUserSnapshot = true;
            resolveUsernameFromDb(conn);
            refreshOnlineUsers(conn);
          })
          .subscribe("SELECT * FROM user");

        const userTable = (conn.db as unknown as { user?: { onInsert: (cb: (ctx: unknown, row: UserRow) => void) => void; onUpdate: (cb: (ctx: unknown, old: unknown, row: UserRow) => void) => void; onDelete: (cb: (ctx: unknown, row: { identity: { toHexString: () => string } }) => void) => void } }).user;
        if (userTable) {
          userTable.onInsert((_ctx, row) => {
            if (cancelled) return;
            refreshOnlineUsers(conn);
            const id = myIdentity ?? (conn as { identity?: import("spacetimedb").Identity }).identity;
            if (id && row.identity.toHexString() === id.toHexString()) {
              setMyUsername(row.username ?? null);
              setMyBio(row.bio ?? null);
              setIsLoading(false);
              if (profileLoadTimeout) {
                clearTimeout(profileLoadTimeout);
                profileLoadTimeout = null;
              }
            }
          });
          userTable.onUpdate((_ctx, _old, newRow) => {
            if (cancelled) return;
            refreshOnlineUsers(conn);
            const id = myIdentity ?? (conn as { identity?: import("spacetimedb").Identity }).identity;
            if (id && newRow.identity.toHexString() === id.toHexString()) {
              setMyUsername(newRow.username ?? null);
              setMyBio(newRow.bio ?? null);
              setIsLoading(false);
              if (profileLoadTimeout) {
                clearTimeout(profileLoadTimeout);
                profileLoadTimeout = null;
              }
            }
          });
          userTable.onDelete((_ctx, row) => {
            if (cancelled) return;
            refreshOnlineUsers(conn);
            const id = myIdentity ?? (conn as { identity?: import("spacetimedb").Identity }).identity;
            if (id && row.identity.toHexString() === id.toHexString()) {
              setMyUsername(null);
              setMyBio(null);
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
          scheduleReconnect(e instanceof Error ? e.message : "connect failed");
        }
      }
    }

    doConnect();
    return () => {
      cancelled = true;
      clearTimers();
      // Must disconnect on cleanup. React Strict Mode double-mounts; if we don't
      // disconnect, the remount reuses the connection but gets stale callbacks
      // (the original onConnect never fires for the new effect), leaving us stuck.
      disconnect();
      setConnection(null);
      setMyUsername(null);
      setMyBio(null);
      setOnlineUsers([]);
    };
  }, [authToken]);

  return (
    <SpacetimeDBContext.Provider
      value={{
        connection,
        myUsername,
        myBio,
        isConnected: connection !== null,
        isLoading,
        setUsernameError,
        onlineUsers,
        setUsername,
        setBio,
      }}
    >
      {children}
    </SpacetimeDBContext.Provider>
  );
}

export const useSpacetimeDB = () => useContext(SpacetimeDBContext);
