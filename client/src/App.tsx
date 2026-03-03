import { AuthProvider, useAuth } from "./contexts/AuthContext.tsx";
import { SpacetimeDBProvider, useSpacetimeDB } from "./contexts/SpacetimeDBContext.tsx";
import { Routes, Route, useLocation } from "react-router-dom";
import LoginScreen from "./ui/components/LoginScreen.tsx";
import { WelcomeScreen } from "./ui/components/WelcomeScreen.tsx";
import LicensePage from "./ui/components/LicensePage.tsx";
import DisclaimerPage from "./ui/components/DisclaimerPage.tsx";
import "./theme/uiTheme.css";
import "./App.css";

function AppContent() {
  const { isAuthenticated } = useAuth();
  const { myUsername, isLoading: dbLoading, setUsername, setUsernameError, isConnected } = useSpacetimeDB();
  const location = useLocation();

  if (location.pathname === "/callback") {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--stdb-space-lg)",
          background: "var(--stdb-bg)",
          fontFamily: "var(--stdb-font)",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: "3px solid var(--stdb-purple-border)",
            borderTopColor: "var(--stdb-green)",
            borderRadius: "50%",
            animation: "stdb-spin 0.8s linear infinite",
          }}
        />
        <p
          style={{
            margin: 0,
            color: "var(--stdb-text)",
            fontSize: "16px",
            fontWeight: 500,
            letterSpacing: "0.5px",
          }}
        >
          Completing login...
        </p>
      </div>
    );
  }

  if (!isAuthenticated || (!dbLoading && !myUsername)) {
    const handleJoinGame = async (usernameToRegister: string | null) => {
      if (usernameToRegister) await setUsername(usernameToRegister);
    };
    const loggedInPlayer = myUsername ? { username: myUsername } : null;

    return (
      <LoginScreen
        handleJoinGame={handleJoinGame}
        loggedInPlayer={loggedInPlayer}
        connectionError={setUsernameError}
        storedUsername={null}
        isSpacetimeConnected={isConnected}
        retryConnection={undefined}
      />
    );
  }

  if (dbLoading) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--stdb-space-lg)",
          background: "var(--stdb-bg)",
          fontFamily: "var(--stdb-font)",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: "3px solid var(--stdb-purple-border)",
            borderTopColor: "var(--stdb-green)",
            borderRadius: "50%",
            animation: "stdb-spin 0.8s linear infinite",
          }}
        />
        <p
          style={{
            margin: 0,
            color: "var(--stdb-text)",
            fontSize: "16px",
            fontWeight: 500,
            letterSpacing: "0.5px",
          }}
        >
          Connecting...
        </p>
      </div>
    );
  }

  return <WelcomeScreen />;
}

function AppWithSpacetime() {
  const { spacetimeToken } = useAuth();
  return (
    <SpacetimeDBProvider authToken={spacetimeToken}>
      <AppContent />
    </SpacetimeDBProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/license" element={<LicensePage />} />
        <Route path="/disclaimer" element={<DisclaimerPage />} />
        <Route path="/*" element={<AppWithSpacetime />} />
      </Routes>
    </AuthProvider>
  );
}
