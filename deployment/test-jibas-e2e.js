'use strict';

// Requires an explicitly marked, empty disposable MariaDB/MySQL fixture.
// Captures the final WhatsApp payload with a fake socket; no WhatsApp network or pairing.
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const {config,connect,assertRuntime} = require('./database');
const {main} = require('./start-gateway');
const {configureCredentials, readCredentials, fileName} = require('./dashboard-auth');
const path = require('node:path');

async function until(check, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(200);
  }
  throw Error(`Timed out: ${label}`);
}

async function run() {
  const cfg = config();
  assert.equal(cfg.host, '127.0.0.1');
  assert.notEqual(cfg.db_port, 3306);
  const db = await connect(cfg);
  let gateway;
  try {
    const [[marker]] = await db.query('SELECT purpose FROM jbssms.gateway_test_fixture LIMIT 1');
    assert.equal(marker?.purpose, 'JIBAS WG disposable fixture');
    await assertRuntime(db,cfg.database);
    for (const table of ['jbssms.outbox','outbox','sent','bridge_outgoing']) {
      const [[{n}]] = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
      assert.equal(n, 0, 'Fixture must start empty: ' + table);
    }
    const file = path.join(__dirname, '..', fileName);
    assert(readCredentials(file),'Install dashboard credentials in the fixture first');
    const password = 'Isolated fixture authentication';
    configureCredentials({file,user:'sql-fixture',password});
    const sent = [];
    const ev = new EventEmitter();
    gateway = await main({
      listenPort: 0,
      loadAuthState: async () => ({state:{},saveCreds:async()=>{}}),
      makeSocket(options) {
        assert.equal(options.browser[0], 'JIBAS WhatsApp Gateway');
        setImmediate(() => ev.emit('connection.update',{qr:'pairing fixture text; not a WhatsApp session'}));
        return {ev,end(){},async sendMessage(jid, payload) { sent.push({jid,payload}); }};
      }
    });
    const url = 'http://127.0.0.1:' + gateway.server.address().port;
    assert.equal((await fetch(url+'/api/pairing-qr')).status,401);
    const login = await fetch(url+'/login',{redirect:'manual',method:'POST',
      body:new URLSearchParams({username:'sql-fixture',password})});
    assert.equal(login.status,303);
    const headers = {cookie:login.headers.get('set-cookie').split(';')[0]};
    await until(async () => {
      const status = await (await fetch(url+'/api/status',{headers})).json();
      return status.jibas.workerRunning && Number.isSafeInteger(status.qr);
    }, 'worker readiness and QR');
    const qr = await fetch(url+'/api/pairing-qr',{headers});
    assert.match(qr.headers.get('content-type'),/image\/svg\+xml/);
    assert.match(await qr.text(),/^<svg /);
    ev.emit('connection.update',{connection:'open'});
    const [[{now}]] = await db.query('SELECT NOW() AS now');
    const [source] = await db.execute(
      "INSERT INTO jbssms.outbox(DestinationNumber,Text,SendingDateTime,CreatorID) VALUES(?,?,?,'JIBAS-WG-FIXTURE')",
      ['081234567890','Fixture: Presensi & informasi', now]);
    const receipt = await until(async () => {
      const [[job]] = await db.execute('SELECT state,wagw_id FROM bridge_outgoing WHERE source_id=?',[source.insertId]);
      return job?.state === 'sent' && job;
    }, 'JIBAS source → gateway → simulated WhatsApp receipt');
    const [[row]] = await db.execute('SELECT status,wa_no,wa_text FROM sent WHERE id=?',[receipt.wagw_id]);
    assert.deepEqual(row,{status:'sent',wa_no:'6281234567890',wa_text:'Fixture: Presensi & informasi'});
    assert.deepEqual(sent,[{jid:'6281234567890@s.whatsapp.net',payload:{text:'Fixture: Presensi & informasi'}}]);
    const [[sourceCount]] = await db.query('SELECT COUNT(*) AS n FROM jbssms.outbox');
    const [[queueCount]] = await db.query('SELECT COUNT(*) AS n FROM outbox');
    assert.equal(sourceCount.n,0);
    assert.equal(queueCount.n,0);
    console.log('PASS: real MariaDB trigger/worker, secured dashboard and QR, one simulated WhatsApp delivery and recorded receipt.');
  } finally {
    try { await gateway?.close(); } finally { await db.end(); }
  }
}

run().catch(err=>{console.error(err.code || '',err.message);process.exitCode=1;});
