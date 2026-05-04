/**
 * lib/phoneCodeAuth.ts
 *
 * Server-only helpers for the Phone Directory PIN system:
 *
 *   - hashCode / verifyCode — scrypt-based password hashing using
 *     Node's built-in `crypto`. No external dep.
 *   - signUnlockToken / verifyUnlockToken — issues an HMAC-signed
 *     cookie value once a DRIVER verifies their PIN. 8-hour TTL,
 *     httpOnly, secure-in-prod-only.
 *   - signAdminToken / verifyAdminToken — separate token for ADMIN
 *     write APIs. The admin pages always show the PIN form on every
 *     mount; this cookie just gates the API behind the form so a
 *     determined caller can't bypass the UI by hitting the API
 *     directly. Short TTL (5 minutes) so it expires soon after
 *     admin moves on.
 *   - Cookie-name constants and the cookieOptions helper for both.
 *   - throttleMsForFailures (linear up to 10s cap, no lockout).
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
const SCRYPT_KEYLEN = 32
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 } as const

export function hashCode(plain: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(plain, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
  return `${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyCode(plain: string, stored: string): boolean {
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
  if (candidate.length !== derivedBuf.length) return false
  return timingSafeEqual(candidate, derivedBuf)
}

// ── Signing helpers ─────────────────────────────────────────────────
function getSecret(): string {
  const s = process.env.PHONE_DIRECTORY_SECRET
    || process.env.NEXTAUTH_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('No secret configured for phone-directory token signing')
  return s
}

function hmacHex(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex')
}

// Generic token shape: "<userId>.<expiresAtMs>.<hmac>"
function signToken(userId: string, ttlMs: number): { value: string; maxAgeSeconds: number } {
  const expiresAt = Date.now() + ttlMs
  const payload = `${userId}.${expiresAt}`
  const sig = hmacHex(payload)
  return {
    value: `${payload}.${sig}`,
    maxAgeSeconds: Math.floor(ttlMs / 1000),
  }
}

function verifyToken(token: string | undefined, userId: string): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [tokenUserId, expiresAtRaw, sig] = parts
  if (tokenUserId !== userId) return false
  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt)) return false
  if (Date.now() > expiresAt) return false
  const expected = hmacHex(`${tokenUserId}.${expiresAtRaw}`)
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ── Driver unlock cookie ────────────────────────────────────────────
// 8 hours — covers a full shift. Re-issued on every successful
// entries GET so the cookie's lifetime extends with use.
const DRIVER_TOKEN_TTL_MS = 1000 * 60 * 60 * 8
export const UNLOCK_COOKIE_NAME = 'pd_unlock'

export const signUnlockToken = (userId: string) =>
  signToken(userId, DRIVER_TOKEN_TTL_MS)

export const verifyUnlockToken = (token: string | undefined, userId: string) =>
  verifyToken(token, userId)

// ── Admin gate cookie ───────────────────────────────────────────────
// Short TTL — the admin page form re-prompts on every mount, so the
// cookie's only job is to gate the API for ~5 minutes after a
// successful PIN entry. Plenty of time for a legitimate admin to
// add/edit/delete a few entries before re-mounting the page.
const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 5
export const ADMIN_COOKIE_NAME = 'pd_admin'

export const signAdminToken = (userId: string) =>
  signToken(userId, ADMIN_TOKEN_TTL_MS)

export const verifyAdminToken = (token: string | undefined, userId: string) =>
  verifyToken(token, userId)

// ── Cookie options helper ───────────────────────────────────────────
// secure: true breaks localhost (HTTP). Production on Vercel is HTTPS
// so secure: true works. Pattern: secure-in-prod, plain in dev.
export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

// ── Throttle delay ──────────────────────────────────────────────────
export function throttleMsForFailures(failedAttempts: number): number {
  if (failedAttempts <= 1) return 0
  return Math.min(10_000, (failedAttempts - 1) * 500)
}
