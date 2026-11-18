'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { fileName, validUser, validPassword, configureCredentials, planCredentials } = require('./deployment/dashboard-auth');
const { checkDeployment, deploy } = require('./deployment/deploy');

function service(action, flags = []) {
  if (process.platform !== 'win32') throw new Error('Gunakan install.sh di Linux.');
  const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = path.join(__dirname, 'deployment', 'windows', 'manage-service.ps1');
  const run = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Action', action, '-NodeExe', process.execPath, ...flags], { stdio: 'inherit' });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
  return process.exitCode === 0;
}

function parseArgs(args) {
  const values = {};
  const switches = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--user', '--pass', '--pass-file'].includes(arg)) {
      if (args[i+1] === undefined || args[i+1].startsWith('--')) throw new Error(`Nilai diperlukan untuk ${arg}`);
      values[arg] = args[++i];
    } else if (arg === '--with-bridge') {
      // Older install commands remain valid; JIBAS is now always installed.
    } else if (arg === '--secure-folder') {
      // The dedicated installation folder is always protected.
    } else if (['--help', '-h', '--credentials-only', '--pause-outbox', '--db-only', '--no-activate-move'].includes(arg)) {
      switches.add(arg);
    } else {
      throw new Error(`Opsi tidak dikenal: ${arg}`);
    }
  }
  if (Object.hasOwn(values, '--pass') && Object.hasOwn(values, '--pass-file')) {
    throw new Error('Pilih salah satu dari --pass atau --pass-file.');
  }
  return { values, switches };
}

function credentialOptions(values) {
  const user = values['--user'];
  if (user !== undefined && !validUser.test(user)) throw new Error('Username dashboard tidak valid: gunakan 1-64 huruf, angka, . _ atau -');
  let password = values['--pass'];
  if (values['--pass-file'] !== undefined) {
    password = fs.readFileSync(values['--pass-file'], 'utf8').replace(/^\uFEFF/, '').replace(/\r?\n$/, '');
  }
  if (password !== undefined && !validPassword(password)) throw new Error('Password dashboard harus 1–256 byte, satu baris.');
  return {file: path.join(__dirname, fileName),user,password};
}

function setCredentials(options) {
  const result = configureCredentials(options);
  console.log(`Username dashboard: ${result.user}`);
  if (result.generated) console.log(`Password dashboard (ditampilkan sekali): ${result.generated}`);
}

async function install(args) {
  const { values, switches } = parseArgs(args);
  if (switches.has('--help') || switches.has('-h')) {
    console.log(`JIBAS WhatsApp Gateway
Install-Windows-Service.ps1 [-User NAME] [-Pass PASSWORD | -PassFile PATH]
Default: pasang bridge JIBAS, aktifkan MOVE, dan buat login admin dengan password acak pada pemasangan pertama.
Hentikan consumer SMS lama sebelum cutover. Jalankan lagi perintah yang sama untuk memperbaiki instalasi sendiri.
  -User NAME          Ganti username; password baru dibuat bila -Pass/-PassFile tidak diberikan
  -CredentialsOnly    Ubah login dashboard tanpa restart atau mengubah database/service
  -NoActivateMove     Siapkan JIBAS dengan MOVE dijeda; aktifkan kemudian dengan deployment/activate.js
  -PauseOutbox        Staging JIBAS: jeda MOVE dan jangan kirim antrean WhatsApp dari proses ini
  -DbOnly             Diagnostik schema JIBAS yang sudah siap, tanpa mengubah DB atau menghubungkan WhatsApp
Jalankan instalasi service sebagai Administrator. Dashboard Windows hanya di localhost.`);
    return;
  }
  if (process.platform !== 'win32') throw new Error('Gunakan install.sh di Linux.');
  const credentials=credentialOptions(values);
  if (switches.has('--credentials-only')) {
    if (switches.size !== 1) throw new Error('--credentials-only tidak menerima opsi service.');
    if (credentials.user === undefined && credentials.password === undefined) throw new Error('--credentials-only membutuhkan --user, --pass, atau --pass-file.');
    setCredentials(credentials);
    return;
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major >= 25 || (major === 22 && minor < 14)) {
    throw new Error('Gunakan Node.js 22.14 hingga 24.x.');
  }
  if (switches.has('--db-only') && (switches.has('--pause-outbox') || switches.has('--no-activate-move'))) {
    throw new Error('--db-only hanya diagnostik; jangan gabungkan dengan opsi staging.');
  }
  const flags = Object.entries({
    '--pause-outbox': '-PauseOutbox', '--db-only': '-DatabaseOnly'
  }).filter(([key]) => switches.has(key)).map(([, flag]) => flag);
  const diagnostic=switches.has('--db-only');
  const activateMove=!diagnostic && !switches.has('--no-activate-move') && !switches.has('--pause-outbox');
  const phase=process.env.JIBAS_WG_INSTALL_PHASE;
  if (phase === 'check') {
    planCredentials(credentials);
    return checkDeployment({activateMove,diagnostic});
  }
  if (phase !== 'apply') throw new Error('Jalankan Install_to_Windows_Service.bat untuk bootstrap dan pengecekan port.');
  if (!diagnostic) await deploy({activateMove});
  setCredentials(credentials);
  service('Install', flags);
}

function reportError(err) {
  console.error(err.code || '', err.message);
  process.exitCode = 1;
}

module.exports = { install, service, reportError };
if (require.main === module) install(process.argv.slice(2)).catch(reportError);
