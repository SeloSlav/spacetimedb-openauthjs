/**
 * LoginScreen.tsx
 * 
 * Displays the initial welcome/login screen.
 * Handles:
 *  - Displaying game title.
 *  - Triggering OpenAuth OIDC login flow.
 *  - Input field for username (for NEW players).
 *  - Displaying existing username for returning players.
 *  - Displaying loading states and errors.
 *  - Handling logout.
 */

import React, { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.tsx';
// loggedInPlayer: { username } from SpacetimeDB User
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGithub, faXTwitter } from '@fortawesome/free-brands-svg-icons';
import { faBars, faTimes } from '@fortawesome/free-solid-svg-icons';
import loginBackground from '../../assets/ui/login_background.jpg';
import '../../theme/uiTheme.ts';
import AboutSection from './AboutSection.tsx';
import FAQSection, { type FAQItem } from './FAQSection.tsx';

const UI_FONT_FAMILY = "var(--stdb-font)";
const SPACETIMEDB_REFERRAL_URL = "https://spacetimedb.com/?referral=SeloSlav";

const FAQ_ITEMS = (onLicenseClick: () => void, onDisclaimerClick: () => void): FAQItem[] => [
  { question: "What is this?", answer: "SpacetimeDB Auth Demo shows how to use OpenAuth (OIDC) with SpacetimeDB. Sign in, choose a username, and see a welcome message. It demonstrates token-based auth for real-time multiplayer apps." },
  { question: "How do I use it?", answer: "Click Sign in, enter your email and password (or create an account), choose a username, then click Enter App. You'll see a welcome message with your username and a Log out button." },
  { question: "What's the tech stack?", answer: "This demo uses React and SpacetimeDB for real-time multiplayer. The auth server runs on Hono with OpenAuth for OIDC. Everything runs in the browser; user data is synced via SpacetimeDB's server module." },
  { question: "What is Hono?", answer: "Hono is a fast, lightweight web framework for TypeScript/JavaScript. We use it to power the auth server: it handles the OIDC endpoints (/authorize, /token, /revoke), JWKS, password login UI, and static assets. It's minimal, type-safe, and works great with Bun, Node, or edge runtimes." },
  { question: "How does token refresh work?", answer: "When you sign in, you get an access token (4h) and a refresh token (7 days). The app checks every 5 minutes and refreshes tokens before they expire. If your session expires, it tries to refresh automatically. You only need to sign in again if the refresh token has expired or been revoked. Logging out revokes the refresh token on the server." },
  { question: "Can I extend this?", answer: "Absolutely! Add more tables and reducers in the SpacetimeDB server. The auth flow (login, token, set_username) is the foundation. Build your own multiplayer app on top." },
  { question: "Why OpenAuth?", answer: "OpenAuth is a self-hosted OIDC provider. You control user data and can customize the login flow. It works seamlessly with SpacetimeDB's token-based auth." },
  { question: "Will my data persist?", answer: "Usernames are stored in SpacetimeDB. The auth server may use in-memory or PostgreSQL. For production, configure DATABASE_URL and JWT keys." },
  {
    question: "What license is this under?",
    answer: (
      <p>
        This project is licensed under the MIT License. You're free to use, modify, and distribute it. See the full license text on our{' '}
        <button type="button" onClick={onLicenseClick} className="stdb-link-btn">License page</button>.
      </p>
    ),
  },
  {
    question: "Is this officially affiliated with SpacetimeDB?",
    answer: (
      <p>
        No. This is an independent personal project and is not officially affiliated with, endorsed by, or sponsored by SpacetimeDB/Clockwork Labs. For full non-affiliation and liability waiver terms, see our{' '}
        <button type="button" onClick={onDisclaimerClick} className="stdb-link-btn">Disclaimer page</button>.
      </p>
    ),
  },
  {
    question: "What's next?",
    answer: <p>Add more SpacetimeDB tables and reducers. Deploy to Railway with the included Dockerfile. Extend the auth flow for your use case. Have fun building!</p>,
  },
];

// Mobile Navigation Menu Component
interface NavItem {
  label: string;
  selector?: string;
  href?: string;
}
interface MobileNavMenuProps {
  navItems: Array<NavItem>;
  onNavigate: (selector: string) => void;
  onPlayClick: () => void;
  /** When provided, shows signed-in email and logout at top of menu */
  userEmail?: string | null;
  onLogout?: () => void;
}

const MobileNavMenu: React.FC<MobileNavMenuProps> = ({ navItems, onNavigate, onPlayClick, userEmail, onLogout }) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleNavClick = (selector: string) => {
    setIsOpen(false);
    onNavigate(selector);
  };

  const handlePlayClick = () => {
    setIsOpen(false);
    onPlayClick();
  };

  return (
    <>
      {/* Hamburger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255, 255, 255, 0.9)',
          fontSize: '24px',
          cursor: 'pointer',
          padding: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          zIndex: 1001,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--stdb-green)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
        }}
      >
        <FontAwesomeIcon icon={isOpen ? faTimes : faBars} />
      </button>

      {/* Mobile Menu Overlay */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setIsOpen(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              zIndex: 1000,
              animation: 'fadeIn 0.2s ease-out',
            }}
          />

          {/* Menu Panel */}
          <div
            style={{
              position: 'fixed',
              top: '70px',
              right: 0,
              width: '280px',
              maxWidth: '85vw',
              height: 'calc(100vh - 70px)',
              backgroundColor: 'rgba(0, 0, 0, 0.98)',
              backdropFilter: 'blur(20px)',
              borderLeft: '2px solid var(--stdb-purple-border)',
              boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.5)',
              zIndex: 1001,
              display: 'flex',
              flexDirection: 'column',
              padding: '20px 0',
              animation: 'slideInRight 0.3s ease-out',
              overflowY: 'auto',
            }}
          >
            {/* Account section - when signed in */}
            {userEmail && onLogout && (
              <div style={{
                padding: '0 24px 16px',
                marginBottom: '12px',
                borderBottom: '1px solid var(--stdb-purple-border)',
              }}>
                <p style={{
                  fontSize: '11px',
                  color: 'rgba(255, 255, 255, 0.5)',
                  margin: '0 0 4px 0',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}>
                  Signed in as
                </p>
                <p style={{
                  fontSize: '13px',
                  color: 'var(--stdb-green)',
                  margin: '0 0 12px 0',
                  wordBreak: 'break-all',
                  fontFamily: 'var(--stdb-font-mono)',
                }}>
                  {userEmail}
                </p>
                <button
                  type="button"
                  onClick={() => { setIsOpen(false); onLogout(); }}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    background: 'rgba(255, 0, 100, 0.15)',
                    border: '1px solid rgba(255, 0, 100, 0.4)',
                    borderRadius: '6px',
                    color: 'rgba(255, 150, 180, 0.95)',
                    fontSize: '12px',
                    fontFamily: 'var(--stdb-font-mono)',
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 0, 100, 0.25)';
                    e.currentTarget.style.borderColor = 'rgba(255, 0, 100, 0.6)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 0, 100, 0.15)';
                    e.currentTarget.style.borderColor = 'rgba(255, 0, 100, 0.4)';
                  }}
                >
                  Log out
                </button>
              </div>
            )}

            {navItems.map((item) =>
              item.href ? (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsOpen(false)}
                  style={{
                    display: 'block',
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.8)',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    padding: '16px 24px',
                    textAlign: 'left',
                    transition: 'all 0.2s ease',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    borderLeft: '3px solid transparent',
                    textDecoration: 'none',
                    fontFamily: UI_FONT_FAMILY,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--stdb-green)';
                    e.currentTarget.style.backgroundColor = 'var(--stdb-green-bg)';
                    e.currentTarget.style.borderLeftColor = 'var(--stdb-green)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderLeftColor = 'transparent';
                  }}
                >
                  {item.label}
                </a>
              ) : (
                <button
                  key={item.label}
                  onClick={() => item.selector && handleNavClick(item.selector)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.8)',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    padding: '16px 24px',
                    textAlign: 'left',
                    transition: 'all 0.2s ease',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    borderLeft: '3px solid transparent',
                    fontFamily: UI_FONT_FAMILY,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--stdb-green)';
                    e.currentTarget.style.backgroundColor = 'var(--stdb-green-bg)';
                    e.currentTarget.style.borderLeftColor = 'var(--stdb-green)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderLeftColor = 'transparent';
                  }}
                >
                  {item.label}
                </button>
              )
            )}

            {/* LOGIN Button in Menu */}
            <button
              onClick={handlePlayClick}
              style={{
                backgroundColor: 'var(--stdb-green)',
                color: 'var(--stdb-btn-primary-text)',
                border: 'none',
                borderRadius: '6px',
                padding: '16px 24px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                boxShadow: '0 4px 12px rgba(0, 255, 136, 0.3)',
                transition: 'all 0.2s ease',
                margin: '20px 24px 0',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--stdb-btn-primary-hover)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 255, 136, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--stdb-green)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 255, 136, 0.3)';
              }}
            >
              LOGIN
            </button>
          </div>
        </>
      )}
    </>
  );
};

interface LoginScreenProps {
  handleJoinGame: (usernameToRegister: string | null) => Promise<void>;
  loggedInPlayer: { username: string } | null;
  connectionError?: string | null; // SpacetimeDB connection error from GameConnectionContext
  storedUsername?: string | null; // Username from localStorage for connection error fallback
  isSpacetimeConnected?: boolean; // Whether SpacetimeDB is connected (used to hide username for connection issues)
  isSpacetimeReady?: boolean; // Whether SpacetimeDB is fully ready (connection + identity established)
  retryConnection?: () => void; // Function to retry the SpacetimeDB connection
  onlinePlayerCount?: number; // Live count of connected human players
  maxPlayerCount?: number; // Server capacity (e.g. 50)
}

const LoginScreen: React.FC<LoginScreenProps> = ({
  handleJoinGame,
  loggedInPlayer,
  connectionError,
  storedUsername,
  isSpacetimeConnected = true,
  isSpacetimeReady: _isSpacetimeReady = true,
  retryConnection,
  onlinePlayerCount,
  maxPlayerCount,
}) => {
  // Get OpenAuth state and functions
  const {
    userProfile, // Contains { userId } after successful login 
    isAuthenticated,
    isLoading: authIsLoading,
    authError,
    loginRedirect,
    logout
  } = useAuth();

  const navigate = useNavigate();

  // Local state for the username input field (only used for new players)
  const [inputUsername, setInputUsername] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);

  // Debug logging for new users (enable when debugging)
  // React.useEffect(() => {
  //     if (isAuthenticated && !loggedInPlayer && !storedUsername) {
  //         console.log(`[LoginScreen DEBUG] New user state - isSpacetimeReady: ${isSpacetimeReady}, isSpacetimeConnected: ${isSpacetimeConnected}, connectionError: ${connectionError}`);
  //     }
  // }, [isAuthenticated, loggedInPlayer, storedUsername, isSpacetimeReady, isSpacetimeConnected, connectionError]);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [showBackToTop, setShowBackToTop] = useState<boolean>(false);
  const [showStickyNav, setShowStickyNav] = useState<boolean>(false);
  const [backgroundLoaded, setBackgroundLoaded] = useState<boolean>(false);

  // --- Scroll-based Auth Header Visibility ---
  const [showAuthHeader, setShowAuthHeader] = useState<boolean>(true);
  const lastScrollY = useRef<number>(0);

  // Ref for username input focus
  const usernameInputRef = useRef<HTMLInputElement>(null);

  const [expandedFaqIndex, setExpandedFaqIndex] = useState<number | null>(null);

  // Check for mobile screen size
  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkIsMobile(); // Check on mount
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  // Check scroll position for back to top button, sticky nav, and auth header
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const currentScrollY = window.scrollY;

      setShowBackToTop(scrollTop > 300); // Show after scrolling 300px
      setShowStickyNav(scrollTop > window.innerHeight * 0.8); // Show after scrolling past 80% of viewport height

      // Auth header visibility logic
      if (currentScrollY < 50) {
        setShowAuthHeader(true);
      }
      // Hide header when scrolling down
      else if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
        setShowAuthHeader(false);
      }
      // Show header when scrolling up
      else if (currentScrollY < lastScrollY.current) {
        setShowAuthHeader(true);
      }

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Aggressive image preloading and loading detection
  useEffect(() => {
    // Preload background image with loading detection
    const backgroundImg = new Image();
    backgroundImg.onload = () => setBackgroundLoaded(true);
    backgroundImg.src = loginBackground;

    // Add preload hints to DOM for additional browser optimization
    const preloadBackground = document.createElement('link');
    preloadBackground.rel = 'preload';
    preloadBackground.href = loginBackground;
    preloadBackground.as = 'image';
    preloadBackground.fetchPriority = 'high';
    document.head.appendChild(preloadBackground);

    // Cleanup
    return () => {
      try {
        document.head.removeChild(preloadBackground);
      } catch (e) {
        // Elements might already be removed
      }
    };
  }, []);

  // Autofocus username field if authenticated AND it's a new player
  useEffect(() => {
    if (isAuthenticated && !loggedInPlayer) {
      usernameInputRef.current?.focus();
    }
  }, [isAuthenticated, loggedInPlayer]);

  // Smooth scroll to section (works with any scroll container)
  const smoothScrollTo = (elementSelector: string) => {
    const element = document.querySelector(elementSelector);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Scroll to top function
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Login button: redirect to auth when not authenticated, scroll to top when authenticated
  const handleLoginClick = async () => {
    if (!isAuthenticated) {
      await loginRedirect();
    } else {
      scrollToTop();
    }
  };

  // Validation: only needed for new players entering a username
  const validateNewUsername = (): boolean => {
    if (!inputUsername.trim()) {
      setLocalError('Username is required to enter the app');
      return false;
    }
    // Add other validation rules if needed (length, characters, etc.)
    setLocalError(null);
    return true;
  };

  // Handle button click: Trigger OpenAuth login or join game
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLocalError(null); // Clear previous local errors

    if (!isAuthenticated) {
      // If not authenticated, start the OpenAuth login flow
      await loginRedirect();
    } else {
      // If authenticated, check if it's a new or existing player

      // CRITICAL CHECK: If authenticated but an authError exists, do not proceed.
      // This typically means a token was rejected, and invalidateCurrentToken should have
      // set isAuthenticated to false. If not, this is a safeguard.
      if (authError) {
        console.warn("[LoginScreen] Attempted to join game while authError is present. Aborting. Error:", authError);
        // The authError is already displayed. The user should likely re-authenticate.
        // Disabling the button (see below) also helps prevent this.
        return;
      }

      try {
        if (loggedInPlayer) {
          // Existing player with loaded player data: Join directly
          await handleJoinGame(null);
        } else if (storedUsername) {
          // Existing player reconnecting with stored username: Join directly
          await handleJoinGame(null);
        } else if (inputUsername.trim()) {
          // New player with entered username: Validate and join
          if (validateNewUsername()) {
            await handleJoinGame(inputUsername);
          }
        } else {
          // No player data and no username entered
          // Only show validation error if username input is actually visible
          const shouldShowUsernameInput = !authError && !connectionError && !localError && isSpacetimeConnected && !loggedInPlayer && !storedUsername;
          if (shouldShowUsernameInput) {
            setLocalError('Username is required to enter the app');
          } else {
            // Fallback: try to join anyway (might be a returning player with slow loading)
            await handleJoinGame(null);
          }
        }
      } catch (error) {
        // Handle server-side errors (like username already taken)
        const errorMessage = error instanceof Error ? error.message : String(error);
        setLocalError(errorMessage);
      }
    }
  };

  // Handle Enter key press in the input field (only applicable for new players)
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !authIsLoading && isAuthenticated && !loggedInPlayer) {
      handleSubmit(event as unknown as React.FormEvent);
    }
  };

  // Override global App.css scroll restrictions for login screen
  React.useEffect(() => {
    // Store original styles
    const originalBodyOverflow = document.body.style.overflow;
    const originalBodyOverflowX = document.body.style.overflowX;
    const originalBodyOverflowY = document.body.style.overflowY;
    const originalBodyHeight = document.body.style.height;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalHtmlOverflowX = document.documentElement.style.overflowX;
    const originalHtmlOverflowY = document.documentElement.style.overflowY;

    // Find and override .App container styles
    const appElement = document.querySelector('.App') as HTMLElement;
    const originalAppOverflow = appElement?.style.overflow;
    const originalAppOverflowX = appElement?.style.overflowX;
    const originalAppOverflowY = appElement?.style.overflowY;
    const originalAppHeight = appElement?.style.height;

    // COMPLETELY DISABLE horizontal scrolling at all levels
    document.body.style.overflowX = 'hidden';
    document.body.style.overflowY = 'auto';
    document.body.style.height = 'auto';
    document.documentElement.style.overflowX = 'hidden';
    document.documentElement.style.overflowY = 'auto';

    // Apply to App container as well
    if (appElement) {
      appElement.style.overflowX = 'hidden';
      appElement.style.overflowY = 'auto';
      appElement.style.height = 'auto';
    }

    return () => {
      // Restore original styles when component unmounts
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.overflowX = originalBodyOverflowX;
      document.body.style.overflowY = originalBodyOverflowY;
      document.body.style.height = originalBodyHeight;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.documentElement.style.overflowX = originalHtmlOverflowX;
      document.documentElement.style.overflowY = originalHtmlOverflowY;

      if (appElement) {
        appElement.style.overflow = originalAppOverflow || '';
        appElement.style.overflowX = originalAppOverflowX || '';
        appElement.style.overflowY = originalAppOverflowY || '';
        appElement.style.height = originalAppHeight || '';
      }
    };
  }, []);

  return (
    <>
      {/* Fixed Header with Email and Logout - Desktop only; on mobile we show it below Enter App */}
      {isAuthenticated && userProfile && !isMobile && (
        <div
          className="stdb-auth-header"
          data-visible={showAuthHeader}
        >
          <span className="stdb-auth-header-email">{userProfile.email || 'User'}</span>
          <button onClick={logout} className="stdb-btn-danger">
            LOG OUT
          </button>
        </div>
      )}

      {/* Add CSS animations */}
      <style>{`
                @keyframes pulse {
                    0% { opacity: 0.4; }
                    100% { opacity: 0.8; }
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                @keyframes slideDown {
                    from {
                        transform: translateY(-100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `}</style>

      {/* Sticky Navigation Bar - Always visible on mobile, scroll-triggered on desktop */}
      {(isMobile || showStickyNav) && (
        <div className="stdb-sticky-nav">
          <span onClick={scrollToTop} className="stdb-nav-title">
            SpacetimeDB Auth Demo
          </span>

          {isMobile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {showStickyNav && (
                <button onClick={handleLoginClick} className="stdb-nav-btn-login">
                  LOGIN
                </button>
              )}
              <MobileNavMenu
                navItems={[
                  { label: 'ABOUT', selector: '[data-about-section]' },
                  { label: 'FAQ', selector: '[data-faq-section]' },
                  { label: 'SPACETIMEDB', href: SPACETIMEDB_REFERRAL_URL },
                ]}
                onNavigate={smoothScrollTo}
                onPlayClick={handleLoginClick}
                userEmail={isAuthenticated && userProfile ? (userProfile.email || null) : null}
                onLogout={isAuthenticated ? logout : undefined}
              />
            </div>
          ) : (
            <nav className="stdb-nav-links">
              {[
                { label: 'ABOUT', selector: '[data-about-section]' },
                { label: 'FAQ', selector: '[data-faq-section]' },
                { label: 'SPACETIMEDB', href: SPACETIMEDB_REFERRAL_URL },
              ].map((item) =>
                item.href ? (
                  <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" className="stdb-nav-link">
                    {item.label}
                  </a>
                ) : (
                  <button key={item.label} onClick={() => item.selector && smoothScrollTo(item.selector)} className="stdb-nav-link">
                    {item.label}
                  </button>
                )
              )}
              <button onClick={handleLoginClick} className="stdb-nav-btn-login">
                LOGIN
              </button>
            </nav>
          )}
        </div>
      )}

      <div
        className="stdb-main"
        style={{
          backgroundImage: backgroundLoaded ? `url(${loginBackground})` : 'none',
          backgroundSize: '100% auto',
          backgroundPosition: 'top center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'scroll',
        }}
      >
        <div className={`stdb-main-gradient ${isMobile ? 'stdb-main-gradient--mobile' : 'stdb-main-gradient--desktop'}`} />
        <div className={`stdb-main-column ${isMobile ? 'stdb-main-column--mobile' : 'stdb-main-column--desktop'}`}>
          {!isMobile && <h1 className="stdb-main-title">SpacetimeDB Auth Demo</h1>}

          <div className={`stdb-form-container ${isMobile ? 'stdb-form-container--mobile' : ''}`}>

            {/* Display based on authentication and player existence */}
            {authIsLoading ? (
              <p>Loading...</p>
            ) : (authError || (connectionError && (loggedInPlayer || storedUsername))) ? (
              <>
                <p style={{
                  color: 'white',
                  marginTop: '15px',
                  fontSize: '12px',
                  padding: '8px',
                  backgroundColor: 'var(--stdb-purple-bg)',
                  borderRadius: '4px',
                  marginBottom: '20px',
                  textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                }}>
                  {connectionError || 'Connection failed. Please ensure you have an internet connection and try again.'}<br />
                  {!connectionError && 'If the problem persists, please try signing out and signing in.'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'row', gap: '15px', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                  <button
                    onClick={() => {
                      if (connectionError && connectionError.includes('Please refresh your browser')) {
                        window.location.reload();
                      } else if (connectionError && retryConnection) {
                        retryConnection();
                      } else {
                        window.location.reload();
                      }
                    }}
                    disabled={authIsLoading}
                    className="stdb-btn-action"
                  >
                    {connectionError && connectionError.includes('Please refresh your browser') ? 'Refresh' : 'Try Again'}
                  </button>
                </div>
              </>
            ) : isAuthenticated ? (
              loggedInPlayer ? (
                // Existing Player: Show welcome message
                <p style={{
                  marginBottom: '20px',
                  fontSize: '14px'
                }}>
                  Welcome back, {loggedInPlayer.username}!
                </p>
              ) : storedUsername ? (
                // We have a stored username, so this is an existing player reconnecting
                <p style={{
                  marginBottom: '20px',
                  fontSize: '14px'
                }}>
                  {connectionError ?
                    `Playing as ${storedUsername}` :
                    `Welcome back, ${storedUsername}!`
                  }
                </p>
              ) : connectionError ? (
                // Connection error without stored username: Show generic authenticated message
                <div style={{
                  marginBottom: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  {/* Loading Spinner */}
                  <div style={{
                    width: '32px',
                    height: '32px',
                    border: '3px solid var(--stdb-purple-border)',
                    borderTop: '3px solid var(--stdb-green)',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }} />
                  <p style={{
                    fontSize: '14px',
                    margin: '0',
                    color: 'rgba(255, 255, 255, 0.9)',
                    textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                  }}>
                    Authenticated - Reconnecting to game...
                  </p>
                </div>
              ) : !authError && !connectionError && !localError && !loggedInPlayer && !storedUsername ? (
                // New Player: Always show username input (don't wait for SpacetimeDB)
                <div style={{
                  maxWidth: '350px',
                  margin: '0 auto',
                  textAlign: 'left',
                }}>
                  <div style={{
                    marginBottom: 'var(--stdb-space-lg)',
                  }}>
                    <label style={{
                      display: 'block',
                      marginBottom: 'var(--stdb-space-xs)',
                      fontSize: '13px',
                      color: 'rgba(255, 255, 255, 0.9)',
                      fontWeight: '500',
                      textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                      letterSpacing: '0.5px',
                      fontFamily: UI_FONT_FAMILY,
                    }}>
                      Choose Your Username
                    </label>
                    <input
                      ref={usernameInputRef}
                      type="text"
                      placeholder="Enter username"
                      value={inputUsername}
                      onChange={(e) => setInputUsername(e.target.value)}
                      onKeyDown={handleKeyDown}
                      style={{
                        width: '100%',
                        padding: '16px 20px',
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '2px solid var(--stdb-purple-border)',
                        borderRadius: '12px',
                        color: 'white',
                        fontSize: '16px',
                        fontFamily: UI_FONT_FAMILY,
                        backdropFilter: 'blur(8px)',
                        transition: 'all 0.3s ease',
                        boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.2)',
                        boxSizing: 'border-box',
                        outline: 'none',
                      }}
                      onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'var(--stdb-green)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                      e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.2), 0 0 0 3px var(--stdb-green-bg)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.2)';
                      }}
                    />
                  </div>
                </div>
              ) : (
                // Other states - show empty
                <></>
              )
            ) : null /* Not loading, no error, not authenticated: Button below will handle Sign In */}

            {/* Render Login/Enter App button only if not loading and no authError and (no connectionError OR we have storedUsername) */}
            {!authIsLoading && !authError && (!connectionError || storedUsername) && !localError && (
              <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); handleSubmit(e); }} action="javascript:void(0)">
                <button
                  type="submit"
                  disabled={authError !== null || (connectionError !== null && !storedUsername) || localError !== null}
                  className="stdb-btn-hero"
                >
                  {!isAuthenticated ? 'Start Your Journey' : 'Enter App'}
                </button>

                {/* Mobile: Account info lives in hamburger menu - keeps main area clean */}

                {/* Quick actions under primary CTA */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--stdb-space-sm)',
                  marginTop: 'var(--stdb-space-lg)',
                }}>
                  {/* First row: Get Started and FAQ buttons */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--stdb-space-md)',
                  }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        smoothScrollTo('[data-about-section]');
                      }}
                      className="stdb-btn-secondary"
                    >
                      Get Started
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        smoothScrollTo('[data-faq-section]');
                      }}
                      className="stdb-btn-secondary"
                    >
                      FAQ
                    </button>
                  </div>

                  <p style={{
                    margin: 0,
                    fontSize: '11px',
                    color: 'rgba(255, 255, 255, 0.65)',
                    textAlign: 'center',
                    fontFamily: UI_FONT_FAMILY,
                  }}>
                    MIT licensed personal project. Review the{' '}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate('/license');
                        window.scrollTo(0, 0);
                      }}
                      className="stdb-link-btn"
                    >
                      License
                    </button>
                    {' '}and{' '}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate('/disclaimer');
                        window.scrollTo(0, 0);
                      }}
                      className="stdb-link-btn"
                    >
                      Disclaimer
                    </button>
                    .
                  </p>

                  {/* Live player count (visible when Spacetime connected and props provided) */}
                  {isSpacetimeConnected && typeof onlinePlayerCount === 'number' && typeof maxPlayerCount === 'number' && (
                    <div style={{
                      padding: '6px 12px',
                      backgroundColor: 'rgba(0, 0, 0, 0.65)',
                      borderRadius: '10px',
                    }}>
                      <span style={{
                        fontSize: '12px',
                        color: (() => {
                          if (onlinePlayerCount >= maxPlayerCount) return 'rgba(255, 120, 120, 0.98)';
                          if (onlinePlayerCount >= maxPlayerCount - 5) return 'rgba(255, 200, 100, 0.98)';
                          return 'rgba(255, 255, 255, 0.85)';
                        })(),
                        fontWeight: 500,
                        fontFamily: UI_FONT_FAMILY,
                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                        letterSpacing: '0.5px',
                      }}>
                        Players Online: {onlinePlayerCount} / {maxPlayerCount}
                      </span>
                    </div>
                  )}
                </div>
              </form>
            )}

            {/* Show error state with Refresh button for connection-related localErrors */}
            {!authIsLoading && !authError && !connectionError && localError && (localError.includes('Connection error') || localError.includes('Quantum tunnel collapsed') || localError.includes('Please refresh your browser')) && localError !== connectionError && (
              <>
                <p style={{
                  color: 'white',
                  marginTop: '15px',
                  fontSize: '12px',
                  padding: '8px',
                  backgroundColor: 'var(--stdb-purple-bg)',
                  borderRadius: '4px',
                  marginBottom: '20px',
                  textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                }}>
                  {localError}
                </p>
                <button onClick={() => window.location.reload()} className="stdb-btn-action">
                  Refresh
                </button>
              </>
            )}

            {/* Local Error Messages (e.g., for username validation) - show if not authError and not connection error */}
            {localError && !authError && !localError.includes('Connection error') && !localError.includes('Quantum tunnel collapsed') && !localError.includes('Please refresh your browser') && localError !== connectionError && (
              <p style={{
                color: 'white',
                marginTop: '0px',
                marginBottom: '15px',
                fontSize: '12px',
                padding: '8px',
                backgroundColor: 'var(--stdb-purple-bg)',
                borderRadius: '4px',
                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
              }}>
                {localError}
              </p>
            )}
          </div>

          {/* Content Section - About, FAQ, CTA */}
          <div className="stdb-content-section">
            <div data-content-section className="stdb-content-inner">
              <AboutSection onFaqClick={() => smoothScrollTo('[data-faq-section]')} />
              <FAQSection
                items={FAQ_ITEMS(() => navigate('/license'), () => navigate('/disclaimer'))}
                expandedIndex={expandedFaqIndex}
                onToggle={(i) => setExpandedFaqIndex(expandedFaqIndex === i ? null : i)}
              />
              {!isAuthenticated && (
                <div className="stdb-cta-section">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSubmit(e as unknown as React.FormEvent);
                    }}
                    className="stdb-cta-btn"
                  >
                    Start Your Journey
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {showBackToTop && (
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="stdb-back-to-top" title="Back to Top">
            ↑
          </button>
        )}

        <footer className="stdb-footer">
          <div className="stdb-footer-line" />
          <div className="stdb-footer-dot" />

          <div className={`stdb-footer-grid ${isMobile ? 'stdb-footer-grid--mobile' : 'stdb-footer-grid--desktop'}`}>
            <div className={`stdb-footer-col ${isMobile ? 'stdb-footer-col--mobile' : ''}`}>
              <strong className="stdb-footer-title">SpacetimeDB Auth Demo</strong>
              <p className="stdb-footer-p">
                See <a href="https://github.com/SeloSlav/spacetimedb-openauthjs/blob/main/README.md" target="_blank" rel="noopener noreferrer" className="stdb-footer-link">README</a> for setup.
              </p>
              <p className="stdb-footer-p" style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)', margin: '10px 0 0 0' }}>
                Independent personal project. Not officially affiliated with SpacetimeDB or Clockwork Labs.
              </p>
            </div>

            <div className={`stdb-footer-col ${isMobile ? 'stdb-footer-col--mobile' : ''}`}>
              <h4 className="stdb-footer-h4">APP</h4>
              <ul className="stdb-footer-ul">
                {[
                  { label: 'ABOUT', action: 'about', internal: false },
                  { label: 'FAQ', action: 'faq', internal: false },
                  { label: 'SPACETIMEDB', action: SPACETIMEDB_REFERRAL_URL, external: true },
                ].map((link: { label: string; action: string; external?: boolean; internal?: boolean }) => (
                  <li key={link.label} className="stdb-footer-li">
                    <a
                      href={link.external ? link.action : '#'}
                      target={link.external ? '_blank' : undefined}
                      rel={link.external ? 'noopener noreferrer' : undefined}
                      onClick={(e) => {
                        if (link.external) return;
                        e.preventDefault();
                        if (link.internal) {
                          navigate(link.action);
                          window.scrollTo(0, 0);
                        } else {
                          const selector = `[data-${link.action}-section]`;
                          const section = document.querySelector(selector);
                          if (section) {
                            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          } else {
                            navigate('/');
                            setTimeout(() => {
                              const homeSection = document.querySelector(selector);
                              if (homeSection) homeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }, 100);
                          }
                        }
                      }}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className={`stdb-footer-col ${isMobile ? 'stdb-footer-col--mobile' : ''}`}>
              <h4 className="stdb-footer-h4">LEGAL</h4>
              <ul className="stdb-footer-ul">
                {[{ label: 'MIT LICENSE', path: '/license' }, { label: 'DISCLAIMER', path: '/disclaimer' }].map((link) => (
                  <li key={link.label} className="stdb-footer-li">
                    <a href={link.path} onClick={(e) => { e.preventDefault(); navigate(link.path); window.scrollTo(0, 0); }}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className={`stdb-footer-social ${isMobile ? 'stdb-footer-social--mobile' : ''}`}>
              <h4 className={`stdb-footer-h4 ${isMobile ? 'stdb-footer-h4--center' : 'stdb-footer-h4--right'}`}>CONNECT</h4>
              <div className="stdb-footer-social-icons">
                {[
                  { name: 'GitHub', icon: faGithub, href: 'https://github.com/SeloSlav/spacetimedb-openauthjs' },
                  { name: 'X', icon: faXTwitter, href: 'https://x.com/seloslav' },
                ].map((social) => (
                  <a key={social.name} href={social.href} target="_blank" rel="noopener noreferrer" title={social.name} className="stdb-footer-social-icon">
                    <FontAwesomeIcon icon={social.icon} />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
};

export default LoginScreen; 