'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {fileName, validUser, validPassword, configureCredentials, planCredentials} = require('./dashboard-auth');

function fromEnvironment(env = process.env) {
  if (env.JIBAS_WG_LOGIN_PASSWORD !== undefined && env.JIBAS_WG_LOGIN_PASS_FILE) {
    throw new Error('Pilih --pass atau --pass-file, bukan keduanya.');
  }
  const user = env.JIBAS_WG_LOGIN_USER;
  const passFile = env.JIBAS_WG_LOGIN_PASS_FILE;
  const password = passFile
    ? fs.readFileSync(passFile, 'utf8').replace(/^\uFEFF/, '').replace(/\r?\n$/, '')
    : env.JIBAS_WG_LOGIN_PASSWORD;
  if (user !== undefined && !validUser.test(user)) throw new Error('Username dashboard tidak valid.');
  if ((password !== undefined || passFile) && !validPassword(password)) throw new Error('Password dashboard harus 1–256 byte, satu baris.');
  if (env.JIBAS_WG_LOGIN_REQUIRED === '1' && user === undefined && password === undefined) {
    throw new Error('--credentials-only membutuhkan --user, --pass, atau --pass-file.');
  }
  return {user,password};
}

if (require.main === module) {
  try {
    const options = {
      ...fromEnvironment(),
      file: path.resolve(process.env.JIBAS_WG_AUTH_FILE || path.join(__dirname, '..', fileName)),
      legacyFile: process.env.JIBAS_WG_LEGACY_HTPASSWD,
      gid: process.env.JIBAS_WG_AUTH_GID === undefined ? undefined : Number(process.env.JIBAS_WG_AUTH_GID)
    };
    if (process.argv[2] === '--check') planCredentials(options);
    else {
      const result = configureCredentials(options);
      console.log(`Username dashboard: ${result.user}`);
      if (result.generated) console.log(`Password dashboard (ditampilkan sekali): ${result.generated}`);
    }
  } catch (err) {
    console.error('Login dashboard:', err.code || err.message);
    process.exitCode = 1;
  }
}
module.exports = {fromEnvironment};
