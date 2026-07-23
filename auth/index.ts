/**
 * Hono OIDC issuer with password UI, PKCE, database storage, and managed JWT keys.
 */
import dotenv from 'dotenv';
import {
  canAuthenticate,
  emailFeaturesEnabled,
  requiresEmailProvider,
  resolveEmailMode,
} from './email-mode.js';

// Load environment variables from .env file in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Environment-based configuration
const isDevelopment = process.env.NODE_ENV !== 'production';
const config = {
  isDevelopment,
  port: parseInt(process.env.PORT || '4001'),
  issuerUrl: (process.env.ISSUER_URL || 'http://localhost:4001').replace(/\/+$/, ''),
  databaseUrl: process.env.DATABASE_URL,
  jwtPrivateKey: process.env.JWT_PRIVATE_KEY,
  jwtPublicKey: process.env.JWT_PUBLIC_KEY,
  clientId: process.env.AUTH_CLIENT_ID || 'vibe-survival-game-client',
  emailMode: resolveEmailMode(process.env.AUTH_EMAIL_MODE, isDevelopment),
  trustProxy: process.env.TRUST_PROXY === 'true',
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:5173', 'http://localhost:5176'],
};

function validateConfig(): void {
  if (requiresEmailProvider(config.emailMode)) {
    const missingEmailConfig = [
      !process.env.RESEND_API_KEY && 'RESEND_API_KEY',
      !process.env.RESEND_FROM && 'RESEND_FROM',
    ].filter(Boolean);
    if (missingEmailConfig.length > 0) {
      throw new Error(`AUTH_EMAIL_MODE=resend requires: ${missingEmailConfig.join(', ')}`);
    }
  }

  if (config.isDevelopment) return;

  const missing = [
    !process.env.ISSUER_URL && 'ISSUER_URL',
    !config.databaseUrl && 'DATABASE_URL',
    !config.jwtPrivateKey && 'JWT_PRIVATE_KEY',
    !config.jwtPublicKey && 'JWT_PUBLIC_KEY',
    !process.env.ALLOWED_ORIGINS && 'ALLOWED_ORIGINS',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
  }

  const issuer = new URL(config.issuerUrl);
  if (issuer.protocol !== 'https:') throw new Error('ISSUER_URL must use HTTPS in production.');
  if (issuer.username || issuer.password || issuer.search || issuer.hash) {
    throw new Error('ISSUER_URL must not contain credentials, a query, or a fragment.');
  }
  for (const origin of config.allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:') throw new Error(`Production origin must use HTTPS: ${origin}`);
    if (parsed.origin !== origin.replace(/\/$/, '')) throw new Error(`ALLOWED_ORIGINS entries must be origins: ${origin}`);
  }
  for (const redirectUri of process.env.ALLOWED_REDIRECT_URIS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []) {
    if (new URL(redirectUri).protocol !== 'https:') {
      throw new Error(`Production redirect URI must use HTTPS: ${redirectUri}`);
    }
  }
}

validateConfig();

console.log(`[Config] Environment: ${config.isDevelopment ? 'development' : 'production'}`);
console.log(`[Config] Port: ${config.port}`);
console.log(`[Config] Issuer URL: ${config.issuerUrl}`);
console.log(`[Config] Database: ${config.databaseUrl ? 'PostgreSQL' : 'protected development JSON'}`);
console.log(`[Config] Email mode: ${config.emailMode}`);

import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';

import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { Buffer } from 'buffer'; // Needed for PKCE base64
import crypto from 'crypto'; // Needed for PKCE hash
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Import our new modules
import { db, type UserRecord } from './database.js';
import { initializeKeys, getPrivateKey, getPublicJWK, keyId } from './jwt-keys.js';
import { Resend } from 'resend';
import {
  FixedWindowRateLimiter,
  hashPassword,
  isPasswordInputWithinLimit,
  normalizeEmail,
  privacyKey,
  validatePassword,
  verifyPassword,
} from './security.js';

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */
const PORT        = config.port;
const ISSUER_URL  = config.issuerUrl;
const CLIENT_ID   = config.clientId;
const PASSWORD_RESET_EXPIRY_MINUTES = 15;
const EMAIL_VERIFICATION_EXPIRY_HOURS = 24;
const ACCESS_TOKEN_EXPIRY_MINUTES = 15;
const REFRESH_TOKEN_IDLE_EXPIRY_DAYS = 7;
const REFRESH_TOKEN_MAX_EXPIRY_DAYS = 30;
const MAX_FORM_BODY_BYTES = 64 * 1024;
const REFRESH_COOKIE_NAME = config.isDevelopment ? 'oidc_refresh_dev' : '__Host-oidc_refresh';
const rateLimiter = new FixedWindowRateLimiter();
let dummyPasswordHash = '';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_THEME_DIR_CANDIDATES = [
  path.resolve(__dirname, '../client/src/theme'),
  path.resolve(__dirname, '../../client/src/theme'),
];
const CLIENT_THEME_DIR = CLIENT_THEME_DIR_CANDIDATES.find((candidate) =>
  fs.existsSync(path.join(candidate, 'uiTheme.css'))
) ?? CLIENT_THEME_DIR_CANDIDATES[0];
const SHARED_THEME_FILES = new Set(['uiTheme.css', 'authPages.css']);
const allowedRedirectUris = new Set(
  [
    ...(process.env.ALLOWED_REDIRECT_URIS?.split(',') ?? []),
    ...config.allowedOrigins.map((origin) => `${origin.replace(/\/$/, '')}/callback`),
    `${ISSUER_URL.replace(/\/$/, '')}/callback`,
  ]
    .map((uri) => uri.trim())
    .filter(Boolean)
    .map((uri) => {
      try {
        return new URL(uri).toString();
      } catch {
        return '';
      }
    })
    .filter(Boolean)
);

function decodeRedirectUri(raw: string): string | null {
  let decoded = raw;
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    return new URL(decoded).toString();
  } catch {
    return null;
  }
}

function isValidAuthorizationRequest(
  clientId: string,
  redirectUri: string | null,
  codeChallenge: string,
  codeChallengeMethod: string
): redirectUri is string {
  return clientId === CLIENT_ID
    && redirectUri !== null
    && allowedRedirectUris.has(redirectUri)
    && codeChallengeMethod === 'S256'
    && /^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge);
}

// Initialize Resend for email sending
const resendApiKey = process.env.RESEND_API_KEY;
const resend = config.emailMode === 'resend' ? new Resend(resendApiKey!) : null;
const resendFrom = process.env.RESEND_FROM || 'SpacetimeDB Auth Demo <noreply@example.com>';

switch (config.emailMode) {
  case 'resend':
    console.log('[Config] Resend email service configured');
    break;
  case 'console':
    console.warn('[Config] Development email links will be logged to the console');
    break;
  case 'disabled':
    console.warn('[Config] Email ownership verification and password recovery are disabled');
    break;
}

/* -------------------------------------------------------------------------- */
/* Core Password Logic Handlers (Updated for database)                       */
/* -------------------------------------------------------------------------- */

async function _handlePasswordRegisterSimple(email: string, password?: string): Promise<{ id: string; email: string } | null> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password || validatePassword(password)) return null;

  // Hash before checking for duplicates to reduce registration-based email timing leaks.
  const passwordHash = await hashPassword(password);
  const existing = await db.getUserByEmail(normalizedEmail);
  if (existing) return null;

  const userId = uuidv4();
  const newUser: UserRecord = {
    userId,
    email: normalizedEmail,
    passwordHash,
    emailVerified: false,
  };
  const success = await db.createUser(newUser);
  if (!success) return null;
  console.info(`[RegisterHandler] New unverified user registered: ${userId}`);
  return { id: userId, email: normalizedEmail };
}

async function _handlePasswordLoginSimple(email: string, password?: string): Promise<{ id: string; email: string } | null> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password || !isPasswordInputWithinLimit(password)) return null;
  const user = await db.getUserByEmail(normalizedEmail);
  const verification = await verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
  if (!user || !verification.valid || !canAuthenticate(config.emailMode, user.emailVerified)) return null;

  if (verification.needsRehash) {
    await db.updateUserPassword(user.userId, await hashPassword(password));
  }
  console.info(`[LoginHandler] User logged in: ${user.userId}`);
  return { id: user.userId, email: normalizedEmail };
}

function isTrustedOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.origin === new URL(ISSUER_URL).origin) return true;
    if (config.allowedOrigins.includes(parsed.origin)) return true;
    return config.isDevelopment
      && parsed.protocol === 'http:'
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

function rejectUntrustedBrowserOrigin(c: Context, requireOrigin = false): Response | null {
  const origin = c.req.header('Origin');
  return (!origin && requireOrigin) || (origin && !isTrustedOrigin(origin))
    ? c.json({ error: 'invalid_request' }, 403)
    : null;
}

function clientRateLimitKey(c: Context): string {
  const directAddress = getConnInfo(c).remote.address ?? 'unknown-client';
  if (!config.trustProxy) return privacyKey(directAddress);

  const forwardedAddress = c.req.header('CF-Connecting-IP')
    || c.req.header('X-Real-IP')
    || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
  return privacyKey(forwardedAddress || directAddress);
}

function consumeRateLimit(
  c: Context,
  bucket: string,
  subject: string,
  limit: number,
  windowMs: number
): boolean {
  const result = rateLimiter.consume(`${bucket}:${subject}`, limit, windowMs);
  if (!result.allowed) {
    c.header('Retry-After', String(result.retryAfterSeconds));
    return false;
  }
  return true;
}

function refreshCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: !config.isDevelopment,
    sameSite: 'Strict' as const,
    path: '/',
    expires,
    maxAge: expires ? Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000)) : undefined,
    priority: 'High' as const,
  };
}

function setRefreshTokenCookie(c: Context, token: string, expires: Date): void {
  setCookie(c, REFRESH_COOKIE_NAME, token, refreshCookieOptions(expires));
}

function clearRefreshTokenCookie(c: Context): void {
  deleteCookie(c, REFRESH_COOKIE_NAME, refreshCookieOptions(new Date(0)));
}

function readRefreshToken(c: Context, formToken: FormDataEntryValue | null): string | null {
  if (typeof formToken === 'string' && formToken.length > 0) return formToken;
  return getCookie(c, REFRESH_COOKIE_NAME) ?? null;
}

async function issueEmailVerification(user: { id: string; email: string }, returnTo: string): Promise<void> {
  if (!emailFeaturesEnabled(config.emailMode)) return;

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);
  await db.storeEmailVerificationToken(token, user.id, expiresAt);

  const verificationLink = `${ISSUER_URL}/auth/password/verify-email?token=${token}&return_to=${encodeURIComponent(returnTo)}`;
  if (config.emailMode === 'console') {
    console.log(`[EmailVerification] DEV MODE - verification link: ${verificationLink}`);
    return;
  }

  await resend!.emails.send({
    from: resendFrom,
    to: user.email,
    subject: 'Verify your SpacetimeDB Auth Demo email',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family:system-ui,-apple-system,sans-serif;background:#1a1a2e;color:#fff;padding:40px 20px">
        <div style="max-width:500px;margin:0 auto;background:#28283c;border-radius:16px;padding:40px">
          <h1 style="color:#ff8c00">Verify your email</h1>
          <p>Confirm this address before signing in.</p>
          <a href="${verificationLink}" style="display:inline-block;background:#e67700;color:#fff;padding:14px 24px;text-decoration:none;border-radius:10px">Verify email</a>
          <p style="opacity:.65;font-size:13px">This link expires in ${EMAIL_VERIFICATION_EXPIRY_HOURS} hours.</p>
        </div>
      </body>
      </html>
    `,
  });
}

function issueSignedTokens(user: UserRecord, clientId: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const basePayload = {
    iss: ISSUER_URL,
    sub: user.userId,
    aud: clientId,
    iat: issuedAt,
    email: user.email,
    email_verified: user.emailVerified,
    account_active: canAuthenticate(config.emailMode, user.emailVerified),
  };
  const signOptions: jwt.SignOptions = {
    algorithm: 'RS256',
    expiresIn: `${ACCESS_TOKEN_EXPIRY_MINUTES}m`,
    keyid: keyId,
  };
  const privateKey = getPrivateKey();
  const idToken = jwt.sign({ ...basePayload, token_use: 'id' }, privateKey, {
    ...signOptions,
    jwtid: crypto.randomUUID(),
  });
  const accessToken = jwt.sign({ ...basePayload, token_use: 'access' }, privateKey, {
    ...signOptions,
    jwtid: crypto.randomUUID(),
  });
  return {
    idToken,
    accessToken,
    expiresInSeconds: ACCESS_TOKEN_EXPIRY_MINUTES * 60,
  };
}

/* -------------------------------------------------------------------------- */
/* Helper Functions for Password Reset Pages                                   */
/* -------------------------------------------------------------------------- */
const AUTH_SPOTLIGHT_SCRIPT = `
(function(){
  document.addEventListener('DOMContentLoaded',function(){
    var el=document.querySelector('.container');
    if(!el)return;
    var r=80;
    var bg=document.createElement('div');
    bg.className='container-bg';
    var content=document.createElement('div');
    content.className='container-content';
    while(el.firstChild)content.appendChild(el.firstChild);
    el.appendChild(bg);
    el.appendChild(content);
    var crosshair=document.createElement('div');
    crosshair.className='stdb-aperture-crosshair';
    crosshair.setAttribute('aria-hidden','true');
    crosshair.style.display='none';
    el.appendChild(crosshair);
    el.addEventListener('mousemove',function(e){
      var rect=el.getBoundingClientRect();
      var x=e.clientX-rect.left,y=e.clientY-rect.top;
      bg.style.webkitMaskImage='radial-gradient(circle at '+x+'px '+y+'px, transparent 0%, transparent '+r+'px, black '+r+'px)';
      bg.style.maskImage='radial-gradient(circle at '+x+'px '+y+'px, transparent 0%, transparent '+r+'px, black '+r+'px)';
      crosshair.style.left=x+'px';crosshair.style.top=y+'px';
      crosshair.style.display='block';
      el.classList.add('stdb-aperture-active');
    });
    el.addEventListener('mouseleave',function(){
      bg.style.webkitMaskImage='';bg.style.maskImage='';
      crosshair.style.display='none';
      el.classList.remove('stdb-aperture-active');
    });
  });
})();
`;

function renderAuthPageHead(title: string): string {
  return `
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="icon" type="image/png" href="/favicon.png">
      <title>${title}</title>
      <link rel="stylesheet" href="/theme/uiTheme.css">
      <link rel="stylesheet" href="/theme/authPages.css">
      <script defer src="/auth-ui.js"></script>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeReturnTo(raw?: string): string {
  const defaultPath = '/auth/password/login';
  if (!raw) return defaultPath;
  try {
    const decoded = decodeURIComponent(raw);
    const url = new URL(decoded, ISSUER_URL);
    if (url.origin !== new URL(ISSUER_URL).origin) return defaultPath;
    if (url.pathname !== '/auth/password/login') return defaultPath;
    return `${url.pathname}${url.search}`;
  } catch {
    return defaultPath;
  }
}

function renderEmailHelpLinks(loginReturnTo: string): string {
  if (!emailFeaturesEnabled(config.emailMode)) return '';
  const encodedReturnTo = encodeURIComponent(loginReturnTo);
  return `
    <p class="form-link" style="margin-top: -15px; margin-bottom: 0;"><a href="/auth/password/forgot?return_to=${encodedReturnTo}">Forgot Password?</a></p>
    <p class="form-link"><a href="/auth/password/resend-verification?return_to=${encodedReturnTo}">Resend verification email</a></p>
  `;
}

function clientAppUrlFromReturnTo(returnTo?: string): string {
  try {
    const loginUrl = new URL(sanitizeReturnTo(returnTo), ISSUER_URL);
    const redirectUri = decodeRedirectUri(loginUrl.searchParams.get('redirect_uri') ?? '');
    if (redirectUri && allowedRedirectUris.has(redirectUri)) {
      return `${new URL(redirectUri).origin}/`;
    }
  } catch {
    // Fall through to the configured client.
  }
  return config.allowedOrigins[0] ? `${config.allowedOrigins[0].replace(/\/$/, '')}/` : `${ISSUER_URL}/`;
}

function renderForgotPasswordPage(opts: { error?: string; success?: string; returnTo?: string } = {}): string {
  const { error, success, returnTo = '/auth/password/login' } = opts;
  const safeReturnTo = escapeHtml(returnTo);
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      ${renderAuthPageHead('Forgot Password - SpacetimeDB Auth Demo')}
  </head>
  <body>
      <div class="container">
          <div class="game-title">
              <span style="font-size: 24px; font-weight: 700; color: white;">SpacetimeDB Auth Demo</span>
          </div>
          <h1 class="form-title">Forgot Password</h1>
          ${success ? `<div class="success-message">${success}</div>` : `
          <p class="form-description">Enter your email address and we'll send you a link to reset your password.</p>
          ${error ? `<div class="error-message">${error}</div>` : ''}
          <form method="post">
              <input type="hidden" name="return_to" value="${safeReturnTo}">
              <div class="form-group">
                  <label for="email">Email Address</label>
                  <input id="email" name="email" type="email" autocomplete="email" required placeholder="Enter your email">
              </div>
              <button type="submit" class="submit-button">Send Reset Link</button>
          </form>
          `}
          <div class="divider"></div>
          <p class="form-link">Remember your password? <a href="${safeReturnTo}">Sign In</a></p>
      </div>
  </body>
  </html>
  `;
}

function renderVerificationRequestPage(opts: { success?: string; returnTo?: string } = {}): string {
  const returnTo = sanitizeReturnTo(opts.returnTo);
  const safeReturnTo = escapeHtml(returnTo);
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>${renderAuthPageHead('Verify Email - SpacetimeDB Auth Demo')}</head>
  <body>
    <div class="container">
      <div class="game-title"><span>SpacetimeDB Auth Demo</span></div>
      <h1 class="form-title">Verify Email</h1>
      ${opts.success
        ? `<div class="success-message">${escapeHtml(opts.success)}</div>`
        : `
          <p class="form-description">Enter your email to request a fresh verification link.</p>
          <form method="post">
            <input type="hidden" name="return_to" value="${safeReturnTo}">
            <div class="form-group">
              <label for="email">Email Address</label>
              <input id="email" name="email" type="email" autocomplete="email" required>
            </div>
            <button type="submit" class="submit-button">Send Verification Link</button>
          </form>
        `}
      <div class="divider"></div>
      <p class="form-link"><a href="${safeReturnTo}">Sign In</a></p>
    </div>
  </body>
  </html>`;
}

function renderResetPasswordPage(opts: { token?: string; email?: string; error?: string; returnTo?: string } = {}): string {
  const { token, email, error, returnTo = '/auth/password/login' } = opts;
  const showForm = token && !error?.includes('Invalid') && !error?.includes('expired') && !error?.includes('already been used');
  const safeReturnTo = escapeHtml(returnTo);
  
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      ${renderAuthPageHead('Reset Password - SpacetimeDB Auth Demo')}
  </head>
  <body>
      <div class="container">
          <div class="game-title">
              <span style="font-size: 24px; font-weight: 700; color: white;">SpacetimeDB Auth Demo</span>
          </div>
          <h1 class="form-title">Reset Password</h1>
          ${error ? `<div class="error-message">${error}</div>` : ''}
          ${showForm ? `
          <p class="form-description">Enter a new password for <strong>${email ? escapeHtml(email) : ''}</strong></p>
          <form method="post">
              <input type="hidden" name="token" value="${token ? escapeHtml(token) : ''}">
              <input type="hidden" name="return_to" value="${safeReturnTo}">
              <div class="form-group">
                  <label for="password">New Password</label>
                  <input id="password" name="password" type="password" autocomplete="new-password" required placeholder="Enter new password" minlength="15" maxlength="128">
              </div>
              <div class="form-group">
                  <label for="confirm_password">Confirm Password</label>
                  <input id="confirm_password" name="confirm_password" type="password" autocomplete="new-password" required placeholder="Confirm new password" minlength="15" maxlength="128">
              </div>
              <button type="submit" class="submit-button">Reset Password</button>
          </form>
          ` : ''}
          <div class="divider"></div>
          <p class="form-link"><a href="/auth/password/forgot?return_to=${encodeURIComponent(returnTo)}">Request New Reset Link</a> | <a href="${safeReturnTo}">Sign In</a></p>
      </div>
  </body>
  </html>
  `;
}

function renderStatusPage(opts: {
  title: string;
  message: string;
  returnTo?: string;
  actionLabel?: string;
  error?: boolean;
}): string {
  const returnTo = sanitizeReturnTo(opts.returnTo);
  const actionUrl = clientAppUrlFromReturnTo(returnTo);
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>${renderAuthPageHead(`${opts.title} - SpacetimeDB Auth Demo`)}</head>
  <body>
    <div class="container">
      <div class="game-title"><span>SpacetimeDB Auth Demo</span></div>
      <h1 class="form-title">${escapeHtml(opts.title)}</h1>
      <div class="${opts.error ? 'error-message' : 'success-message'}">${escapeHtml(opts.message)}</div>
      <div class="divider"></div>
      <p class="form-link"><a href="${escapeHtml(actionUrl)}">${escapeHtml(opts.actionLabel ?? 'Return to App')}</a></p>
    </div>
  </body>
  </html>`;
}

/* -------------------------------------------------------------------------- */
/* Server                                                                     */
/* -------------------------------------------------------------------------- */
(async () => {
  // Initialize database and keys
  await db.init();
  await initializeKeys();
  dummyPasswordHash = await hashPassword(crypto.randomBytes(32).toString('base64url'));

  const app  = new Hono();

  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'none'"],
      connectSrc: ["'self'", 'https:', 'wss:', ...(config.isDevelopment ? ['http:', 'ws:'] : [])],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      workerSrc: ["'self'"],
      ...(config.isDevelopment ? {} : { upgradeInsecureRequests: [] }),
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    referrerPolicy: 'no-referrer',
    strictTransportSecurity: config.isDevelopment ? false : 'max-age=63072000; includeSubDomains; preload',
    xFrameOptions: 'DENY',
    permissionsPolicy: {
      camera: [],
      geolocation: [],
      microphone: [],
      payment: [],
      usb: [],
    },
  }));
  app.use('*', bodyLimit({
    maxSize: MAX_FORM_BODY_BYTES,
    onError: (c) => c.json({ error: 'request_too_large' }, 413),
  }));
  app.use('/token', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
    await next();
  });
  app.use('/revoke', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
    await next();
  });
  app.use('/auth/password/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
    await next();
  });

  app.get('/auth-ui.js', (c) => {
    c.header('Content-Type', 'application/javascript; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.body(AUTH_SPOTLIGHT_SCRIPT);
  });

  // --- Static File Serving for favicon ---
  app.get('/favicon.png', async (c) => {
    try {
      const imagePath = path.join(process.cwd(), 'favicon.png');
      const imageBuffer = fs.readFileSync(imagePath);
      c.header('Content-Type', 'image/png');
      c.header('Cache-Control', 'public, max-age=86400');
      return c.body(imageBuffer);
    } catch (error) {
      console.error('[Static] Failed to serve favicon.png:', error);
      return c.text('Not found', 404);
    }
  });

  app.get('/favicon.ico', async (c) => {
    try {
      const imagePath = path.join(process.cwd(), 'favicon.png');
      const imageBuffer = fs.readFileSync(imagePath);
      c.header('Content-Type', 'image/png');
      c.header('Cache-Control', 'public, max-age=86400');
      return c.body(imageBuffer);
    } catch {
      return c.text('Not found', 404);
    }
  });

  // --- Static File Serving for the auth-page background ---
  app.get('/login_background_v2.jpg', async (c) => {
    try {
      const imagePath = path.join(process.cwd(), 'login_background_v2.jpg');
      const imageBuffer = fs.readFileSync(imagePath);
      c.header('Content-Type', 'image/jpeg');
      c.header('Cache-Control', 'public, max-age=3600');
      return c.body(imageBuffer);
    } catch (error) {
      console.error('[Static] Failed to serve login_background_v2.jpg:', error);
      return c.text('Image not found', 404);
    }
  });

  // --- Serve shared theme files directly from client/theme ---
  app.get('/theme/:file', async (c) => {
    const file = c.req.param('file');
    if (!SHARED_THEME_FILES.has(file)) {
      return c.text('Not found', 404);
    }

    try {
      const themePath = path.join(CLIENT_THEME_DIR, file);
      const css = fs.readFileSync(themePath, 'utf8');
      c.header('Content-Type', 'text/css; charset=utf-8');
      c.header('Cache-Control', 'public, max-age=300');
      return c.body(css);
    } catch (error) {
      console.error(`[Static] Failed to serve theme file: ${file}`, error);
      return c.text('Not found', 404);
    }
  });

  // --- Server-rendered document page with full SEO/OG meta ---
  app.get('/document', (c) => {
    const baseUrl = ISSUER_URL;
    const ogImage = `${baseUrl}/favicon.png`;
    return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <title>SpacetimeDB Auth Demo - OIDC + SpacetimeDB</title>
  <meta name="description" content="SpacetimeDB Auth Demo shows a complete OIDC + SpacetimeDB authentication flow with login, token issuance, refresh, and password reset." />
  <meta name="keywords" content="SpacetimeDB, OIDC, authentication demo, token refresh, password reset, realtime" />
  <meta name="author" content="SpacetimeDB Auth Demo" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${baseUrl}/document" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="SpacetimeDB Auth Demo - OIDC + SpacetimeDB" />
  <meta property="og:description" content="An authentication demo that integrates a self-hosted OIDC issuer with SpacetimeDB for realtime applications." />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:url" content="${baseUrl}/document" />
  <meta property="og:site_name" content="SpacetimeDB Auth Demo" />
  <meta property="og:locale" content="en_US" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="SpacetimeDB Auth Demo - OIDC + SpacetimeDB" />
  <meta name="twitter:description" content="OIDC + SpacetimeDB authentication demo." />
  <meta name="twitter:image" content="${ogImage}" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #fff; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; text-align: center; }
    h1 { font-size: 2rem; margin-bottom: 1rem; color: #ff8c00; }
    p { max-width: 500px; line-height: 1.6; margin-bottom: 1.5rem; color: rgba(255,255,255,0.9); }
    a { color: #ff8c00; text-decoration: none; font-weight: 600; padding: 0.5rem 1rem; border: 2px solid #ff8c00; border-radius: 8px; display: inline-block; margin-top: 1rem; }
    a:hover { background: rgba(255,140,0,0.2); }
  </style>
</head>
<body>
  <h1>SpacetimeDB Auth Demo</h1>
  <p>An end-to-end authentication demo using OIDC, Hono, and SpacetimeDB.</p>
  <p>Includes sign in, token exchange, token refresh, and password reset flows.</p>
  <a href="https://github.com/SeloSlav/spacetimedb-openauthjs">GitHub</a>
</body>
</html>
    `);
  });

  // --- CORS Middleware ---
  app.use('*', cors({
      origin: (origin) => {
        if (!origin) return undefined;
        return isTrustedOrigin(origin) ? origin : undefined;
      },
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
  }));

  // --- OIDC Discovery Endpoint --- 
  app.get('/.well-known/openid-configuration', (c) => {
      console.log('[OIDC Discovery] Serving configuration');
      return c.json({
          issuer: ISSUER_URL,
          authorization_endpoint: `${ISSUER_URL}/authorize`,
          token_endpoint: `${ISSUER_URL}/token`,
          revocation_endpoint: `${ISSUER_URL}/revoke`,
          jwks_uri: `${ISSUER_URL}/.well-known/jwks.json`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          claims_supported: ["iss", "sub", "aud", "iat", "exp", "email", "email_verified", "account_active"],
      });
  });

  // --- JWKS Endpoint --- 
  app.get('/.well-known/jwks.json', (c) => {
      console.log('[JWKS] Serving JWKS endpoint');
      const publicJWK = getPublicJWK();
      return c.json({ 
          keys: [
              {
                  ...publicJWK,
                  kid: keyId,
                  use: 'sig',
                  alg: 'RS256'
              }
          ]
      });
  });

  // --- Custom Authorize Interceptor --- 
  app.get('/authorize', (c) => {
      const query = c.req.query();
      const acrValues = query['acr_values'];

      if (acrValues === 'pwd') {
          const clientId = query['client_id'] || '';
          const redirectUri = decodeRedirectUri(query['redirect_uri'] || '');
          const codeChallenge = query['code_challenge'] || '';
          const codeChallengeMethod = query['code_challenge_method'] || '';
          if (query['response_type'] !== 'code' || !isValidAuthorizationRequest(clientId, redirectUri, codeChallenge, codeChallengeMethod)) {
              return c.json({ error: 'invalid_request' }, 400);
          }
          console.log('[AuthServer] Intercepting /authorize for password flow (acr_values=pwd). Redirecting to /auth/password/login');
          
          const loginUrl = new URL('/auth/password/login', ISSUER_URL); 
          Object.keys(query).forEach(key => {
              loginUrl.searchParams.set(key, query[key]);
          });
          
          return c.redirect(loginUrl.toString(), 302);
      }
      return c.json({ error: 'invalid_request' }, 400);
  });

  // --- Manual Password Routes --- 
  app.get('/auth/password/register', (c) => {
    const query = c.req.query();
    const queryString = Object.entries(query)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    
    const redirect_uri = query['redirect_uri'] || '';
    const state = query['state'] || '';
    const code_challenge = query['code_challenge'] || '';
    const code_challenge_method = query['code_challenge_method'] || 'S256';
    const client_id = query['client_id'] || CLIENT_ID; 

    return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        ${renderAuthPageHead('Create Account - SpacetimeDB Auth Demo')}
    </head>
    <body>
        <div class="container">
            <div class="game-title">
                <span style="font-size: 24px; font-weight: 700; color: white;">SpacetimeDB Auth Demo</span>
            </div>
            
            <h1 class="form-title">Create Account</h1>
            
            <form method="post">
                <input type="hidden" name="redirect_uri" value="${escapeHtml(encodeURIComponent(redirect_uri))}">
                <input type="hidden" name="state" value="${escapeHtml(state)}">
                <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}">
                <input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method)}">
                <input type="hidden" name="client_id" value="${escapeHtml(client_id)}">
                
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <input id="email" name="email" type="email" autocomplete="email" required placeholder="Enter your email">
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <input id="password" name="password" type="password" autocomplete="new-password" required minlength="15" maxlength="128" placeholder="Use at least 15 characters">
                </div>
                
                <button type="submit" class="submit-button">Create Account</button>
            </form>
            
            <div class="divider"></div>
            
            <p class="form-link">Already have an account? <a href="/auth/password/login?${queryString}">Sign In</a></p>
        </div>
    </body>
    </html>
    `);
  });

  app.post('/auth/password/register', async (c) => {
    const originError = rejectUntrustedBrowserOrigin(c, true);
    if (originError) return originError;
    if (!consumeRateLimit(c, 'register-ip', clientRateLimitKey(c), 10, 60 * 60 * 1000)) {
      return c.html(renderStatusPage({
        title: 'Please Slow Down',
        message: 'Too many registration attempts. Please try again later.',
        error: true,
      }), 429);
    }

    const form = await c.req.formData();
    const emailEntry = form.get('email');
    const passwordEntry = form.get('password');
    const email = typeof emailEntry === 'string' ? normalizeEmail(emailEntry) : null;
    const password = typeof passwordEntry === 'string' ? passwordEntry : null;
    const redirect_uri_from_form = form.get('redirect_uri') as string | undefined;
    const state = form.get('state') as string | undefined;
    const code_challenge = form.get('code_challenge') as string | undefined;
    const code_challenge_method = form.get('code_challenge_method') as string | undefined;
    const client_id = form.get('client_id') as string | undefined;

    if (!email || !password || !redirect_uri_from_form || !code_challenge || !code_challenge_method || !client_id) {
         return c.text('Invalid registration request.', 400);
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return c.html(renderStatusPage({
        title: 'Choose a Stronger Password',
        message: passwordError,
        returnTo: `/auth/password/register?redirect_uri=${encodeURIComponent(redirect_uri_from_form)}&state=${encodeURIComponent(state ?? '')}&code_challenge=${encodeURIComponent(code_challenge)}&code_challenge_method=${encodeURIComponent(code_challenge_method)}&client_id=${encodeURIComponent(client_id)}`,
        actionLabel: 'Return to Sign In',
        error: true,
      }), 400);
    }
    if (!consumeRateLimit(c, 'register-account', privacyKey(email), 3, 60 * 60 * 1000)) {
      return c.html(renderStatusPage({
        title: emailFeaturesEnabled(config.emailMode) ? 'Check Your Inbox' : 'Registration Processed',
        message: emailFeaturesEnabled(config.emailMode)
          ? 'If this address can be registered, verification instructions will arrive shortly.'
          : 'If this address was available, the account is ready to sign in.',
      }));
    }

    const redirect_uri = decodeRedirectUri(redirect_uri_from_form);
    if (!isValidAuthorizationRequest(client_id, redirect_uri, code_challenge, code_challenge_method)) {
        return c.text('Invalid authorization request.', 400);
    }

    const loginReturnTo = `/auth/password/login?redirect_uri=${encodeURIComponent(redirect_uri_from_form)}&state=${encodeURIComponent(state ?? '')}&code_challenge=${encodeURIComponent(code_challenge)}&code_challenge_method=${encodeURIComponent(code_challenge_method)}&client_id=${encodeURIComponent(client_id)}`;
    const userResult = await _handlePasswordRegisterSimple(email, password);

    if (emailFeaturesEnabled(config.emailMode) && userResult) {
      void issueEmailVerification(userResult, loginReturnTo)
        .catch((error) => console.error('[EmailVerification] Failed to send verification email:', error));
    }

    if (!emailFeaturesEnabled(config.emailMode)) {
      return c.redirect(loginReturnTo, 303);
    }

    // The response deliberately does not reveal whether the address already exists.
    return c.html(renderStatusPage({
      title: 'Check Your Inbox',
      message: 'If this address can be registered, verification instructions will arrive shortly.',
      returnTo: loginReturnTo,
    }));
  });

  app.get('/auth/password/login', (c) => {
    const query = c.req.query();
    const queryString = Object.entries(query)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    
    const redirect_uri = query['redirect_uri'] || '';
    const state = query['state'] || '';
    const code_challenge = query['code_challenge'] || '';
    const code_challenge_method = query['code_challenge_method'] || 'S256';
    const client_id = query['client_id'] || CLIENT_ID; 

    return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        ${renderAuthPageHead('Sign In - SpacetimeDB Auth Demo')}
    </head>
    <body>
        <div class="container">
            <div class="game-title">
                <span style="font-size: 24px; font-weight: 700; color: white;">SpacetimeDB Auth Demo</span>
            </div>
            
            <h1 class="form-title">Sign In</h1>
            
            <form method="post">
                <input type="hidden" name="redirect_uri" value="${escapeHtml(encodeURIComponent(redirect_uri))}">
                <input type="hidden" name="state" value="${escapeHtml(state)}">
                <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}">
                <input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method)}">
                <input type="hidden" name="client_id" value="${escapeHtml(client_id)}">
                
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <input id="email" name="email" type="email" autocomplete="email" required placeholder="Enter your email">
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="128" placeholder="Enter your password">
                </div>
                
                <button type="submit" class="submit-button">Sign In</button>
                
                ${renderEmailHelpLinks(`/auth/password/login?${queryString}`)}
            </form>
            
            <div class="divider"></div>
            
            <p class="form-link">Don't have an account? <a href="/auth/password/register?${queryString}">Create Account</a></p>
        </div>
    </body>
    </html>
    `);
  });

  app.post('/auth/password/login', async (c) => {
      const originError = rejectUntrustedBrowserOrigin(c, true);
      if (originError) return originError;
      if (!consumeRateLimit(c, 'login-ip', clientRateLimitKey(c), 30, 15 * 60 * 1000)) {
          return c.html(renderStatusPage({
            title: 'Please Slow Down',
            message: 'Too many sign-in attempts. Please wait before trying again.',
            error: true,
          }), 429);
      }

      const form = await c.req.formData();
      const emailEntry = form.get('email');
      const passwordEntry = form.get('password');
      const email = typeof emailEntry === 'string' ? normalizeEmail(emailEntry) : null;
      const password = typeof passwordEntry === 'string' ? passwordEntry : null;
      const redirect_uri_from_form = form.get('redirect_uri') as string | undefined;
      const state = form.get('state') as string | undefined;
      const code_challenge = form.get('code_challenge') as string | undefined;
      const code_challenge_method = form.get('code_challenge_method') as string | undefined;
      const client_id = form.get('client_id') as string | undefined;

      if (!email || !password || !redirect_uri_from_form || !code_challenge || !code_challenge_method || !client_id) {
           return c.text('Missing required form fields.', 400);
      }
      const accountLimitKey = privacyKey(email);
      if (!consumeRateLimit(c, 'login-account', accountLimitKey, 10, 15 * 60 * 1000)) {
          return c.html(renderStatusPage({
            title: 'Please Slow Down',
            message: 'Too many sign-in attempts. Please wait before trying again.',
            error: true,
          }), 429);
      }

      const redirect_uri = decodeRedirectUri(redirect_uri_from_form);
      if (!isValidAuthorizationRequest(client_id, redirect_uri, code_challenge, code_challenge_method)) {
          return c.text('Invalid authorization request.', 400);
      }

      const userResult = await _handlePasswordLoginSimple(email, password);

      if (userResult) {
          rateLimiter.reset(`login-account:${accountLimitKey}`);
          const userId = userResult.id;
          const code = uuidv4();
          await db.storeAuthCode(code, { userId, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method, clientId: client_id, redirectUri: redirect_uri });
          try {
              const redirect = new URL(redirect_uri);
              redirect.searchParams.set('code', code);
              if (state) redirect.searchParams.set('state', state);
              console.log('[AuthServer] Password login succeeded; returning an authorization code.');
              return c.redirect(redirect.toString(), 302);
          } catch (e) {
              console.error('[AuthServer] POST Login: Failed to construct redirect URL with double-decoded URI:', redirect_uri, e);
              return c.text('Invalid redirect URI provided.', 500);
          }
      } else {
          const query = { redirect_uri: redirect_uri_from_form, state, code_challenge, code_challenge_method, client_id };
          const queryString = Object.entries(query)
              .filter(([, value]) => value != null)
              .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
              .join('&');
              
          return c.html(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                ${renderAuthPageHead('Sign In - SpacetimeDB Auth Demo')}
            </head>
            <body>
                <div class="container">
                    <div class="game-title">
                        <span style="font-size: 24px; font-weight: 700; color: white;">SpacetimeDB Auth Demo</span>
                    </div>
                    <h1 class="form-title">Sign In</h1>
                    <p class="error-message">Invalid email or password. Please try again.</p>
                    <form method="post">
                        <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri_from_form)}">
                        <input type="hidden" name="state" value="${escapeHtml(state || '')}">
                        <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}">
                        <input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method)}">
                        <input type="hidden" name="client_id" value="${escapeHtml(client_id)}">
                        <div class="form-group">
                            <label for="email">Email Address</label>
                            <input id="email" name="email" type="email" value="${escapeHtml(email || '')}" required placeholder="Enter your email">
                        </div>
                        <div class="form-group">
                            <label for="password">Password</label>
                            <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="128" placeholder="Enter your password">
                        </div>
                        <button type="submit" class="submit-button">Sign In</button>
                        
                        ${renderEmailHelpLinks(`/auth/password/login?${queryString}`)}
                    </form>
                    <div class="divider"></div>
                    <p class="form-link">Don't have an account? <a href="/auth/password/register?${queryString}">Create Account</a></p>
                </div>
            </body>
            </html>
          `);
      }
  });

  app.get('/auth/password/verify-email', async (c) => {
    const returnTo = sanitizeReturnTo(c.req.query('return_to'));
    if (!emailFeaturesEnabled(config.emailMode)) {
      return c.html(renderStatusPage({
        title: 'Email Verification Disabled',
        message: 'This server does not require email ownership verification.',
        returnTo,
      }), 404);
    }
    if (!consumeRateLimit(c, 'verify-email-ip', clientRateLimitKey(c), 30, 15 * 60 * 1000)) {
      return c.html(renderStatusPage({
        title: 'Please Slow Down',
        message: 'Too many verification attempts. Please try again later.',
        returnTo,
        error: true,
      }), 429);
    }

    const token = c.req.query('token');
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
      return c.html(renderStatusPage({
        title: 'Invalid Verification Link',
        message: 'Request a fresh verification email and try again.',
        returnTo,
        error: true,
      }), 400);
    }

    const result = await db.consumeEmailVerificationToken(token);
    if (result.status !== 'verified') {
      return c.html(renderStatusPage({
        title: 'Verification Link Unavailable',
        message: 'This verification link is invalid, expired, or has already been used.',
        returnTo,
        error: true,
      }), 400);
    }

    return c.html(renderStatusPage({
      title: 'Email Verified',
      message: 'Your email is verified. You can now sign in.',
      returnTo,
    }));
  });

  app.get('/auth/password/resend-verification', (c) => {
    const returnTo = sanitizeReturnTo(c.req.query('return_to'));
    if (!emailFeaturesEnabled(config.emailMode)) {
      return c.html(renderStatusPage({
        title: 'Email Verification Disabled',
        message: 'This server does not require email ownership verification.',
        returnTo,
      }), 404);
    }
    return c.html(renderVerificationRequestPage({ returnTo }));
  });

  app.post('/auth/password/resend-verification', async (c) => {
    if (!emailFeaturesEnabled(config.emailMode)) {
      return c.html(renderStatusPage({
        title: 'Email Verification Disabled',
        message: 'This server does not require email ownership verification.',
      }), 404);
    }
    const originError = rejectUntrustedBrowserOrigin(c, true);
    if (originError) return originError;
    const form = await c.req.formData();
    const emailEntry = form.get('email');
    const email = typeof emailEntry === 'string' ? normalizeEmail(emailEntry) : null;
    const returnTo = sanitizeReturnTo(form.get('return_to') as string | undefined);
    const genericMessage = 'If this account still needs verification, a new link will arrive shortly.';

    if (
      !email
      || !consumeRateLimit(c, 'verify-resend-ip', clientRateLimitKey(c), 20, 60 * 60 * 1000)
      || !consumeRateLimit(c, 'verify-resend-account', privacyKey(email ?? 'invalid'), 3, 60 * 60 * 1000)
    ) {
      return c.html(renderVerificationRequestPage({ success: genericMessage, returnTo }));
    }

    const user = await db.getUserByEmail(email);
    if (user && !user.emailVerified) {
      void issueEmailVerification({ id: user.userId, email: user.email }, returnTo)
        .catch((error) => console.error('[EmailVerification] Failed to resend verification email:', error));
    }
    return c.html(renderVerificationRequestPage({ success: genericMessage, returnTo }));
  });

  // --- Forgot Password Flow ---
  app.get('/auth/password/forgot', (c) => {
    const returnTo = sanitizeReturnTo(c.req.query('return_to'));
    if (!emailFeaturesEnabled(config.emailMode)) {
      return c.html(renderStatusPage({
        title: 'Password Recovery Disabled',
        message: 'This server has no email recovery channel. Contact the server administrator if you lose access.',
        returnTo,
        error: true,
      }), 404);
    }
    return c.html(renderForgotPasswordPage({ returnTo }));
  });

  app.post('/auth/password/forgot', async (c) => {
    if (!emailFeaturesEnabled(config.emailMode)) {
      return c.html(renderStatusPage({
        title: 'Password Recovery Disabled',
        message: 'This server has no email recovery channel. Contact the server administrator if you lose access.',
        error: true,
      }), 404);
    }
    const originError = rejectUntrustedBrowserOrigin(c, true);
    if (originError) return originError;
    const form = await c.req.formData();
    const emailEntry = form.get('email');
    const email = typeof emailEntry === 'string' ? normalizeEmail(emailEntry) : null;
    const returnTo = sanitizeReturnTo(form.get('return_to') as string | undefined);
    const successHtml = renderForgotPasswordPage({ 
      success: 'If an account with that email exists, we\'ve sent a password reset link. Please check your inbox and spam folder.',
      returnTo
    });
    if (
      !email
      || !consumeRateLimit(c, 'forgot-ip', clientRateLimitKey(c), 20, 60 * 60 * 1000)
      || !consumeRateLimit(c, 'forgot-account', privacyKey(email ?? 'invalid'), 3, 60 * 60 * 1000)
    ) return c.html(successHtml);

    const user = await db.getUserByEmail(email);
    if (user?.emailVerified) {
      void (async () => {
        try {
          const token = crypto.randomBytes(32).toString('hex');
          const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);
          await db.storePasswordResetToken(token, user.userId, email, expiresAt);
          const resetLink = `${ISSUER_URL}/auth/password/reset?token=${token}&return_to=${encodeURIComponent(returnTo)}`;

          if (config.emailMode === 'console') {
            console.log(`[ForgotPassword] DEV MODE - reset link: ${resetLink}`);
            return;
          }
          await resend!.emails.send({
            from: resendFrom,
            to: email,
            subject: 'Reset your SpacetimeDB Auth Demo password',
            html: `
              <!DOCTYPE html>
              <html>
              <body style="font-family:system-ui,-apple-system,sans-serif;background:#1a1a2e;color:#fff;padding:40px 20px">
                <div style="max-width:500px;margin:0 auto;background:#28283c;border-radius:16px;padding:40px">
                  <h1 style="color:#ff8c00">Reset Your Password</h1>
                  <p>Use the link below to set a new password.</p>
                  <a href="${resetLink}" style="display:inline-block;background:#e67700;color:#fff;padding:14px 24px;text-decoration:none;border-radius:10px">Reset Password</a>
                  <p style="opacity:.65;font-size:13px">This link expires in ${PASSWORD_RESET_EXPIRY_MINUTES} minutes.</p>
                </div>
              </body>
              </html>`,
          });
        } catch (error) {
          console.error('[ForgotPassword] Failed to create or send reset email:', error);
        }
      })();
    }
    return c.html(successHtml);
  });

  app.get('/auth/password/reset', async (c) => {
    const token = c.req.query('token');
    const returnTo = sanitizeReturnTo(c.req.query('return_to'));

    if (!emailFeaturesEnabled(config.emailMode)) {
      return c.html(renderStatusPage({
        title: 'Password Recovery Disabled',
        message: 'This server has no email recovery channel. Contact the server administrator if you lose access.',
        returnTo,
        error: true,
      }), 404);
    }

    if (
      !consumeRateLimit(c, 'reset-view-ip', clientRateLimitKey(c), 40, 15 * 60 * 1000)
      || !token
      || !/^[a-f0-9]{64}$/i.test(token)
    ) {
      return c.html(renderResetPasswordPage({ error: 'Invalid or missing reset token.', returnTo }));
    }

    const resetToken = await db.getPasswordResetToken(token);
    if (!resetToken || resetToken.used || new Date() > resetToken.expiresAt) {
      return c.html(renderResetPasswordPage({ error: 'This reset link is invalid, expired, or already used.', returnTo }));
    }

    return c.html(renderResetPasswordPage({ token, email: resetToken.email, returnTo }));
  });

  app.post('/auth/password/reset', async (c) => {
    if (!emailFeaturesEnabled(config.emailMode)) {
      return c.html(renderStatusPage({
        title: 'Password Recovery Disabled',
        message: 'This server has no email recovery channel. Contact the server administrator if you lose access.',
        error: true,
      }), 404);
    }
    const originError = rejectUntrustedBrowserOrigin(c, true);
    if (originError) return originError;
    if (!consumeRateLimit(c, 'reset-submit-ip', clientRateLimitKey(c), 20, 15 * 60 * 1000)) {
      return c.html(renderResetPasswordPage({ error: 'Too many reset attempts. Please try again later.' }), 429);
    }
    const form = await c.req.formData();
    const tokenEntry = form.get('token');
    const passwordEntry = form.get('password');
    const confirmEntry = form.get('confirm_password');
    const token = typeof tokenEntry === 'string' ? tokenEntry : '';
    const returnTo = sanitizeReturnTo(form.get('return_to') as string | undefined);
    const password = typeof passwordEntry === 'string' ? passwordEntry : '';
    const confirmPassword = typeof confirmEntry === 'string' ? confirmEntry : '';

    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return c.html(renderResetPasswordPage({ error: 'Invalid reset token.', returnTo }));
    }

    // Validate token
    const resetToken = await db.getPasswordResetToken(token);
    
    if (!resetToken || resetToken.used || new Date() > resetToken.expiresAt) {
      return c.html(renderResetPasswordPage({ error: 'Invalid or expired reset link. Please request a new one.', returnTo }));
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return c.html(renderResetPasswordPage({ 
        token, 
        email: resetToken.email, 
        error: passwordError,
        returnTo
      }));
    }

    if (password !== confirmPassword) {
      return c.html(renderResetPasswordPage({ 
        token, 
        email: resetToken.email, 
        error: 'Passwords do not match.',
        returnTo
      }));
    }

    const result = await db.resetPasswordWithToken(token, await hashPassword(password));
    if (result.status !== 'reset') {
      return c.html(renderResetPasswordPage({ 
        error: 'This reset link is invalid, expired, or already used.',
        returnTo
      }));
    }

    clearRefreshTokenCookie(c);
    console.log(`[ResetPassword] Password reset and all refresh sessions revoked for user: ${result.userId}`);
    if (config.emailMode === 'resend') {
      void resend!.emails.send({
        from: resendFrom,
        to: result.email,
        subject: 'Your SpacetimeDB Auth Demo password was changed',
        text: 'Your password was reset and all existing sessions were revoked. If this was not you, contact the application operator immediately.',
      }).catch((error) => console.error('[ResetPassword] Failed to send confirmation email:', error));
    }

    return c.html(renderStatusPage({
      title: 'Password Reset Successful',
      message: 'Your password was updated and all existing sessions were revoked.',
      returnTo,
    }));
  });

  // Token endpoint - Supports authorization_code and refresh_token grants
  app.post('/token', async c => {
    const originError = rejectUntrustedBrowserOrigin(c);
    if (originError) return originError;
    if (!consumeRateLimit(c, 'token-ip', clientRateLimitKey(c), 120, 15 * 60 * 1000)) {
      return c.json({ error: 'temporarily_unavailable' }, 429);
    }

    const form = await c.req.formData();
    const grantType = form.get('grant_type');
    const clientIdForm = form.get('client_id');

    if (clientIdForm !== CLIENT_ID) {
      return c.json({ error: 'invalid_client' }, 400);
    }

    // --- Refresh token grant ---
    if (grantType === 'refresh_token') {
      const refreshToken = readRefreshToken(c, form.get('refresh_token'));
      if (!refreshToken) {
        clearRefreshTokenCookie(c);
        return c.json({ error: 'invalid_grant' }, 400);
      }

      const newRefreshToken = crypto.randomBytes(48).toString('base64url');
      const newIdleExpiry = new Date(Date.now() + REFRESH_TOKEN_IDLE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const rotation = await db.rotateRefreshToken(refreshToken, clientIdForm, newRefreshToken, newIdleExpiry);
      if (rotation.status !== 'rotated') {
        clearRefreshTokenCookie(c);
        if (rotation.status === 'reused') {
          console.warn('[Token Endpoint] Refresh-token reuse detected; token family revoked.');
        }
        return c.json({ error: 'invalid_grant' }, 400);
      }

      const user = await db.getUserById(rotation.record.userId);
      if (!user || !canAuthenticate(config.emailMode, user.emailVerified)) {
        await db.revokeRefreshTokensForUser(rotation.record.userId);
        clearRefreshTokenCookie(c);
        return c.json({ error: 'invalid_grant' }, 400);
      }
      const tokens = issueSignedTokens(user, clientIdForm);
      setRefreshTokenCookie(c, newRefreshToken, rotation.record.absoluteExpiresAt);
      return c.json({
        access_token: tokens.accessToken,
        id_token: tokens.idToken,
        token_type: 'Bearer',
        expires_in: tokens.expiresInSeconds,
      });
    }

    // --- Authorization code grant ---
    if (grantType !== 'authorization_code') {
      return c.json({ error: 'unsupported_grant_type' }, 400);
    }

    const code = form.get('code');
    const redirectUriForm = form.get('redirect_uri');
    const codeVerifier = form.get('code_verifier');

    if (
      typeof code !== 'string'
      || typeof codeVerifier !== 'string'
      || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)
    ) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const codeData = await db.consumeAuthCode(code);
    if (!codeData) {
      return c.json({ error: 'invalid_grant' }, 400);
    }

    if (codeData.codeChallengeMethod !== 'S256') return c.json({ error: 'invalid_grant' }, 400);
    const calculatedChallenge = Buffer.from(
      crypto.createHash('sha256').update(codeVerifier).digest()
    ).toString('base64url');

    if (calculatedChallenge !== codeData.codeChallenge) {
      return c.json({ error: 'invalid_grant' }, 400);
    }

    if (clientIdForm !== codeData.clientId) {
      return c.json({ error: 'invalid_grant' }, 400);
    }

    const redirectUri = typeof redirectUriForm === 'string' ? decodeRedirectUri(redirectUriForm) : null;
    if (!redirectUri || redirectUri !== codeData.redirectUri) {
      return c.json({ error: 'invalid_grant' }, 400);
    }

    const userId = codeData.userId;
    const user = await db.getUserById(userId);
    if (!user || !canAuthenticate(config.emailMode, user.emailVerified)) {
      return c.json({ error: 'invalid_grant' }, 400);
    }

    const tokens = issueSignedTokens(user, clientIdForm);
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const familyId = crypto.randomUUID();
    const idleExpiresAt = new Date(Date.now() + REFRESH_TOKEN_IDLE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const absoluteExpiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await db.storeRefreshToken(
      refreshToken,
      familyId,
      userId,
      clientIdForm,
      idleExpiresAt,
      absoluteExpiresAt
    );
    setRefreshTokenCookie(c, refreshToken, absoluteExpiresAt);

    return c.json({
      access_token: tokens.accessToken,
      id_token: tokens.idToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresInSeconds,
    });
  });

  // Revoke endpoint - invalidate the entire refresh-token family.
  app.post('/revoke', async c => {
    const originError = rejectUntrustedBrowserOrigin(c);
    if (originError) return originError;
    if (!consumeRateLimit(c, 'revoke-ip', clientRateLimitKey(c), 120, 15 * 60 * 1000)) {
      return c.json({ error: 'temporarily_unavailable' }, 429);
    }
    const form = await c.req.formData();
    const token = readRefreshToken(c, form.get('token'));
    if (token) await db.revokeRefreshTokenFamily(token);
    clearRefreshTokenCookie(c);
    return c.json({});
  });

  app.get('/health', c => c.text('OK'));

  // Serve client SPA (when running in Docker/Railway with client-dist)
  const clientDist = path.join(process.cwd(), 'client-dist');
  if (fs.existsSync(clientDist)) {
    app.use('/*', async (c, next) => {
      const url = new URL(c.req.url);
      const p = url.pathname === '/' ? '/index.html' : url.pathname;
      const safePath = path.normalize(p.replace(/^\//, '')).replace(/^(\.\.(\/|$))+/g, '');
      const filePath = path.join(clientDist, safePath);
      if (!filePath.startsWith(path.resolve(clientDist))) {
        return next();
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const types: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.ico': 'image/x-icon',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.woff2': 'font/woff2',
        };
        const contentType = types[ext] || 'application/octet-stream';
        const buf = fs.readFileSync(filePath);
        return new Response(new Uint8Array(buf), {
          headers: { 'Content-Type': contentType, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000' },
        });
      }
      // SPA fallback
      const indexHtml = path.join(clientDist, 'index.html');
      if (fs.existsSync(indexHtml)) {
        const buf = fs.readFileSync(indexHtml);
        return new Response(new Uint8Array(buf), {
          headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
        });
      }
      return next();
    });
    console.log('[Static] Serving client SPA from client-dist');
  }

  console.log(`🚀 Auth server → ${ISSUER_URL}`);
  serve({ fetch: app.fetch, port: PORT });
})();
