import crypto from 'crypto';
import { readJson, writeJson } from './store.js';
import { clientIp } from './http.js';

const COOKIE = 'jibek_session';
const MAX_AGE_SEC = 30 * 24 * 60 * 60;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const FAIL_DELAY_MS = 400;

function secret() {
  const value = process.env.SESSION_SECRET || '';
  if (value.length < 16) {
    const err = new Error('SESSION_SECRET missing');
    err.status = 500;
    throw err;
  }
  return value;
}

export function signSession(data) {
  const payload = { ...data, exp: Date.now() + MAX_AGE_SEC * 1000 };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of String(header).split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return '';
}

export function readSession(req) {
  try {
    const raw = readCookie(req, COOKIE);
    if (!raw) return null;
    const dot = raw.lastIndexOf('.');
    if (dot < 1) return null;
    const body = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
    const got = Buffer.from(sig);
    const want = Buffer.from(expected);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || data.exp < Date.now()) return null;
    if (data.role !== 'admin' && data.role !== 'partner') return null;
    return data;
  } catch (e) {
    return null;
  }
}

function secureFlag(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https' || process.env.VERCEL_ENV === 'production';
}

export function sessionCookie(token, req) {
  const secure = secureFlag(req) ? '; Secure' : '';
  return COOKIE + '=' + token + '; HttpOnly; Path=/; Max-Age=' + MAX_AGE_SEC + '; SameSite=Lax' + secure;
}

export function clearSessionCookie(req) {
  const secure = secureFlag(req) ? '; Secure' : '';
  return COOKIE + '=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' + secure;
}

function lockPath(kind, id) {
  const hash = crypto.createHash('sha256').update(kind + '|' + id).digest('hex').slice(0, 24);
  return 'auth/lock-' + hash + '.json';
}

export async function assertNotLocked(kind, id) {
  const row = await readJson(lockPath(kind, id));
  if (row && row.lockedUntil > Date.now()) return { locked: true };
  return { locked: false };
}

export async function recordFailure(kind, id) {
  const path = lockPath(kind, id);
  const row = (await readJson(path)) || { fails: 0, lockedUntil: 0 };
  if (row.lockedUntil > Date.now()) row.fails = 0;
  row.fails += 1;
  if (row.fails >= MAX_FAILS) {
    row.lockedUntil = Date.now() + LOCK_MS;
    row.fails = 0;
  }
  await writeJson(path, row);
  await new Promise(resolve => setTimeout(resolve, FAIL_DELAY_MS));
}

export async function clearFailures(kind, id) {
  await writeJson(lockPath(kind, id), { fails: 0, lockedUntil: 0 });
}

export function loginKey(req, extra) {
  return clientIp(req) + '|' + String(extra || '');
}

function shaEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

export function verifyAdminLogin(login) {
  const expected = process.env.ADMIN_LOGIN || '';
  if (!expected) return false;
  return shaEqual(login, expected);
}

/* ADMIN_PASSWORD_HASH = pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
   The salt is the hex string itself (UTF-8), not decoded bytes. */
export function verifyAdminPassword(password) {
  const stored = process.env.ADMIN_PASSWORD_HASH || '';
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expectedHex = parts[3];
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 2000000) return false;
  if (!/^[0-9a-fA-F]{8,256}$/.test(salt) || !/^[0-9a-fA-F]{64}$/.test(expectedHex)) return false;
  let derived;
  try {
    derived = crypto.pbkdf2Sync(String(password).slice(0, 200), salt, iterations, 32, 'sha256');
  } catch (e) {
    return false;
  }
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function adminEnvReady() {
  return !!(process.env.ADMIN_LOGIN && process.env.ADMIN_PASSWORD_HASH && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16);
}
