/**
 * lib/phoneCodeAuth.ts
 *
 * Server-only helpers for the Phone Directory PIN system:
 *
 *   - hashCode / verifyCode — scrypt-based password hashing using
 *     Node's built-in `crypto`. No external dep.
 *   - signUnlockToken / verifyUnlockToken — issues a short-lived
 *     HMAC-signed cookie value once a user verifies their PIN. The
 *     entries-list API checks for a valid token to gate access.
 *
 * NEVER import this from a client component — these helpers use
 * server-only secrets (process.env) and the `node:crypto` module.
 */

import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from 'node:crypto'

// ── Hashing ─────────────────────────────────────────────────────────
// scrypt with N=2^14 (16384) is plenty for a 6-digit PIN — anything
// stronger and verify-code becomes noticeably slow. Salt is 16 bytes
// per row, never reused.
const SCRYPT_KEYLEN = 32
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 } as const

export function hashCode(plain: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(plain, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
  return `${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyCode(plain: string, stored: string): boolean {
  // Stored format: "<salt-hex>$<derived-hex>"
  const [saltHex, derivedHex] = stored.split('$')
  if (!saltHex || !derivedHex) return false
  let saltBuf: Buffer
  let derivedBuf: Buffer
  try {
    saltBuf = Buffer.from(saltHex, 'hex')
    derivedBuf = Buffer.from(derivedHex, 'hex')
  } catch {
    return false
  }
  if (derivedBuf.length !== SCRYPT_KEYLEN) return false
  const candidate = scryptSync(plain, saltBuf, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
  // Constant-time compare to defeat timing attacks
  if (candidate.length !== derivedBuf.length) return false
  return timingSafeEqual(candidate, derivedBuf)
}

// ── Unlock token (signed cookie) ────────────────────────────────────
// Format: "<userId>.<expiresAtMs>.<hmac-hex>"
// HMAC computed with PHONE_DIRECTORY_SECRET (or NEXTAUTH_SECRET as
// fallback). Never store anything sensitive in the token itself —
// it just proves the bearer recently unlocked.
const TOKEN_TTL_MS = 1000 * 60 * 60 * 8  // 8 hours — same shift length

function getSecret(): string {
  const s = process.env.PHONE_DIRECTORY_SECRET
    || process.env.NEXTAUTH_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY  // last-resort fallback (still server-only)
  if (!s) throw new Error('No secret configured for phone-directory token signing')
  return s
}

function hmacHex(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex')
}

export function signUnlockToken(userId: string): { value: string; maxAgeSeconds: number } {
  const expiresAt = Date.now() + TOKEN_TTL_MS
  const payload = `${userId}.${expiresAt}`
  const sig = hmacHex(payload)
  return {
    value: `${payload}.${sig}`,
    maxAgeSeconds: Math.floor(TOKEN_TTL_MS / 1000),
  }
}

export function verifyUnlockToken(token: string | undefined, userId: string): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [tokenUserId, expiresAtRaw, sig] = parts
  if (tokenUserId !== userId) return false
  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt)) return false
  if (Date.now() > expiresAt) return false
  const expected = hmacHex(`${tokenUserId}.${expiresAtRaw}`)
  // Constant-time compare
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export const UNLOCK_COOKIE_NAME = 'pd_unlock'

// ── Throttle delay ──────────────────────────────────────────────────
// Per-failure artificial delay. Linear-up to a cap so the legitimate
// user experience after one fat-finger isn't punished, but a
// brute-force script gets meaningfully throttled.
//
// Why not lock: per the rollout decision (step 16) we never block
// the user — admin gets an alert at 15 failures instead. Throttling
// the response slows the API rate without affecting account access.
export function throttleMsForFailures(failedAttempts: number): number {
  // Math: 0,1 → 0ms; 2 → 500ms; 3 → 1s; 5 → 2s; 10 → 4.5s; 20 → 9.5s; capped 10s.
  if (failedAttempts <= 1) return 0
  return Math.min(10_000, (failedAttempts - 1) * 500)
}
