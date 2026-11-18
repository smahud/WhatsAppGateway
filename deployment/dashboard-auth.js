'use strict';

const {randomBytes, scrypt, scryptSync, timingSafeEqual} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {promisify} = require('node:util');
const {root} = require('./settings');
const derive = promisify(scrypt);
const fileName = 'dashboard-auth.json';
const validUser = /^[a-zA-Z0-9_.-]{1,64}$/;
const bcryptHash = /^\$2[aby]\$(?:0[4-9]|1[0-4])\$[./A-Za-z0-9]{53}$/;

function readCredentials(file = path.join(root, fileName)) {
  let data;
  try { data = fs.readFileSync(file, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  const result = JSON.parse(data);
  if (typeof result?.user === 'string' && validUser.test(result.user) &&
      ((result.version === 1 && typeof result.salt === 'string' && typeof result.hash === 'string' &&
        /^[0-9a-f]{32}$/.test(result.salt) && /^[0-9a-f]{64}$/.test(result.hash)) ||
       (result.version === 2 && typeof result.hash === 'string' && bcryptHash.test(result.hash)))) return result;
  throw new Error('File kredensial dashboard tidak valid. Atur ulang melalui installer.');
}

function writeRecord(file, record, gid) {
  const temporary = `${file}.${randomBytes(8).toString('hex')}.install-tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(record) + '\n', {mode: 0o600, flag: 'wx'});
    if (gid !== undefined && process.platform !== 'win32') {
      fs.chownSync(temporary, process.getuid(), gid);
      fs.chmodSync(temporary, 0o640);
    }
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function validPassword(password) {
  return typeof password === 'string' && password.length > 0 &&
    !/[\x00\r\n]/.test(password) && Buffer.byteLength(password) <= 256;
}

function writeCredentials(file, user, password, gid) {
  if (typeof user !== 'string' || !validUser.test(user)) throw new Error('Username dashboard tidak valid.');
  if (!validPassword(password)) throw new Error('Password dashboard harus 1–256 byte, satu baris.');
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  writeRecord(file, {version: 1, user, salt: salt.toString('hex'), hash: hash.toString('hex')}, gid);
}

function planCredentials({file, user, password, legacyFile}) {
  if (user !== undefined && (typeof user !== 'string' || !validUser.test(user))) throw Error('Username dashboard tidak valid.');
  if (password !== undefined && !validPassword(password)) throw Error('Password dashboard harus 1–256 byte, satu baris.');
  const explicit = user !== undefined || password !== undefined;
  let current, migrate = false;
  try { current = readCredentials(file); }
  catch (err) { if (!explicit) throw err; }
  if (!current && legacyFile && fs.existsSync(legacyFile)) {
    const match = /^([a-zA-Z0-9_.-]{1,64}):([^\r\n]+)\r?\n?$/.exec(fs.readFileSync(legacyFile, 'utf8'));
    if (match && bcryptHash.test(match[2])) {
      current = {version: 2, user: match[1], hash: match[2]};
      migrate = !explicit;
    } else if (!explicit) {
      throw new Error('Login Linux lama tidak dapat dipindahkan; berikan --user atau --pass-file.');
    }
  }
  return {current, explicit, migrate};
}

function configureCredentials(options) {
  const {file, user, password, gid} = options;
  const {current, explicit, migrate} = planCredentials(options);
  if (migrate) writeRecord(file, current, gid);
  if (current && !explicit) return {user: current.user};
  const username = user ?? current?.user ?? 'admin';
  const generated = password === undefined ? randomBytes(24).toString('base64url') : undefined;
  writeCredentials(file, username, password ?? generated, gid);
  return {user: username, generated};
}

async function verify(user, password, credential) {
  if (user !== credential.user || !validPassword(password)) return false;
  if (credential.version === 2) {
    return require('bcryptjs').compare(password, credential.hash); // bcrypt keeps legacy 72-byte semantics.
  }
  const hash = await derive(password, Buffer.from(credential.salt, 'hex'), 32);
  return timingSafeEqual(hash, Buffer.from(credential.hash, 'hex'));
}

function dashboardAuth({file = path.join(root, fileName), https = false, ttl = 8 * 60 * 60 * 1000} = {}) {
  const express = require('express');
  const router = express.Router();
  const page = fs.readFileSync(path.join(__dirname, 'login.html'), 'utf8');
  const sessions = new Map();
  const attempts = new Map();
  const cookie = {httpOnly: true, secure: https, sameSite: 'strict', path: '/'};
  const sessionName = https ? '__Host-jibas_wg_session' : 'jibas_wg_session';
  const sessionHeader = new RegExp(`(?:^|;\\s*)${sessionName}=([0-9a-f]{64})(?=;|$)`);
  function render(res, code = 200, error = '') {
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    return res.status(code).type('html').send(page.replace('<!-- error -->', error ? `<p role="alert">${error}</p>` : ''));
  }
  function put(map, key, value, now, limit) {
    for (const [id, entry] of map) if (entry.expires <= now) map.delete(id);
    if (map.size >= limit) map.delete(map.keys().next().value);
    map.set(key, value);
  }
  router.use((req, res, next) => {
    res.set({'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'});
    const host = String(req.headers.host || '').toLowerCase();
    if (https ? req.headers['x-forwarded-proto'] !== 'https' || !/^[\w.:[\]-]+$/.test(host) :
        !new RegExp(`^(127\\.0\\.0\\.1|localhost)(:${req.socket.localPort})?$`).test(host)) return res.sendStatus(403);
    if (!['GET', 'HEAD'].includes(req.method) && (req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && req.headers.origin !== `${https ? 'https' : 'http'}://${host}`))) return res.sendStatus(403);
    try { req.dashboardCredential = readCredentials(file); }
    catch { return render(res, 503, 'Kredensial belum siap. Jalankan installer JIBAS WG.'); }
    if (!req.dashboardCredential) return render(res, 503, 'Kredensial belum siap. Jalankan installer JIBAS WG.');
    const token = sessionHeader.exec(req.headers.cookie || '')?.[1];
    const session = sessions.get(token);
    req.dashboardToken = token;
    req.dashboardSignedIn = !!session && session.expires > Date.now() &&
      session.credential === `${req.dashboardCredential.user}:${req.dashboardCredential.hash}`;
    if (session && !req.dashboardSignedIn) sessions.delete(token);
    return next();
  });
  router.get('/login', (req, res) => req.dashboardSignedIn ? res.redirect(303, '/') : render(res));
  router.post('/login', express.urlencoded({limit: '4kb', extended: false, parameterLimit: 4}), async (req, res) => {
    const peer = https ? req.headers['x-real-ip'] || req.socket.remoteAddress : req.socket.remoteAddress;
    const now = Date.now();
    const current = attempts.get(peer);
    const attempt = current?.expires > now ? current : {count: 0, expires: now + 60000};
    if (attempt.count >= 12) {
      res.set('Retry-After', String(Math.ceil((attempt.expires - now) / 1000)));
      return render(res, 429, 'Terlalu banyak percobaan. Coba lagi nanti.');
    }
    attempt.count++;
    if (attempt !== current) put(attempts, peer, attempt, now, 1024);
    const cred = req.dashboardCredential;
    if (!await verify(req.body?.username, req.body?.password, cred)) {
      return render(res, 401, 'Username atau password salah.');
    }
    attempts.delete(peer);
    sessions.delete(req.dashboardToken);
    const token = randomBytes(32).toString('hex');
    put(sessions, token, {expires: now + ttl, credential: `${cred.user}:${cred.hash}`}, now, 512);
    res.cookie(sessionName, token, {...cookie, maxAge: ttl});
    return res.redirect(303, '/');
  });
  router.post('/logout', (req, res) => {
    sessions.delete(req.dashboardToken);
    res.clearCookie(sessionName, cookie);
    return res.redirect(303, '/login');
  });
  router.use((req, res, next) => {
    if (req.dashboardSignedIn) return next();
    if (req.path === '/api' || req.path.startsWith('/api/')) return res.status(401).json({error: 'Login dashboard diperlukan.'});
    return res.redirect(303, '/login');
  });
  return router;
}

module.exports = {fileName,validUser,validPassword,readCredentials,planCredentials,configureCredentials,verify,dashboardAuth};
