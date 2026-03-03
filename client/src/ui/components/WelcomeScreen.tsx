import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext.tsx";
import { useSpacetimeDB, type OnlineUser } from "../../contexts/SpacetimeDBContext.tsx";

export function WelcomeScreen() {
  const { userProfile, logout } = useAuth();
  const { myUsername, myBio, setUsername, setBio, onlineUsers, isConnected } = useSpacetimeDB();

  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const displayName = myUsername ?? "User";

  const handleSaveUsername = async () => {
    const trimmed = editUsername.trim();
    if (!trimmed) return;
    setSaveError(null);
    try {
      await setUsername(trimmed);
      setIsEditingUsername(false);
      setEditUsername("");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to update username");
    }
  };

  const handleSaveBio = async () => {
    setSaveError(null);
    try {
      await setBio(editBio);
      setIsEditingBio(false);
      setEditBio("");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to update bio");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--stdb-bg)",
        color: "var(--stdb-text)",
        fontFamily: "var(--stdb-font)",
      }}
    >
      {/* Top-right header: Welcome + Logout */}
      <header
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          zIndex: 1000,
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
          background: "var(--stdb-bg-overlay)",
          backdropFilter: "blur(10px)",
          borderBottomLeftRadius: "12px",
          borderLeft: "1px solid var(--stdb-purple-border)",
          borderBottom: "1px solid var(--stdb-purple-border)",
          boxShadow: "0 4px 20px rgba(160, 32, 240, 0.15)",
        }}
      >
        <span
          style={{
            color: "var(--stdb-green)",
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          Welcome, {displayName}!
        </span>
        <span
          style={{
            color: "var(--stdb-text-dim)",
            fontSize: "12px",
          }}
        >
          {userProfile?.email}
        </span>
        <button
          onClick={() => logout()}
          className="stdb-btn-danger"
          style={{ padding: "6px 14px", fontSize: "12px" }}
        >
          Log out
        </button>
      </header>

      {/* Main content */}
      <main
        style={{
          padding: "100px 24px 60px",
          maxWidth: "900px",
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            fontSize: "clamp(28px, 4vw, 36px)",
            marginBottom: "8px",
            color: "var(--stdb-text)",
          }}
        >
          SpacetimeDB Auth Demo
        </h1>
        <p style={{ color: "var(--stdb-text-muted)", marginBottom: "40px", fontSize: "15px" }}>
          Your profile is synced in real time. Edit below to see SpacetimeDB in action.
        </p>

        {/* Profile card */}
        <section
          className="stdb-panel"
          style={{
            padding: "28px",
            marginBottom: "32px",
            border: "2px solid var(--stdb-purple-border)",
          }}
        >
          <h2
            style={{
              fontSize: "14px",
              color: "var(--stdb-green)",
              textTransform: "uppercase",
              letterSpacing: "2px",
              marginBottom: "24px",
            }}
          >
            Profile
          </h2>

          {saveError && (
            <p style={{ color: "#ff6b6b", fontSize: "13px", marginBottom: "16px" }}>{saveError}</p>
          )}

          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "var(--stdb-green)",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              Username
            </label>
            {isEditingUsername ? (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  placeholder={myUsername ?? "Enter username"}
                  autoFocus
                  style={{
                    flex: 1,
                    padding: "12px 16px",
                    background: "var(--stdb-bg-input)",
                    border: "2px solid var(--stdb-purple-border)",
                    borderRadius: "8px",
                    color: "var(--stdb-text)",
                    fontSize: "15px",
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveUsername()}
                />
                <button
                  onClick={handleSaveUsername}
                  className="stdb-btn-primary"
                  style={{ padding: "12px 20px" }}
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setIsEditingUsername(false);
                    setEditUsername("");
                  }}
                  style={{
                    padding: "12px 16px",
                    background: "transparent",
                    border: "1px solid var(--stdb-text-dim)",
                    borderRadius: "8px",
                    color: "var(--stdb-text-muted)",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <span style={{ fontSize: "16px" }}>{myUsername ?? "—"}</span>
                <button
                  onClick={() => {
                    setEditUsername(myUsername ?? "");
                    setIsEditingUsername(true);
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "var(--stdb-green-bg)",
                    border: "1px solid var(--stdb-purple-border)",
                    borderRadius: "6px",
                    color: "var(--stdb-green)",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "var(--stdb-green)",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              Bio
            </label>
            {isEditingBio ? (
              <div>
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  placeholder="Tell us about yourself..."
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    background: "var(--stdb-bg-input)",
                    border: "2px solid var(--stdb-purple-border)",
                    borderRadius: "8px",
                    color: "var(--stdb-text)",
                    fontSize: "15px",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                  <button
                    onClick={handleSaveBio}
                    className="stdb-btn-primary"
                    style={{ padding: "10px 18px" }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingBio(false);
                      setEditBio("");
                    }}
                    style={{
                      padding: "10px 16px",
                      background: "transparent",
                      border: "1px solid var(--stdb-text-dim)",
                      borderRadius: "8px",
                      color: "var(--stdb-text-muted)",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                <p style={{ flex: 1, fontSize: "15px", lineHeight: 1.5, margin: 0, color: "var(--stdb-text-muted)" }}>
                  {myBio || "No bio yet."}
                </p>
                <button
                  onClick={() => {
                    setEditBio(myBio ?? "");
                    setIsEditingBio(true);
                  }}
                  style={{
                    padding: "6px 12px",
                    background: "var(--stdb-green-bg)",
                    border: "1px solid var(--stdb-purple-border)",
                    borderRadius: "6px",
                    color: "var(--stdb-green)",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Real-time Online Users - SpacetimeDB demo */}
        <section
          className="stdb-panel"
          style={{
            padding: "28px",
            border: "2px solid var(--stdb-purple-border)",
          }}
        >
          <h2
            style={{
              fontSize: "14px",
              color: "var(--stdb-green)",
              textTransform: "uppercase",
              letterSpacing: "2px",
              marginBottom: "8px",
            }}
          >
            Online Now
          </h2>
          <p style={{ fontSize: "13px", color: "var(--stdb-text-dim)", marginBottom: "20px" }}>
            Live list from SpacetimeDB — updates in real time as users connect and disconnect.
          </p>
          {isConnected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {onlineUsers.length === 0 ? (
                <p style={{ color: "var(--stdb-text-dim)", fontSize: "14px" }}>No one else online.</p>
              ) : (
                onlineUsers.map((u: OnlineUser) => (
                  <div
                    key={u.identity}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px 16px",
                      background: "var(--stdb-bg-input)",
                      borderRadius: "8px",
                      border: "1px solid var(--stdb-purple-border)",
                    }}
                  >
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: "var(--stdb-green)",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: "14px" }}>
                      {u.username ?? `Anonymous (${u.identity.slice(0, 8)}…)`}
                    </span>
                  </div>
                ))
              )}
            </div>
          ) : (
            <p style={{ color: "var(--stdb-text-dim)", fontSize: "14px" }}>Disconnected.</p>
          )}
        </section>

        {/* Connection status */}
        <div
          style={{
            marginTop: "32px",
            padding: "16px",
            background: "var(--stdb-bg-card)",
            borderRadius: "8px",
            border: "1px solid var(--stdb-purple-border)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: isConnected ? "var(--stdb-green)" : "#666",
            }}
          />
          <span style={{ fontSize: "13px", color: "var(--stdb-text-muted)" }}>
            {isConnected ? "Connected to SpacetimeDB" : "Disconnected"}
          </span>
        </div>
      </main>
    </div>
  );
}
