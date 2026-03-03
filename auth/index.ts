// index.ts - Updated for production deployment
/**
 * OpenAuth issuer + Hono server with password UI and custom OIDC code/token flow.
 * Now using database storage and environment-based JWT keys.
 */
import dotenv from 'dotenv';

// Load environment variables from .env file in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Environment-based configuration
const config = {
  isDevelopment: process.env.NODE_ENV !== 'production',
  port: parseInt(process.env.PORT || '4001'),
  issuerUrl: process.env.ISSUER_URL || process.env.RAILWAY_STATIC_URL || 'http://localhost:4001',
  databaseUrl: process.env.DATABASE_URL,
  jwtPrivateKey: process.env.JWT_PRIVATE_KEY,
  jwtPublicKey: process.env.JWT_PUBLIC_KEY,
  saltRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),
};

console.log(`[Config] Environment: ${config.isDevelopment ? 'development' : 'production'}`);
console.log(`[Config] Port: ${config.port}`);
console.log(`[Config] Issuer URL: ${config.issuerUrl}`);
console.log(`[Config] Database: ${config.databaseUrl ? 'PostgreSQL' : 'In-memory'}`);

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { issuer } from '@openauthjs/openauth';
import { PasswordProvider } from '@openauthjs/openauth/provider/password';
import { PasswordUI } from '@openauthjs/openauth/ui/password';
import { MemoryStorage } from '@openauthjs/openauth/storage/memory';
import { Select } from '@openauthjs/openauth/ui/select';
import { subjects } from './subjects.js';

import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Buffer } from 'buffer'; // Needed for PKCE base64
import crypto from 'crypto'; // Needed for PKCE hash
import { cors } from 'hono/cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Import our new modules
import { db, type UserRecord, type AuthCodeData, type PasswordResetToken } from './database.js';
import { initializeKeys, getPrivateKey, getPublicJWK, keyId } from './jwt-keys.js';
import { Resend } from 'resend';

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */
const PORT        = config.port;
const ISSUER_URL  = config.issuerUrl;
const SALT_ROUNDS = config.saltRounds;
const CLIENT_ID   = 'vibe-survival-game-client';
const PASSWORD_RESET_EXPIRY_MINUTES = 15;
const ACCESS_TOKEN_EXPIRY_HOURS = 4;
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
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

// Initialize Resend for email sending
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const resendFrom = process.env.RESEND_FROM || 'SpacetimeDB Auth Demo <noreply@example.com>';

if (!resendApiKey) {
  console.warn('[Config] RESEND_API_KEY not set - password reset emails will be logged to console only');
} else {
  console.log('[Config] Resend email service configured');
}

/* -------------------------------------------------------------------------- */
/* Core Password Logic Handlers (Updated for database)                       */
/* -------------------------------------------------------------------------- */

async function _handlePasswordRegisterSimple(email: string, password?: string): Promise<{ id: string; email: string } | null> {
  email = email.toLowerCase();
  const existing = await db.getUserByEmail(email);
  if (existing) {
    console.warn(`[RegisterHandler] Email already taken: ${email}`);
    return null; 
  }
  if (!password) {
    console.error(`[RegisterHandler] Password missing for: ${email}`);
    return null;
  }
  const userId = uuidv4();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const newUser: UserRecord = { userId, email, passwordHash };
  const success = await db.createUser(newUser);
  if (!success) {
    console.warn(`[RegisterHandler] Failed to create user: ${email}`);
    return null;
  }
  console.info(`[RegisterHandler] New user registered: ${email} -> ${userId}`);
  return { id: userId, email };
}

async function _handlePasswordLoginSimple(email: string, password?: string): Promise<{ id: string; email: string } | null> {
  email = email.toLowerCase();
  const user = await db.getUserByEmail(email);
  if (!user || !password) {
    console.warn(`[LoginHandler] User not found or password missing for: ${email}`);
    return null;
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    console.warn(`[LoginHandler] Incorrect password for: ${email}`);
    return null;
  }
  console.info(`[LoginHandler] User logged in: ${email} -> ${user.userId}`);
  return { id: user.userId, email };
}

async function _handlePasswordChangeSimple(userId: string, newPassword?: string): Promise<boolean> {
  if (!newPassword) return false;
  const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const success = await db.updateUserPassword(userId, newPasswordHash);
  if (success) {
    console.info(`[ChangeHandler] Password changed for userId: ${userId}`);
  }
  return success;
}

// Placeholder sendCode function
async function handlePasswordSendCode(email: string, code: string): Promise<void> { 
  console.info(`[SendCodeHandler] Code for ${email}: ${code} (Manual Flow)`);
}

/* -------------------------------------------------------------------------- */
/* Provider Handler Wrappers (Match expected signatures)                      */
/* -------------------------------------------------------------------------- */

async function handlePasswordRegister(ctx: any, state: any, form?: FormData): Promise<Response> {
    const email = form?.get('email') as string | undefined;
    const password = form?.get('password') as string | undefined;
    if (!email || !password) {
        return ctx.fail ? ctx.fail({ error: 'invalid_request' }) : new Response('Missing email or password', { status: 400 });
    }
    const result = await _handlePasswordRegisterSimple(email, password);
    if (!result) {
        return ctx.fail ? ctx.fail({ error: 'registration_failed' }) : new Response('Registration failed', { status: 400 });
    }
    return ctx.success ? ctx.success({ user: result }) : new Response(JSON.stringify(result), { status: 200 });
}

async function handlePasswordLogin(ctx: any, form?: FormData): Promise<Response> {
    const email = form?.get('email') as string | undefined;
    const password = form?.get('password') as string | undefined;
     if (!email || !password) {
        return ctx.fail ? ctx.fail({ error: 'invalid_request' }) : new Response('Missing email or password', { status: 400 });
    }
    const result = await _handlePasswordLoginSimple(email, password);
    if (!result) {
        return ctx.fail ? ctx.fail({ error: 'invalid_credentials' }) : new Response('Login failed', { status: 401 });
    }
    return ctx.success ? ctx.success({ user: result }) : new Response(JSON.stringify(result), { status: 200 });
}

async function handlePasswordChange(ctx: any, state: any, form?: FormData): Promise<Response> {
    const userId = state?.userId;
    const newPassword = form?.get('password') as string | undefined;
    if (!userId || !newPassword) {
       return ctx.fail ? ctx.fail({ error: 'invalid_request' }) : new Response('Missing user context or new password', { status: 400 });
    }
    const success = await _handlePasswordChangeSimple(userId, newPassword);
    if (!success) {
        return ctx.fail ? ctx.fail({ error: 'change_failed' }) : new Response('Password change failed', { status: 400 });
    }
    return ctx.success ? ctx.success({}) : new Response('Password changed', { status: 200 }); 
}

/* -------------------------------------------------------------------------- */
/* Provider Setup                                                             */
/* -------------------------------------------------------------------------- */
const password = PasswordProvider({
  register: handlePasswordRegister,
  login: handlePasswordLogin,
  change: handlePasswordChange,
  sendCode: handlePasswordSendCode,
});

/* -------------------------------------------------------------------------- */
/* Success callback                                                           */
/* -------------------------------------------------------------------------- */
async function success(ctx: any, value: any): Promise<Response> { 
  console.log("[IssuerSuccess] Flow completed. Provider:", value?.provider, "Value:", value);
  if (ctx && ctx.res) {
      return ctx.res;
  }
  return new Response('Issuer Success OK', { status: 200 });
}

/* -------------------------------------------------------------------------- */
/* Helper Functions for Password Reset Pages                                   */
/* -------------------------------------------------------------------------- */
function renderAuthPageHead(title: string): string {
  return `
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="icon" type="image/png" href="/favicon.png">
      <title>${title}</title>
      <link rel="stylesheet" href="/theme/uiTheme.css">
      <link rel="stylesheet" href="/theme/authPages.css">
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
          <p class="form-description">Enter a new password for <strong>${email}</strong></p>
          <form method="post">
              <input type="hidden" name="token" value="${token}">
              <input type="hidden" name="return_to" value="${safeReturnTo}">
              <div class="form-group">
                  <label for="password">New Password</label>
                  <input id="password" name="password" type="password" autocomplete="new-password" required placeholder="Enter new password" minlength="6">
              </div>
              <div class="form-group">
                  <label for="confirm_password">Confirm Password</label>
                  <input id="confirm_password" name="confirm_password" type="password" autocomplete="new-password" required placeholder="Confirm new password" minlength="6">
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

/* -------------------------------------------------------------------------- */
/* Server                                                                     */
/* -------------------------------------------------------------------------- */
(async () => {
  // Initialize database and keys
  await db.init();
  await initializeKeys();

  const storage = MemoryStorage();
  const auth = issuer({ 
    providers: { password }, 
    subjects, 
    storage, 
    success,
  });
  const app  = new Hono();

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
    } catch (error) {
      return c.text('Not found', 404);
    }
  });

  // --- Static File Serving for login_background.jpg ---
  app.get('/login_background.jpg', async (c) => {
    try {
      const imagePath = path.join(process.cwd(), 'login_background.jpg');
      const imageBuffer = fs.readFileSync(imagePath);
      c.header('Content-Type', 'image/jpeg');
      c.header('Cache-Control', 'public, max-age=3600');
      return c.body(imageBuffer);
    } catch (error) {
      console.error('[Static] Failed to serve login_background.jpg:', error);
      return c.text('Image not found', 404);
    }
  });

  // --- Also serve at the wrong path to fix current issue ---
  app.get('/auth/password/login_background.jpg', async (c) => {
    try {
      const imagePath = path.join(process.cwd(), 'login_background.jpg');
      const imageBuffer = fs.readFileSync(imagePath);
      c.header('Content-Type', 'image/jpeg');
      c.header('Cache-Control', 'public, max-age=3600');
      return c.body(imageBuffer);
    } catch (error) {
      console.error('[Static] Failed to serve login_background.jpg:', error);
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
  <title>SpacetimeDB Auth Demo - OpenAuth + SpacetimeDB</title>
  <meta name="description" content="SpacetimeDB Auth Demo shows a complete OpenAuth + SpacetimeDB authentication flow with login, token issuance, refresh, and password reset." />
  <meta name="keywords" content="SpacetimeDB, OpenAuth, OIDC, authentication demo, token refresh, password reset, realtime" />
  <meta name="author" content="SpacetimeDB Auth Demo" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${baseUrl}/document" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="SpacetimeDB Auth Demo - OpenAuth + SpacetimeDB" />
  <meta property="og:description" content="An authentication demo that integrates OpenAuth (OIDC) with SpacetimeDB for realtime applications." />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:url" content="${baseUrl}/document" />
  <meta property="og:site_name" content="SpacetimeDB Auth Demo" />
  <meta property="og:locale" content="en_US" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="SpacetimeDB Auth Demo - OpenAuth + SpacetimeDB" />
  <meta name="twitter:description" content="OpenAuth + SpacetimeDB authentication demo." />
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
  <p>An end-to-end authentication demo using OpenAuth, Hono, and SpacetimeDB.</p>
  <p>Includes sign in, token exchange, token refresh, and password reset flows.</p>
  <a href="https://github.com/SeloSlav/spacetimedb-openauthjs">GitHub</a>
</body>
</html>
    `);
  });

  // --- CORS Middleware --- 
  // Allow localhost and 127.0.0.1 on any port for local dev
  app.use('*', cors({ 
      origin: (origin) => {
        if (!origin) return 'http://localhost:5173';
        try {
          const u = new URL(origin);
          if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:') return origin;
        } catch { /* ignore */ }
        return 'http://localhost:5173';
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
  app.get('/authorize', async (c, next) => {
      const query = c.req.query();
      const acrValues = query['acr_values'];

      if (acrValues === 'pwd') {
          console.log('[AuthServer] Intercepting /authorize for password flow (acr_values=pwd). Redirecting to /auth/password/login');
          
          const loginUrl = new URL('/auth/password/login', ISSUER_URL); 
          Object.keys(query).forEach(key => {
              loginUrl.searchParams.set(key, query[key]);
          });
          
          return c.redirect(loginUrl.toString(), 302);
      } else {
          console.log('[AuthServer] /authorize request is not for password flow (acr_values != \'pwd\') or acr_values missing. Passing to issuer.');
          await next(); 
          if (!c.res.bodyUsed) {
              console.warn('[AuthServer] /authorize interceptor: next() called but no response generated. Potential issue with issuer routing.');
          }
      }
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
                <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri)}">
                <input type="hidden" name="state" value="${state || ''}">
                <input type="hidden" name="code_challenge" value="${code_challenge}">
                <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                <input type="hidden" name="client_id" value="${client_id}">
                
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <input id="email" name="email" type="email" autocomplete="email" required placeholder="Enter your email">
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <input id="password" name="password" type="password" autocomplete="new-password" required placeholder="Create a password">
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
    const form = await c.req.formData();
    const email = form.get('email') as string | undefined;
    const password = form.get('password') as string | undefined;
    const redirect_uri_from_form = form.get('redirect_uri') as string | undefined;
    const state = form.get('state') as string | undefined;
    const code_challenge = form.get('code_challenge') as string | undefined;
    const code_challenge_method = form.get('code_challenge_method') as string | undefined;
    const client_id = form.get('client_id') as string | undefined;

    if (!email || !password || !redirect_uri_from_form || !code_challenge || !code_challenge_method || !client_id) {
         console.error('[AuthServer] POST Register: Missing form data.');
         return c.text('Missing required form fields.', 400);
    }

    const userResult = await _handlePasswordRegisterSimple(email, password);

    if (userResult) {
        const userId = userResult.id;
        const code = uuidv4();
        let redirect_uri: string;
        try {
            const decoded_once = decodeURIComponent(redirect_uri_from_form);
            redirect_uri = decodeURIComponent(decoded_once);
            console.log(`[AuthServer] POST Register: Decoded redirect_uri: ${redirect_uri}`);
        } catch (e) {
            console.error('[AuthServer] POST Register: Failed to double-decode redirect_uri:', redirect_uri_from_form, e);
            return c.text('Invalid redirect URI encoding.', 400);
        }
        await db.storeAuthCode(code, { userId, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method, clientId: client_id, redirectUri: redirect_uri });
        try {
            const redirect = new URL(redirect_uri);
            redirect.searchParams.set('code', code);
            if (state) redirect.searchParams.set('state', state);
            console.log(`[AuthServer] POST Register Success: Redirecting to ${redirect.toString()}`);
            return c.redirect(redirect.toString(), 302);
        } catch (e) {
            console.error('[AuthServer] POST Register: Failed to construct redirect URL with double-decoded URI:', redirect_uri, e);
            return c.text('Invalid redirect URI provided.', 500);
        }
    } else {
        console.warn(`[AuthServer] POST Register Failed for email: ${email} (Email likely taken)`);
        // Return error page with form
        return c.html(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="icon" type="image/png" href="/favicon.png">
            <title>Create Account - SpacetimeDB Auth Demo</title>
            <link rel="stylesheet" href="/theme/uiTheme.css">
            <link rel="stylesheet" href="/theme/authPages.css">
        </head>
        <body>
            <div class="container">
                <div class="game-title">
                    <span>SpacetimeDB Auth Demo</span>
                </div>
                <h1 class="form-title">Create Account</h1>
                <p class="error-message">Registration failed. That email might already be taken.</p>
                <form method="post">
                     <input type="hidden" name="redirect_uri" value="${redirect_uri_from_form}">
                     <input type="hidden" name="state" value="${state || ''}">
                     <input type="hidden" name="code_challenge" value="${code_challenge}">
                     <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                     <input type="hidden" name="client_id" value="${client_id}">
                     <div class="form-group"><label for="email">Email Address</label><input id="email" name="email" type="email" value="${email || ''}" required></div>
                     <div class="form-group"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password" required></div>
                     <button type="submit" class="submit-button">Create Account</button>
                </form>
                <div class="divider"></div>
                <p class="form-link">Already have an account? <a href="/auth/password/login">Sign In</a></p>
            </div>
        </body>
        </html>
        `);
    }
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
                <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri)}">
                <input type="hidden" name="state" value="${state || ''}">
                <input type="hidden" name="code_challenge" value="${code_challenge}">
                <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                <input type="hidden" name="client_id" value="${client_id}">
                
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <input id="email" name="email" type="email" autocomplete="email" required placeholder="Enter your email">
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="Enter your password">
                </div>
                
                <button type="submit" class="submit-button">Sign In</button>
                
                <p class="form-link" style="margin-top: -15px; margin-bottom: 0;"><a href="/auth/password/forgot?return_to=${encodeURIComponent(`/auth/password/login?${queryString}`)}">Forgot Password?</a></p>
            </form>
            
            <div class="divider"></div>
            
            <p class="form-link">Don't have an account? <a href="/auth/password/register?${queryString}">Create Account</a></p>
        </div>
    </body>
    </html>
    `);
  });

  app.post('/auth/password/login', async (c) => {
      const form = await c.req.formData();
      const email = form.get('email') as string | undefined;
      const password = form.get('password') as string | undefined;
      const redirect_uri_from_form = form.get('redirect_uri') as string | undefined;
      const state = form.get('state') as string | undefined;
      const code_challenge = form.get('code_challenge') as string | undefined;
      const code_challenge_method = form.get('code_challenge_method') as string | undefined;
      const client_id = form.get('client_id') as string | undefined;

      if (!email || !password || !redirect_uri_from_form || !code_challenge || !code_challenge_method || !client_id) {
           console.error('[AuthServer] POST Login: Missing form data.');
           return c.text('Missing required form fields.', 400);
      }

      const userResult = await _handlePasswordLoginSimple(email, password);

      if (userResult) {
          const userId = userResult.id;
          const code = uuidv4();
          let redirect_uri: string;
          try {
              const decoded_once = decodeURIComponent(redirect_uri_from_form);
              redirect_uri = decodeURIComponent(decoded_once);
              console.log(`[AuthServer] POST Login: Decoded redirect_uri: ${redirect_uri}`);
          } catch (e) {
              console.error('[AuthServer] POST Login: Failed to double-decode redirect_uri:', redirect_uri_from_form, e);
              return c.text('Invalid redirect URI encoding.', 400);
          }
          await db.storeAuthCode(code, { userId, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method, clientId: client_id, redirectUri: redirect_uri });
          try {
              const redirect = new URL(redirect_uri);
              redirect.searchParams.set('code', code);
              if (state) redirect.searchParams.set('state', state);
              console.log(`[AuthServer] POST Login Success: Redirecting to ${redirect.toString()}`);
              return c.redirect(redirect.toString(), 302);
          } catch (e) {
              console.error('[AuthServer] POST Login: Failed to construct redirect URL with double-decoded URI:', redirect_uri, e);
              return c.text('Invalid redirect URI provided.', 500);
          }
      } else {
          console.warn(`[AuthServer] POST Login Failed for email: ${email}`);
          const query = { redirect_uri: redirect_uri_from_form, state, code_challenge, code_challenge_method, client_id };
          const queryString = Object.entries(query)
              .filter(([_, value]) => value != null)
              .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
              .join('&');
              
          return c.html(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link rel="icon" type="image/png" href="/favicon.png">
                <title>Sign In - SpacetimeDB Auth Demo</title>
                <link rel="stylesheet" href="/theme/uiTheme.css">
                <link rel="stylesheet" href="/theme/authPages.css">
            </head>
            <body>
                <div class="container">
                    <div class="game-title">
                        <span style="font-size: 24px; font-weight: 700; color: white;">SpacetimeDB Auth Demo</span>
                    </div>
                    <h1 class="form-title">Sign In</h1>
                    <p class="error-message">Invalid email or password. Please try again.</p>
                    <form method="post">
                        <input type="hidden" name="redirect_uri" value="${redirect_uri_from_form}">
                        <input type="hidden" name="state" value="${state || ''}">
                        <input type="hidden" name="code_challenge" value="${code_challenge}">
                        <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                        <input type="hidden" name="client_id" value="${client_id}">
                        <div class="form-group">
                            <label for="email">Email Address</label>
                            <input id="email" name="email" type="email" value="${email || ''}" required placeholder="Enter your email">
                        </div>
                        <div class="form-group">
                            <label for="password">Password</label>
                            <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="Enter your password">
                        </div>
                        <button type="submit" class="submit-button">Sign In</button>
                        
                        <p class="form-link" style="margin-top: -15px; margin-bottom: 0;"><a href="/auth/password/forgot?return_to=${encodeURIComponent(`/auth/password/login?${queryString}`)}">Forgot Password?</a></p>
                    </form>
                    <div class="divider"></div>
                    <p class="form-link">Don't have an account? <a href="/auth/password/register?${queryString}">Create Account</a></p>
                </div>
            </body>
            </html>
          `);
      }
  });

  // --- Forgot Password Flow ---
  app.get('/auth/password/forgot', (c) => {
    const returnTo = sanitizeReturnTo(c.req.query('return_to'));
    return c.html(renderForgotPasswordPage({ returnTo }));
  });

  app.post('/auth/password/forgot', async (c) => {
    const form = await c.req.formData();
    const email = (form.get('email') as string)?.toLowerCase()?.trim();
    const returnTo = sanitizeReturnTo(form.get('return_to') as string | undefined);

    if (!email) {
      return c.html(renderForgotPasswordPage({ error: 'Please enter your email address.', returnTo }));
    }

    // Check if user exists
    const user = await db.getUserByEmail(email);
    
    // Always show success message to prevent email enumeration attacks
    const successHtml = renderForgotPasswordPage({ 
      success: 'If an account with that email exists, we\'ve sent a password reset link. Please check your inbox and spam folder.',
      returnTo
    });

    if (!user) {
      console.log(`[ForgotPassword] No user found for email: ${email}`);
      return c.html(successHtml);
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);

    // Store token
    await db.storePasswordResetToken(token, user.userId, email, expiresAt);

    // Build reset link
    const resetLink = `${ISSUER_URL}/auth/password/reset?token=${token}&return_to=${encodeURIComponent(returnTo)}`;

    // Send email
    if (resend) {
      try {
        await resend.emails.send({
          from: resendFrom,
          to: email,
          subject: 'Reset your SpacetimeDB Auth Demo password',
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: system-ui, -apple-system, sans-serif; background-color: #1a1a2e; color: #ffffff; padding: 40px 20px; margin: 0;">
              <div style="max-width: 500px; margin: 0 auto; background: rgba(40, 40, 60, 0.95); border-radius: 16px; padding: 40px; border: 2px solid rgba(255, 140, 0, 0.3);">
                <h1 style="color: #ff8c00; margin-bottom: 20px; font-size: 24px;">Reset Your Password</h1>
                <p style="color: rgba(255, 255, 255, 0.8); line-height: 1.6; margin-bottom: 30px;">
                  You requested a password reset for your SpacetimeDB Auth Demo account. Click the button below to set a new password:
                </p>
                <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #ff8c00 0%, #e67700 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
                  Reset Password
                </a>
                <p style="color: rgba(255, 255, 255, 0.5); font-size: 13px; margin-top: 30px; line-height: 1.5;">
                  This link will expire in ${PASSWORD_RESET_EXPIRY_MINUTES} minutes.<br><br>
                  If you didn't request this reset, you can safely ignore this email.
                </p>
                <hr style="border: none; border-top: 1px solid rgba(255, 255, 255, 0.1); margin: 30px 0;">
                <p style="color: rgba(255, 255, 255, 0.4); font-size: 12px;">
                  SpacetimeDB Auth Demo
                </p>
              </div>
            </body>
            </html>
          `
        });
        console.log(`[ForgotPassword] Reset email sent to: ${email}`);
      } catch (err) {
        console.error('[ForgotPassword] Failed to send email:', err);
        // Still show success to user to prevent enumeration
      }
    } else {
      // Development: Log the reset link to console
      console.log(`[ForgotPassword] DEV MODE - Reset link for ${email}: ${resetLink}`);
    }

    return c.html(successHtml);
  });

  app.get('/auth/password/reset', async (c) => {
    const token = c.req.query('token');
    const returnTo = sanitizeReturnTo(c.req.query('return_to'));

    if (!token) {
      return c.html(renderResetPasswordPage({ error: 'Invalid or missing reset token.', returnTo }));
    }

    // Validate token
    const resetToken = await db.getPasswordResetToken(token);
    
    if (!resetToken) {
      return c.html(renderResetPasswordPage({ error: 'Invalid reset link. Please request a new one.', returnTo }));
    }

    if (resetToken.used) {
      return c.html(renderResetPasswordPage({ error: 'This reset link has already been used. Please request a new one.', returnTo }));
    }

    if (new Date() > resetToken.expiresAt) {
      return c.html(renderResetPasswordPage({ error: 'This reset link has expired. Please request a new one.', returnTo }));
    }

    return c.html(renderResetPasswordPage({ token, email: resetToken.email, returnTo }));
  });

  app.post('/auth/password/reset', async (c) => {
    const form = await c.req.formData();
    const token = form.get('token') as string;
    const returnTo = sanitizeReturnTo(form.get('return_to') as string | undefined);
    const password = form.get('password') as string;
    const confirmPassword = form.get('confirm_password') as string;

    if (!token) {
      return c.html(renderResetPasswordPage({ error: 'Invalid reset token.', returnTo }));
    }

    // Validate token
    const resetToken = await db.getPasswordResetToken(token);
    
    if (!resetToken || resetToken.used || new Date() > resetToken.expiresAt) {
      return c.html(renderResetPasswordPage({ error: 'Invalid or expired reset link. Please request a new one.', returnTo }));
    }

    // Validate password
    if (!password || password.length < 6) {
      return c.html(renderResetPasswordPage({ 
        token, 
        email: resetToken.email, 
        error: 'Password must be at least 6 characters long.',
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

    // Update password
    const newPasswordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const updated = await db.updateUserPassword(resetToken.userId, newPasswordHash);

    if (!updated) {
      return c.html(renderResetPasswordPage({ 
        token, 
        email: resetToken.email, 
        error: 'Failed to update password. Please try again.',
        returnTo
      }));
    }

    // Mark token as used
    await db.markPasswordResetTokenUsed(token);

    console.log(`[ResetPassword] Password successfully reset for user: ${resetToken.userId}`);

    // Show success page
    return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        ${renderAuthPageHead('Password Reset - SpacetimeDB Auth Demo')}
    </head>
    <body>
        <div class="container">
            <div class="game-title">
                <span style="font-size: 24px; font-weight: 700; color: white;">SpacetimeDB Auth Demo</span>
            </div>
            <div class="success-icon">✓</div>
            <h1 class="form-title">Password Reset Successful!</h1>
            <p class="form-description">Your password has been successfully updated. You can now sign in with your new password.</p>
            <a href="${escapeHtml(returnTo)}" class="submit-button">Sign In</a>
        </div>
    </body>
    </html>
    `);
  });

  // Token endpoint - Supports authorization_code and refresh_token grants
  app.post('/token', async c => {
    const form = await c.req.formData();
    const grantType = form.get('grant_type');
    const clientIdForm = form.get('client_id');

    if (typeof clientIdForm !== 'string') {
      return c.text('invalid_request', 400);
    }

    // --- Refresh token grant ---
    if (grantType === 'refresh_token') {
      const refreshToken = form.get('refresh_token');
      if (typeof refreshToken !== 'string') {
        return c.text('invalid_request', 400);
      }

      const rtRecord = await db.getRefreshToken(refreshToken);
      if (!rtRecord) {
        console.error('[AuthServer] /token: Refresh token not found or expired.');
        return c.text('invalid_grant', 400);
      }
      if (rtRecord.clientId !== clientIdForm) {
        console.error('[AuthServer] /token: Client ID mismatch on refresh.');
        return c.text('invalid_grant', 400);
      }

      // Rotate: delete used refresh token
      await db.deleteRefreshToken(refreshToken);

      const userId = rtRecord.userId;
      const user = await db.getUserById(userId);
      const userEmail = user?.email;

      const payload = {
        iss: ISSUER_URL,
        sub: userId,
        aud: clientIdForm,
        iat: Math.floor(Date.now() / 1000),
        email: userEmail,
      };

      const signOptions: jwt.SignOptions = {
        algorithm: 'RS256',
        expiresIn: `${ACCESS_TOKEN_EXPIRY_HOURS}h`,
        keyid: keyId,
      };

      const privateKey = getPrivateKey();
      const idToken = jwt.sign(payload, privateKey, signOptions);
      const accessToken = idToken;
      const expiresInSeconds = ACCESS_TOKEN_EXPIRY_HOURS * 60 * 60;

      // Issue new refresh token (rotation)
      const newRefreshToken = crypto.randomBytes(48).toString('base64url');
      const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      await db.storeRefreshToken(newRefreshToken, userId, clientIdForm, refreshExpiresAt);

      console.log('[Token Endpoint] Refresh token used, new tokens issued for user:', userId);

      return c.json({
        access_token: accessToken,
        id_token: idToken,
        refresh_token: newRefreshToken,
        token_type: 'Bearer',
        expires_in: expiresInSeconds,
      });
    }

    // --- Authorization code grant ---
    if (grantType !== 'authorization_code') {
      return c.text('invalid_request', 400);
    }

    const code = form.get('code');
    const redirectUriForm = form.get('redirect_uri');
    const codeVerifier = form.get('code_verifier');

    if (typeof code !== 'string' || typeof codeVerifier !== 'string') {
      return c.text('invalid_request', 400);
    }

    const codeData = await db.getAuthCode(code);
    if (!codeData) {
      console.error(`[AuthServer] /token: Code ${code} not found.`);
      return c.text('invalid_grant', 400);
    }

    let calculatedChallenge: string;
    if (codeData.codeChallengeMethod === 'S256') {
      const hash = crypto.createHash('sha256').update(codeVerifier).digest();
      calculatedChallenge = Buffer.from(hash).toString('base64url');
    } else {
      calculatedChallenge = codeVerifier;
      if (codeData.codeChallengeMethod !== 'plain') {
        console.error(`[AuthServer] /token: Unsupported code_challenge_method: ${codeData.codeChallengeMethod}`);
        return c.text('invalid_request', 400);
      }
    }

    if (calculatedChallenge !== codeData.codeChallenge) {
      console.error(`[AuthServer] /token: PKCE verification failed.`);
      await db.deleteAuthCode(code);
      return c.text('invalid_grant', 400);
    }

    if (clientIdForm !== codeData.clientId) {
      console.error(`[AuthServer] /token: Client ID mismatch.`);
      await db.deleteAuthCode(code);
      return c.text('invalid_grant', 400);
    }

    const redirectUri = typeof redirectUriForm === 'string' ? redirectUriForm : '';
    if (redirectUri && redirectUri !== codeData.redirectUri) {
      console.error(`[AuthServer] /token: redirect_uri mismatch.`);
      await db.deleteAuthCode(code);
      return c.text('invalid_grant', 400);
    }

    const userId = codeData.userId;
    await db.deleteAuthCode(code);

    const user = await db.getUserById(userId);
    const userEmail = user?.email;

    const payload = {
      iss: ISSUER_URL,
      sub: userId,
      aud: clientIdForm,
      iat: Math.floor(Date.now() / 1000),
      email: userEmail,
    };

    const signOptions: jwt.SignOptions = {
      algorithm: 'RS256',
      expiresIn: `${ACCESS_TOKEN_EXPIRY_HOURS}h`,
      keyid: keyId,
    };

    const privateKey = getPrivateKey();
    const idToken = jwt.sign(payload, privateKey, signOptions);
    const accessToken = idToken;
    const expiresInSeconds = ACCESS_TOKEN_EXPIRY_HOURS * 60 * 60;

    // Issue refresh token
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await db.storeRefreshToken(refreshToken, userId, clientIdForm, refreshExpiresAt);

    console.log('[Token Endpoint] Code verified. Tokens issued for user:', userId);

    return c.json({
      access_token: accessToken,
      id_token: idToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: expiresInSeconds,
    });
  });

  // Revoke endpoint - invalidate refresh token (e.g. on logout)
  app.post('/revoke', async c => {
    const form = await c.req.formData();
    const token = form.get('token');
    const tokenTypeHint = form.get('token_type_hint');
    if (typeof token !== 'string') {
      return c.json({ error: 'invalid_request' }, 400);
    }
    if (tokenTypeHint === 'refresh_token') {
      await db.deleteRefreshToken(token);
      console.log('[Revoke] Refresh token revoked');
    }
    return c.json({});
  });

  // Mount the OpenAuth issuer routes
  app.route('/', auth);
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