'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const configFile = path.join(root, 'config.json');
const DEFAULT_SCHEMA = 'jibas_wg';
// A brand change must not switch an existing installation to an empty queue.
const LEGACY_SCHEMA = 'wagw';

function gatewaySchema(name = DEFAULT_SCHEMA) {
  if (name !== DEFAULT_SCHEMA && name !== LEGACY_SCHEMA) {
    throw new Error(`Schema JIBAS WG harus ${DEFAULT_SCHEMA} (baru) atau ${LEGACY_SCHEMA} (instalasi lama).`);
  }
  return name;
}

function runtimeFlag(name) {
  return (process.env[`JIBAS_WG_${name}`] ?? process.env[`WAGW_${name}`]) === '1';
}

function readConfig(file = configFile) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (err) {
    throw new Error(`Tidak bisa membaca config.json (${err.code || 'I/O error'})`, { cause: err });
  }
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch {
    throw new Error('config.json bukan JSON yang valid');
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error('config.json harus berisi objek JSON');
  }
  return cfg;
}

function port(value, fallback, key) {
  const input = value ?? fallback;
  if (!/^\d{1,5}$/.test(String(input)) || Number(input) < 1 || Number(input) > 65535) {
    throw new Error(`${key} harus berupa port antara 1 dan 65535`);
  }
  return Number(input);
}

function dbType(cfg) {
  const type = String(cfg.db_type || 'sqlite').toLowerCase();
  if (!['mysql', 'oracle', 'sqlserver', 'odbc', 'sqlite'].includes(type)) {
    throw new Error('db_type tidak didukung');
  }
  return type;
}

function mysqlOptions(cfg) {
  for (const key of ['host', 'database', 'user']) {
    if (typeof cfg[key] !== 'string' || !cfg[key].trim()) throw new Error('Konfigurasi MySQL kurang: ' + key);
  }
  const timezone = cfg.timezone ?? '+07:00';
  if (!/^[+-](?:0\d|1[0-3]):[0-5]\d$/.test(timezone)) {
    throw new Error('timezone harus berupa offset SQL, contoh +07:00');
  }
  return {
    host: cfg.host,
    port: port(cfg.db_port, 3306, 'db_port'),
    user: cfg.user,
    password: cfg.password ?? '',
    database: cfg.database,
    charset: cfg.charset || 'utf8mb4',
    timezone,
    supportBigNumbers: true,
    connectTimeout: 10000
  };
}

module.exports = { root, configFile, readConfig, port, dbType, mysqlOptions, gatewaySchema, DEFAULT_SCHEMA, LEGACY_SCHEMA, runtimeFlag };
