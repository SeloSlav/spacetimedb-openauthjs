/**
 * Username picker - shown after login when user has no username in the database.
 * Submits username to SpacetimeDB set_username reducer.
 */

import { useState } from "react";

interface UsernamePickerProps {
  onSubmit: (username: string) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function UsernamePicker({ onSubmit, isLoading, error }: UsernamePickerProps) {
  const [username, setUsername] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (trimmed.length >= 2 && trimmed.length <= 24) {
      onSubmit(trimmed);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(180deg, #1a3a1a 0%, #0d1f0d 100%)",
        color: "#e8e8e8",
      }}
    >
      <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem", fontWeight: 600 }}>
        Choose your name
      </h2>
      <p style={{ color: "#9ca3af", marginBottom: "1.5rem", fontSize: "0.95rem" }}>
        2–24 characters
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: "280px" }}>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Farmer name"
          maxLength={24}
          disabled={isLoading}
          style={{
            padding: "12px 16px",
            fontSize: "1rem",
            border: "2px solid #374151",
            borderRadius: "8px",
            background: "#1f2937",
            color: "#fff",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={isLoading || username.trim().length < 2}
          style={{
            padding: "12px 24px",
            fontSize: "1rem",
            fontWeight: 600,
            background: username.trim().length >= 2 && !isLoading ? "#22c55e" : "#4a5568",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: username.trim().length >= 2 && !isLoading ? "pointer" : "not-allowed",
          }}
        >
          {isLoading ? "Saving..." : "Continue"}
        </button>
      </form>
      {error && (
        <p style={{ color: "#ef4444", marginTop: "1rem", fontSize: "0.9rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
