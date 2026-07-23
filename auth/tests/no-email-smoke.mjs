import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function availablePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.equal(typeof address, 'object');
  const port = address.port;
  probe.close();
  await once(probe, 'close');
  return port;
}

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const authDirectory = path.resolve(testDirectory, '..');
const entrypoint = path.join(authDirectory, 'dist', 'index.js');
const tempRoot = path.resolve(os.tmpdir());
const tempDirectory = await mkdtemp(path.join(tempRoot, 'spacetimedb-auth-no-email-'));
assert.equal(path.resolve(tempDirectory).startsWith(`${tempRoot}${path.sep}`), true);

const port = await availablePort();
const issuer = `http://127.0.0.1:${port}`;
const clientOrigin = 'http://localhost:5173';
const clientId = 'vibe-survival-game-client';
const redirectUri = `${clientOrigin}/callback`;
const serverOutput = [];
const server = spawn(process.execPath, [entrypoint], {
  cwd: tempDirectory,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    AUTH_EMAIL_MODE: 'disabled',
    PORT: String(port),
    ISSUER_URL: issuer,
    AUTH_CLIENT_ID: clientId,
    ALLOWED_ORIGINS: clientOrigin,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

try {
  let healthy = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Auth server exited during startup:\n${serverOutput.join('')}`);
    }
    try {
      const response = await fetch(`${issuer}/health`);
      if (response.status === 200) {
        healthy = true;
        break;
      }
    } catch {
      // The server is still starting.
    }
    await delay(100);
  }
  assert.equal(healthy, true, `Auth server did not become healthy:\n${serverOutput.join('')}`);

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(12).toString('hex');
  const email = `no-email-${Date.now()}@example.test`;
  const password = 'A unique smoke-test passphrase 2026!';
  const authFields = {
    email,
    password,
    redirect_uri: encodeURIComponent(redirectUri),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    client_id: clientId,
  };
  const browserHeaders = {
    Origin: clientOrigin,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const registration = await fetch(`${issuer}/auth/password/register`, {
    method: 'POST',
    headers: browserHeaders,
    body: new URLSearchParams(authFields),
    redirect: 'manual',
  });
  assert.equal(registration.status, 303);

  const loginLocation = registration.headers.get('location');
  assert.ok(loginLocation);
  const loginPage = await fetch(new URL(loginLocation, issuer));
  const loginHtml = await loginPage.text();
  assert.equal(loginHtml.includes('Forgot Password?'), false);
  assert.equal(loginHtml.includes('Resend verification email'), false);

  const login = await fetch(`${issuer}/auth/password/login`, {
    method: 'POST',
    headers: browserHeaders,
    body: new URLSearchParams(authFields),
    redirect: 'manual',
  });
  assert.equal(login.status, 302);

  const callback = new URL(login.headers.get('location'));
  assert.equal(callback.searchParams.get('state'), state);
  const code = callback.searchParams.get('code');
  assert.ok(code);

  const tokenResponse = await fetch(`${issuer}/token`, {
    method: 'POST',
    headers: browserHeaders,
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const tokenBody = await tokenResponse.json();
  assert.equal(tokenResponse.status, 200, JSON.stringify(tokenBody));
  assert.equal(Object.hasOwn(tokenBody, 'refresh_token'), false);
  assert.match(tokenResponse.headers.get('set-cookie') ?? '', /HttpOnly/i);

  const payload = JSON.parse(
    Buffer.from(tokenBody.id_token.split('.')[1], 'base64url').toString('utf8'),
  );
  assert.equal(payload.account_active, true);
  assert.equal(payload.email_verified, false);

  const forgotPassword = await fetch(`${issuer}/auth/password/forgot`);
  assert.equal(forgotPassword.status, 404);

  console.log(JSON.stringify({
    registration: registration.status,
    login: login.status,
    token: tokenResponse.status,
    account_active: payload.account_active,
    email_verified: payload.email_verified,
    email_links_hidden: true,
    refresh_cookie_http_only: true,
    forgot_password: forgotPassword.status,
  }, null, 2));
} finally {
  if (server.exitCode === null) {
    server.kill();
    await Promise.race([once(server, 'exit'), delay(2_000)]);
  }
  await rm(tempDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 250,
  });
}
