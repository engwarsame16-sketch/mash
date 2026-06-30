import crypto from 'node:crypto';
import { sql } from './db.js';

// Simple single-user password protection for the cost manager.
// The password (hashed + salted) and a server-side HMAC secret live in the
// app_settings table. A successful login sets an httpOnly cookie holding an
// HMAC token that the server can re-derive and verify on every request.

const COOKIE = 'cm_session';
const TOKEN_MSG = 'cm-auth-v1';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function getSetting(key) {
  const { rows } = await sql`SELECT value FROM app_settings WHERE key = ${key};`;
  return rows.length ? rows[0].value : null;
}
export async function setSetting(key, value) {
  await sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest('hex');

function timingEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

async function ensureAuthSecret() {
  let secret = await getSetting('auth_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await setSetting('auth_secret', secret);
  }
  return secret;
}

export async function isConfigured() {
  return Boolean(await getSetting('password_hash'));
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export async function isAuthed(req) {
  const secret = await getSetting('auth_secret');
  if (!secret) return false;
  const token = parseCookies(req)[COOKIE];
  if (!token) return false;
  return timingEqual(token, hmac(secret, TOKEN_MSG));
}

export async function setSession(res) {
  const secret = await ensureAuthSecret();
  const token = hmac(secret, TOKEN_MSG);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`);
}
export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

export async function verifyPassword(password) {
  const hash = await getSetting('password_hash');
  const salt = await getSetting('password_salt');
  if (!hash || !salt) return false;
  return timingEqual(sha256(salt + ':' + password), hash);
}
export async function setPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  await setSetting('password_salt', salt);
  await setSetting('password_hash', sha256(salt + ':' + password));
}

// Guard for data endpoints. Returns true if the request may proceed.
// If no password has been set yet (open mode), requests are allowed so the
// initial setup flow works; once a password exists, a valid session is required.
export async function requireAuth(req, res) {
  if (!(await isConfigured())) return true;
  if (await isAuthed(req)) return true;
  res.status(401).json({ error: 'Not authenticated.' });
  return false;
}
