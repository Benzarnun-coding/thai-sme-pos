/**
 * Token encryption at rest (AES-256-GCM).
 *
 * Tokens obtained through the Connect flow live in the database, so they must
 * never be readable from a database dump alone. The key comes from
 * TOKEN_ENCRYPTION_KEY (32 bytes, base64) and stays in the secret manager.
 *
 * Format: v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
 */
import crypto from 'node:crypto';

const ALG = 'aes-256-gcm';
const PREFIX = 'v1';

let cachedKey: Buffer | null = null;

export function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    // Dev fallback so the flow is testable without a configured secret. Never
    // silently used in production: the server logs a warning at startup.
    if (process.env.NODE_ENV === 'production') throw new Error('TOKEN_ENCRYPTION_KEY is required in production');
    cachedKey = crypto.createHash('sha256').update('loopdesk-dev-key-not-for-production').digest();
    return cachedKey;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`);
  cachedKey = key;
  return cachedKey;
}

/** For tests: forget the cached key so a changed env var takes effect. */
export function resetKey(): void {
  cachedKey = null;
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptToken(blob: string): string {
  const [version, ivB64, tagB64, dataB64] = blob.split('.');
  if (version !== PREFIX) throw new Error(`unsupported token format: ${version}`);
  const decipher = crypto.createDecipheriv(ALG, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Never show a full token in the UI or logs — only the last 4 characters. */
export function maskToken(plain: string): string {
  if (plain.length <= 8) return '••••';
  return '••••••••' + plain.slice(-4);
}

export function newState(): string {
  return crypto.randomBytes(24).toString('base64url');
}
