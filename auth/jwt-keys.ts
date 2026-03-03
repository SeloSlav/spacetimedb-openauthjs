import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as jose from 'jose';

let privateKey: string;
let jwksPublicKey: jose.KeyLike;
let jwksPublicJWK: jose.JWK;
export const keyId = 'auth-server-signing-key';

const DEV_KEYS_PATH = path.join(process.cwd(), '.dev-jwt-keys.json');

interface DevKeysFile {
  privateKey: string;
  publicKey: string;
}

export async function initializeKeys(): Promise<void> {
  const privateKeyEnv = process.env.JWT_PRIVATE_KEY;
  const publicKeyEnv = process.env.JWT_PUBLIC_KEY;

  if (privateKeyEnv && publicKeyEnv) {
    console.log('[Keys] Using environment variables for JWT keys');
    privateKey = privateKeyEnv.replace(/\\n/g, '\n');
    const publicKeyPem = publicKeyEnv.replace(/\\n/g, '\n');
    jwksPublicKey = await jose.importSPKI(publicKeyPem, 'RS256');
    jwksPublicJWK = await jose.exportJWK(jwksPublicKey);
    console.log('[Keys] JWT keys loaded from environment');
    return;
  }

  // Development: Use persisted keys or generate new ones
  try {
    const data = fs.readFileSync(DEV_KEYS_PATH, 'utf8');
    const parsed = JSON.parse(data) as DevKeysFile;
    if (parsed.privateKey && parsed.publicKey) {
      privateKey = parsed.privateKey.replace(/\\n/g, '\n');
      const publicKeyPem = parsed.publicKey.replace(/\\n/g, '\n');
      jwksPublicKey = await jose.importSPKI(publicKeyPem, 'RS256');
      jwksPublicJWK = await jose.exportJWK(jwksPublicKey);
      console.log('[Keys] Loaded persisted dev keys (tokens survive auth server restarts)');
      return;
    }
  } catch {
    // File missing or invalid; generate new keys
  }

  console.log('[Keys] Generating RSA key pair for development');
  console.warn('⚠️  Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY for production');
  const { publicKey: pubKey, privateKey: privKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = privKey;
  jwksPublicKey = await jose.importSPKI(pubKey, 'RS256');
  jwksPublicJWK = await jose.exportJWK(jwksPublicKey);

  try {
    fs.writeFileSync(
      DEV_KEYS_PATH,
      JSON.stringify(
        { privateKey: privKey, publicKey: pubKey },
        null,
        2
      ),
      { mode: 0o600 }
    );
    console.log('[Keys] Dev keys persisted to .dev-jwt-keys.json');
  } catch (err) {
    console.warn('[Keys] Could not persist dev keys:', err);
  }
}

export function getPrivateKey(): string {
  if (!privateKey) {
    throw new Error('JWT keys not initialized. Call initializeKeys() first.');
  }
  return privateKey;
}

export function getPublicJWK(): jose.JWK {
  if (!jwksPublicJWK) {
    throw new Error('JWT keys not initialized. Call initializeKeys() first.');
  }
  return jwksPublicJWK;
} 