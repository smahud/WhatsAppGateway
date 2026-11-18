'use strict';

const { port, runtimeFlag } = require('./settings');
const { config,connect,assertRuntime,assertCutover,acquireLock,bridgeStatus,GATEWAY_LOCK } = require('./database');

async function main(options = {}) {
  const cfg = config();
  port(cfg.port, 3000, 'port');
  const maintenance = options.whatsapp === false || options.drainOutbox === false;
  const external = options.externalBridge === true;
  const abort = new AbortController();
  let db, gateway, worker, heartbeat;
  let ending = false;
  let status;

  const fail = err => {
    if (ending) return;
    console.error('Gateway JIBAS:', err.code || err.message);
    // Do not consume the queue after losing the guarded DB connection.
    process.exit(1);
  };
  try {
    db = await connect(cfg);
    db.on('error', fail);
    await acquireLock(db, GATEWAY_LOCK);
    const control = await assertRuntime(db, cfg.database);
    if (Number(control.enabled) === 1 && !maintenance) await assertCutover(db, cfg.database);
    status = await bridgeStatus(db);
    if (!maintenance && !external && status.workerRunning) {
      throw Error('Worker JIBAS lain aktif; hentikan instance lama sebelum menjalankan gateway');
    }
    const start = options.start || require('../gateway').startGateway;
    gateway = await start(cfg, {
      ...options,
      drainOutbox: !maintenance,
      expectJibasWorker: !maintenance,
      getJibasStatus: () => ({...status, maintenance})
    });
    if (!maintenance && !external) {
      worker = require('./bridge').run(abort.signal, cfg).catch(fail);
    }
  } catch (err) {
    ending = true;
    if (db) await db.end().catch(() => {});
    throw err;
  }
  let checking = false;
  heartbeat = setInterval(async () => {
    if (checking) return;
    checking = true;
    try { status = await bridgeStatus(db); }
    catch (err) { fail(err); }
    finally { checking = false; }
  }, 2000);

  let closed;
  const close = () => closed ??= (async () => {
    ending = true;
    clearInterval(heartbeat);
    abort.abort();
    try {
      await Promise.all([gateway.close(), worker]);
    } finally {
      await db.end().catch(() => {});
    }
  })();
  return { ...gateway, close };
}

async function run() {
  try {
    const dbOnly = runtimeFlag('DB_ONLY');
    const gateway = await main({
      whatsapp: !dbOnly,
      drainOutbox: !dbOnly && !runtimeFlag('PAUSE_OUTBOX'),
      externalBridge: process.platform === 'linux' && runtimeFlag('BRIDGE_EXTERNAL')
    });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      setTimeout(() => process.exit(1), 10000).unref();
      gateway.close().then(() => process.exit(0), err => {
        console.error('Gateway shutdown:', err.code || err.message);
        process.exit(1);
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    // An older node-windows registration may still fork wabot.js using IPC.
    if (typeof process.send === 'function') {
      process.on('message', message => { if (message === 'shutdown') stop(); });
      process.once('disconnect', stop);
      if (!process.connected) stop();
    }
  } catch (err) {
    console.error('Gateway JIBAS tidak bisa mulai:', err.code || '', err.message);
    process.exitCode = 1;
  }
}

module.exports = { main, run };
if (require.main === module) run();
