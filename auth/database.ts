import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { hashOpaqueToken } from './security.js';

export interface UserRecord {
  userId: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
}

export interface AuthCodeData {
  userId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  clientId: string;
  redirectUri: string;
}

export interface PasswordResetToken {
  tokenHash: string;
  userId: string;
  email: string;
  expiresAt: Date;
  used: boolean;
}

export interface RefreshTokenRecord {
  tokenHash: string;
  familyId: string;
  userId: string;
  clientId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  used: boolean;
  revoked: boolean;
}

export type RefreshRotationResult =
  | { status: 'rotated'; record: RefreshTokenRecord }
  | { status: 'invalid' | 'expired' | 'reused' };

export type PasswordResetResult =
  | { status: 'reset'; userId: string; email: string }
  | { status: 'invalid' | 'expired' | 'used' };

export type EmailVerificationResult =
  | { status: 'verified'; user: UserRecord }
  | { status: 'invalid' | 'expired' | 'used' };

interface JsonResetToken {
  tokenHash: string;
  userId: string;
  email: string;
  expiresAt: number;
  used: boolean;
}

interface JsonRefreshToken {
  tokenHash: string;
  familyId: string;
  userId: string;
  clientId: string;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  used: boolean;
  revoked: boolean;
}

interface JsonVerificationToken {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  used: boolean;
}

interface JsonStorage {
  users: UserRecord[];
  resetTokens: JsonResetToken[];
  refreshTokens: JsonRefreshToken[];
  emailVerificationTokens: JsonVerificationToken[];
}

interface MemoryAuthCode {
  data: AuthCodeData;
  expiresAt: number;
}

const AUTH_CODE_EXPIRY_MS = 10 * 60 * 1000;

class DatabaseService {
  private sql: postgres.Sql | null = null;
  private readonly jsonFilePath = path.join(process.cwd(), 'users.json');
  private readonly memoryCodes = new Map<string, MemoryAuthCode>();
  private isPostgres = false;

  async init(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    const isProduction = process.env.NODE_ENV === 'production';

    if (databaseUrl) {
      console.log('[Database] Using PostgreSQL');
      this.sql = postgres(databaseUrl, { max: 10 });
      this.isPostgres = true;
      await this.createTables();
      return;
    }

    if (isProduction) {
      throw new Error('DATABASE_URL is required in production.');
    }

    console.log('[Database] Using protected JSON storage for development');
    this.isPostgres = false;
    this.initJsonStorage();
  }

  private emptyJsonStorage(): JsonStorage {
    return {
      users: [],
      resetTokens: [],
      refreshTokens: [],
      emailVerificationTokens: [],
    };
  }

  private migrateJsonStorage(raw: unknown): JsonStorage {
    const source = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const rawUsers = Array.isArray(source.users) ? source.users as Array<Record<string, unknown>> : [];
    const rawResetTokens = Array.isArray(source.resetTokens) ? source.resetTokens as Array<Record<string, unknown>> : [];
    const rawRefreshTokens = Array.isArray(source.refreshTokens) ? source.refreshTokens as Array<Record<string, unknown>> : [];
    const rawVerificationTokens = Array.isArray(source.emailVerificationTokens)
      ? source.emailVerificationTokens as Array<Record<string, unknown>>
      : [];

    return {
      users: rawUsers
        .filter((user) => typeof user.userId === 'string' && typeof user.email === 'string' && typeof user.passwordHash === 'string')
        .map((user) => ({
          userId: user.userId as string,
          email: user.email as string,
          passwordHash: user.passwordHash as string,
          // Existing development accounts predate verification and remain usable.
          emailVerified: typeof user.emailVerified === 'boolean' ? user.emailVerified : true,
        })),
      resetTokens: rawResetTokens
        .filter((token) => (
          (typeof token.tokenHash === 'string' || typeof token.token === 'string')
          && typeof token.userId === 'string'
          && typeof token.email === 'string'
          && typeof token.expiresAt === 'number'
        ))
        .map((token) => ({
          tokenHash: typeof token.tokenHash === 'string'
            ? token.tokenHash
            : hashOpaqueToken(token.token as string),
          userId: token.userId as string,
          email: token.email as string,
          expiresAt: token.expiresAt as number,
          used: token.used === true,
        })),
      refreshTokens: rawRefreshTokens
        .filter((token) => (
          (typeof token.tokenHash === 'string' || typeof token.token === 'string')
          && typeof token.userId === 'string'
          && typeof token.clientId === 'string'
        ))
        .map((token) => {
          const legacyExpiry = typeof token.expiresAt === 'number' ? token.expiresAt : Date.now();
          return {
            tokenHash: typeof token.tokenHash === 'string'
              ? token.tokenHash
              : hashOpaqueToken(token.token as string),
            familyId: typeof token.familyId === 'string' ? token.familyId : crypto.randomUUID(),
            userId: token.userId as string,
            clientId: token.clientId as string,
            idleExpiresAt: typeof token.idleExpiresAt === 'number' ? token.idleExpiresAt : legacyExpiry,
            absoluteExpiresAt: typeof token.absoluteExpiresAt === 'number' ? token.absoluteExpiresAt : legacyExpiry,
            used: token.used === true,
            revoked: token.revoked === true,
          };
        }),
      emailVerificationTokens: rawVerificationTokens
        .filter((token) => (
          typeof token.tokenHash === 'string'
          && typeof token.userId === 'string'
          && typeof token.expiresAt === 'number'
        ))
        .map((token) => ({
          tokenHash: token.tokenHash as string,
          userId: token.userId as string,
          expiresAt: token.expiresAt as number,
          used: token.used === true,
        })),
    };
  }

  private initJsonStorage(): void {
    if (!fs.existsSync(this.jsonFilePath)) {
      this.writeJsonStorage(this.emptyJsonStorage());
      console.log('[Database] Created protected users.json file');
      return;
    }

    const migrated = this.readJsonStorage();
    this.writeJsonStorage(migrated);
    console.log('[Database] Loaded and migrated users.json');
  }

  private readJsonStorage(): JsonStorage {
    try {
      return this.migrateJsonStorage(JSON.parse(fs.readFileSync(this.jsonFilePath, 'utf8')));
    } catch (error) {
      throw new Error(`Failed to read development auth database: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private writeJsonStorage(data: JsonStorage): void {
    const tempPath = `${this.jsonFilePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tempPath, this.jsonFilePath);
    try {
      fs.chmodSync(this.jsonFilePath, 0o600);
    } catch {
      // Windows does not implement Unix file modes, but the file remains local development data.
    }
  }

  private async createTables(): Promise<void> {
    if (!this.sql) return;

    await this.sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    // Existing accounts are grandfathered as verified; new accounts default to unverified.
    await this.sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE`;
    await this.sql`ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT FALSE`;

    await this.sql`
      CREATE TABLE IF NOT EXISTS auth_codes (
        code VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method VARCHAR(10) NOT NULL,
        client_id VARCHAR(255) NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '10 minutes')
      )
    `;
    await this.sql`ALTER TABLE auth_codes ALTER COLUMN code TYPE VARCHAR(64)`;
    await this.sql`DELETE FROM auth_codes WHERE code !~ '^[0-9a-f]{64}$'`;

    await this.sql`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL REFERENCES users(user_id),
        email VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        token VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL REFERENCES users(user_id),
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token VARCHAR(128) PRIMARY KEY,
        family_id VARCHAR(36),
        user_id VARCHAR(36) NOT NULL REFERENCES users(user_id),
        client_id VARCHAR(255) NOT NULL,
        idle_expires_at TIMESTAMP,
        absolute_expires_at TIMESTAMP,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        revoked BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at TIMESTAMP
      )
    `;
    await this.sql`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS family_id VARCHAR(36)`;
    await this.sql`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS idle_expires_at TIMESTAMP`;
    await this.sql`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMP`;
    await this.sql`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS used BOOLEAN NOT NULL DEFAULT FALSE`;
    await this.sql`ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked BOOLEAN NOT NULL DEFAULT FALSE`;
    await this.sql`ALTER TABLE refresh_tokens ALTER COLUMN expires_at DROP NOT NULL`;
    // Legacy refresh tokens were stored in plaintext. Invalidate them instead
    // of carrying plaintext bearer credentials into the hardened schema.
    await this.sql`
      DELETE FROM refresh_tokens
      WHERE family_id IS NULL
        OR idle_expires_at IS NULL
        OR absolute_expires_at IS NULL
        OR token !~ '^[0-9a-f]{64}$'
    `;
    await this.sql`ALTER TABLE refresh_tokens ALTER COLUMN family_id SET NOT NULL`;
    await this.sql`ALTER TABLE refresh_tokens ALTER COLUMN idle_expires_at SET NOT NULL`;
    await this.sql`ALTER TABLE refresh_tokens ALTER COLUMN absolute_expires_at SET NOT NULL`;

    await this.sql`CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens(family_id)`;
    await this.sql`CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id)`;
    await this.sql`CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens(user_id)`;
    await this.sql`CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens(user_id)`;

    await this.sql`DELETE FROM auth_codes WHERE expires_at < CURRENT_TIMESTAMP`;
    await this.sql`DELETE FROM password_reset_tokens WHERE expires_at < CURRENT_TIMESTAMP`;
    await this.sql`DELETE FROM email_verification_tokens WHERE expires_at < CURRENT_TIMESTAMP`;
    await this.sql`DELETE FROM refresh_tokens WHERE absolute_expires_at < CURRENT_TIMESTAMP`;
  }

  async createUser(user: UserRecord): Promise<boolean> {
    if (this.isPostgres && this.sql) {
      try {
        await this.sql`
          INSERT INTO users (user_id, email, password_hash, email_verified)
          VALUES (${user.userId}, ${user.email}, ${user.passwordHash}, ${user.emailVerified})
        `;
        return true;
      } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return false;
        throw error;
      }
    }

    const storage = this.readJsonStorage();
    if (storage.users.some((candidate) => candidate.email === user.email)) return false;
    storage.users.push(user);
    this.writeJsonStorage(storage);
    return true;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    if (this.isPostgres && this.sql) {
      const result = await this.sql`
        SELECT user_id, email, password_hash, email_verified
        FROM users
        WHERE email = ${email}
      `;
      return result[0] ? {
        userId: result[0].user_id,
        email: result[0].email,
        passwordHash: result[0].password_hash,
        emailVerified: result[0].email_verified,
      } : null;
    }

    return this.readJsonStorage().users.find((user) => user.email === email) ?? null;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    if (this.isPostgres && this.sql) {
      const result = await this.sql`
        SELECT user_id, email, password_hash, email_verified
        FROM users
        WHERE user_id = ${userId}
      `;
      return result[0] ? {
        userId: result[0].user_id,
        email: result[0].email,
        passwordHash: result[0].password_hash,
        emailVerified: result[0].email_verified,
      } : null;
    }

    return this.readJsonStorage().users.find((user) => user.userId === userId) ?? null;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<boolean> {
    if (this.isPostgres && this.sql) {
      const result = await this.sql`
        UPDATE users SET password_hash = ${passwordHash} WHERE user_id = ${userId}
      `;
      return result.count > 0;
    }

    const storage = this.readJsonStorage();
    const user = storage.users.find((candidate) => candidate.userId === userId);
    if (!user) return false;
    user.passwordHash = passwordHash;
    this.writeJsonStorage(storage);
    return true;
  }

  async storeAuthCode(code: string, data: AuthCodeData): Promise<void> {
    const codeHash = hashOpaqueToken(code);
    if (this.isPostgres && this.sql) {
      await this.sql`
        INSERT INTO auth_codes (code, user_id, code_challenge, code_challenge_method, client_id, redirect_uri)
        VALUES (${codeHash}, ${data.userId}, ${data.codeChallenge}, ${data.codeChallengeMethod}, ${data.clientId}, ${data.redirectUri})
      `;
      return;
    }

    this.memoryCodes.set(codeHash, { data, expiresAt: Date.now() + AUTH_CODE_EXPIRY_MS });
  }

  async consumeAuthCode(code: string): Promise<AuthCodeData | null> {
    const codeHash = hashOpaqueToken(code);
    if (this.isPostgres && this.sql) {
      const result = await this.sql`
        DELETE FROM auth_codes
        WHERE code = ${codeHash} AND expires_at > CURRENT_TIMESTAMP
        RETURNING user_id, code_challenge, code_challenge_method, client_id, redirect_uri
      `;
      return result[0] ? {
        userId: result[0].user_id,
        codeChallenge: result[0].code_challenge,
        codeChallengeMethod: result[0].code_challenge_method,
        clientId: result[0].client_id,
        redirectUri: result[0].redirect_uri,
      } : null;
    }

    const stored = this.memoryCodes.get(codeHash);
    this.memoryCodes.delete(codeHash);
    if (!stored || stored.expiresAt <= Date.now()) return null;
    return stored.data;
  }

  async storePasswordResetToken(token: string, userId: string, email: string, expiresAt: Date): Promise<void> {
    const tokenHash = hashOpaqueToken(token);
    if (this.isPostgres && this.sql) {
      await this.sql.begin(async (sql) => {
        await sql`SELECT user_id FROM users WHERE user_id = ${userId} FOR UPDATE`;
        await sql`UPDATE password_reset_tokens SET used = TRUE WHERE user_id = ${userId} AND used = FALSE`;
        await sql`
          INSERT INTO password_reset_tokens (token, user_id, email, expires_at, used)
          VALUES (${tokenHash}, ${userId}, ${email}, ${expiresAt}, FALSE)
        `;
      });
      return;
    }

    const storage = this.readJsonStorage();
    for (const existing of storage.resetTokens) {
      if (existing.userId === userId) existing.used = true;
    }
    storage.resetTokens.push({ tokenHash, userId, email, expiresAt: expiresAt.getTime(), used: false });
    this.writeJsonStorage(storage);
  }

  async getPasswordResetToken(token: string): Promise<PasswordResetToken | null> {
    const tokenHash = hashOpaqueToken(token);
    if (this.isPostgres && this.sql) {
      const result = await this.sql`
        SELECT token, user_id, email, expires_at, used
        FROM password_reset_tokens
        WHERE token = ${tokenHash}
      `;
      return result[0] ? {
        tokenHash: result[0].token,
        userId: result[0].user_id,
        email: result[0].email,
        expiresAt: new Date(result[0].expires_at),
        used: result[0].used,
      } : null;
    }

    const found = this.readJsonStorage().resetTokens.find((candidate) => candidate.tokenHash === tokenHash);
    return found ? {
      tokenHash: found.tokenHash,
      userId: found.userId,
      email: found.email,
      expiresAt: new Date(found.expiresAt),
      used: found.used,
    } : null;
  }

  async resetPasswordWithToken(token: string, passwordHash: string): Promise<PasswordResetResult> {
    const tokenHash = hashOpaqueToken(token);
    if (this.isPostgres && this.sql) {
      return this.sql.begin(async (sql): Promise<PasswordResetResult> => {
        const rows = await sql`
          SELECT token, user_id, email, expires_at, used
          FROM password_reset_tokens
          WHERE token = ${tokenHash}
          FOR UPDATE
        `;
        if (!rows[0]) return { status: 'invalid' };
        if (rows[0].used) return { status: 'used' };
        if (new Date(rows[0].expires_at) <= new Date()) return { status: 'expired' };

        await sql`UPDATE password_reset_tokens SET used = TRUE WHERE token = ${tokenHash}`;
        await sql`UPDATE users SET password_hash = ${passwordHash} WHERE user_id = ${rows[0].user_id}`;
        await sql`UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = ${rows[0].user_id}`;
        return { status: 'reset', userId: rows[0].user_id, email: rows[0].email };
      });
    }

    const storage = this.readJsonStorage();
    const found = storage.resetTokens.find((candidate) => candidate.tokenHash === tokenHash);
    if (!found) return { status: 'invalid' };
    if (found.used) return { status: 'used' };
    if (found.expiresAt <= Date.now()) return { status: 'expired' };
    const user = storage.users.find((candidate) => candidate.userId === found.userId);
    if (!user) return { status: 'invalid' };

    found.used = true;
    user.passwordHash = passwordHash;
    for (const refreshToken of storage.refreshTokens) {
      if (refreshToken.userId === found.userId) refreshToken.revoked = true;
    }
    this.writeJsonStorage(storage);
    return { status: 'reset', userId: found.userId, email: found.email };
  }

  async storeEmailVerificationToken(token: string, userId: string, expiresAt: Date): Promise<void> {
    const tokenHash = hashOpaqueToken(token);
    if (this.isPostgres && this.sql) {
      await this.sql.begin(async (sql) => {
        await sql`SELECT user_id FROM users WHERE user_id = ${userId} FOR UPDATE`;
        await sql`UPDATE email_verification_tokens SET used = TRUE WHERE user_id = ${userId} AND used = FALSE`;
        await sql`
          INSERT INTO email_verification_tokens (token, user_id, expires_at, used)
          VALUES (${tokenHash}, ${userId}, ${expiresAt}, FALSE)
        `;
      });
      return;
    }

    const storage = this.readJsonStorage();
    for (const existing of storage.emailVerificationTokens) {
      if (existing.userId === userId) existing.used = true;
    }
    storage.emailVerificationTokens.push({ tokenHash, userId, expiresAt: expiresAt.getTime(), used: false });
    this.writeJsonStorage(storage);
  }

  async consumeEmailVerificationToken(token: string): Promise<EmailVerificationResult> {
    const tokenHash = hashOpaqueToken(token);
    if (this.isPostgres && this.sql) {
      return this.sql.begin(async (sql): Promise<EmailVerificationResult> => {
        const rows = await sql`
          SELECT token, user_id, expires_at, used
          FROM email_verification_tokens
          WHERE token = ${tokenHash}
          FOR UPDATE
        `;
        if (!rows[0]) return { status: 'invalid' };
        if (rows[0].used) return { status: 'used' };
        if (new Date(rows[0].expires_at) <= new Date()) return { status: 'expired' };

        await sql`UPDATE email_verification_tokens SET used = TRUE WHERE token = ${tokenHash}`;
        const users = await sql`
          UPDATE users SET email_verified = TRUE
          WHERE user_id = ${rows[0].user_id}
          RETURNING user_id, email, password_hash, email_verified
        `;
        if (!users[0]) return { status: 'invalid' };
        return {
          status: 'verified',
          user: {
            userId: users[0].user_id,
            email: users[0].email,
            passwordHash: users[0].password_hash,
            emailVerified: users[0].email_verified,
          },
        };
      });
    }

    const storage = this.readJsonStorage();
    const found = storage.emailVerificationTokens.find((candidate) => candidate.tokenHash === tokenHash);
    if (!found) return { status: 'invalid' };
    if (found.used) return { status: 'used' };
    if (found.expiresAt <= Date.now()) return { status: 'expired' };
    const user = storage.users.find((candidate) => candidate.userId === found.userId);
    if (!user) return { status: 'invalid' };

    found.used = true;
    user.emailVerified = true;
    this.writeJsonStorage(storage);
    return { status: 'verified', user };
  }

  async storeRefreshToken(
    token: string,
    familyId: string,
    userId: string,
    clientId: string,
    idleExpiresAt: Date,
    absoluteExpiresAt: Date
  ): Promise<void> {
    const tokenHash = hashOpaqueToken(token);
    if (this.isPostgres && this.sql) {
      await this.sql`
        INSERT INTO refresh_tokens (
          token, family_id, user_id, client_id, idle_expires_at, absolute_expires_at, used, revoked
        )
        VALUES (
          ${tokenHash}, ${familyId}, ${userId}, ${clientId}, ${idleExpiresAt}, ${absoluteExpiresAt}, FALSE, FALSE
        )
      `;
      return;
    }

    const storage = this.readJsonStorage();
    storage.refreshTokens.push({
      tokenHash,
      familyId,
      userId,
      clientId,
      idleExpiresAt: idleExpiresAt.getTime(),
      absoluteExpiresAt: absoluteExpiresAt.getTime(),
      used: false,
      revoked: false,
    });
    this.writeJsonStorage(storage);
  }

  async rotateRefreshToken(
    token: string,
    clientId: string,
    newToken: string,
    newIdleExpiresAt: Date
  ): Promise<RefreshRotationResult> {
    const tokenHash = hashOpaqueToken(token);
    const newTokenHash = hashOpaqueToken(newToken);

    if (this.isPostgres && this.sql) {
      return this.sql.begin(async (sql): Promise<RefreshRotationResult> => {
        const rows = await sql`
          SELECT token, family_id, user_id, client_id, idle_expires_at, absolute_expires_at, used, revoked
          FROM refresh_tokens
          WHERE token = ${tokenHash}
          FOR UPDATE
        `;
        if (!rows[0] || rows[0].client_id !== clientId) return { status: 'invalid' };

        const row = rows[0];
        if (row.used || row.revoked) {
          await sql`UPDATE refresh_tokens SET revoked = TRUE WHERE family_id = ${row.family_id}`;
          return { status: 'reused' };
        }

        const now = new Date();
        const idleExpiry = new Date(row.idle_expires_at);
        const absoluteExpiry = new Date(row.absolute_expires_at);
        if (idleExpiry <= now || absoluteExpiry <= now) {
          await sql`UPDATE refresh_tokens SET revoked = TRUE WHERE family_id = ${row.family_id}`;
          return { status: 'expired' };
        }

        const cappedIdleExpiry = newIdleExpiresAt < absoluteExpiry ? newIdleExpiresAt : absoluteExpiry;
        await sql`UPDATE refresh_tokens SET used = TRUE WHERE token = ${tokenHash}`;
        await sql`
          INSERT INTO refresh_tokens (
            token, family_id, user_id, client_id, idle_expires_at, absolute_expires_at, used, revoked
          )
          VALUES (
            ${newTokenHash}, ${row.family_id}, ${row.user_id}, ${row.client_id},
            ${cappedIdleExpiry}, ${absoluteExpiry}, FALSE, FALSE
          )
        `;
        return {
          status: 'rotated',
          record: {
            tokenHash: newTokenHash,
            familyId: row.family_id,
            userId: row.user_id,
            clientId: row.client_id,
            idleExpiresAt: cappedIdleExpiry,
            absoluteExpiresAt: absoluteExpiry,
            used: false,
            revoked: false,
          },
        };
      });
    }

    const storage = this.readJsonStorage();
    const found = storage.refreshTokens.find((candidate) => candidate.tokenHash === tokenHash);
    if (!found || found.clientId !== clientId) return { status: 'invalid' };
    if (found.used || found.revoked) {
      for (const related of storage.refreshTokens) {
        if (related.familyId === found.familyId) related.revoked = true;
      }
      this.writeJsonStorage(storage);
      return { status: 'reused' };
    }

    const now = Date.now();
    if (found.idleExpiresAt <= now || found.absoluteExpiresAt <= now) {
      for (const related of storage.refreshTokens) {
        if (related.familyId === found.familyId) related.revoked = true;
      }
      this.writeJsonStorage(storage);
      return { status: 'expired' };
    }

    found.used = true;
    const cappedIdleExpiry = Math.min(newIdleExpiresAt.getTime(), found.absoluteExpiresAt);
    const replacement: JsonRefreshToken = {
      tokenHash: newTokenHash,
      familyId: found.familyId,
      userId: found.userId,
      clientId: found.clientId,
      idleExpiresAt: cappedIdleExpiry,
      absoluteExpiresAt: found.absoluteExpiresAt,
      used: false,
      revoked: false,
    };
    storage.refreshTokens.push(replacement);
    this.writeJsonStorage(storage);
    return {
      status: 'rotated',
      record: {
        ...replacement,
        idleExpiresAt: new Date(replacement.idleExpiresAt),
        absoluteExpiresAt: new Date(replacement.absoluteExpiresAt),
      },
    };
  }

  async revokeRefreshTokenFamily(token: string): Promise<void> {
    const tokenHash = hashOpaqueToken(token);
    if (this.isPostgres && this.sql) {
      await this.sql`
        UPDATE refresh_tokens
        SET revoked = TRUE
        WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token = ${tokenHash})
      `;
      return;
    }

    const storage = this.readJsonStorage();
    const found = storage.refreshTokens.find((candidate) => candidate.tokenHash === tokenHash);
    if (!found) return;
    for (const related of storage.refreshTokens) {
      if (related.familyId === found.familyId) related.revoked = true;
    }
    this.writeJsonStorage(storage);
  }

  async revokeRefreshTokensForUser(userId: string): Promise<void> {
    if (this.isPostgres && this.sql) {
      await this.sql`UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = ${userId}`;
      return;
    }

    const storage = this.readJsonStorage();
    for (const token of storage.refreshTokens) {
      if (token.userId === userId) token.revoked = true;
    }
    this.writeJsonStorage(storage);
  }
}

export const db = new DatabaseService();
