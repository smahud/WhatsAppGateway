'use strict';
const {config,connect,assertRuntime,assertCutover,acquireLock,BRIDGE_LOCK}=require('./database');
const {setTimeout:sleep}=require('node:timers/promises');
function normalize(number) {
  let n = String(number).trim().replace(/[+\s()\-]/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  else if (n.startsWith('8')) n = '62' + n;
  if (!/^\d{8,15}$/.test(n)) throw Error('Nomor tidak valid atau JID non-telepon (grup/LID)');
  return n;
}
function validate(job) {
  const number = normalize(job.destination);
  if (job.multipart === 'true') throw Error('Multipart/PDU memerlukan decoder, tidak dikirim otomatis');
  const message = String(job.message || '');
  if (!message.trim()) throw Error('Pesan kosong');
  if ([...message].length > 2000) throw Error('Pesan melebihi batas schema JIBAS WG 2000 karakter');
  // Legacy prefixes must not turn SMS text into commands.
  if (/^(POLLVOTE!|TEXTWITHBUTTON!|\[REQ_ONLINE\])/.test(message)) throw Error('Awalan pesan merupakan perintah khusus gateway');
  return {number, message};
}
async function moveOne(c, sourceTable) {
  await c.beginTransaction();
  try {
    // Match JIBAS UPDATE lock order: source row first, capture row second.
    const [[candidate]] = await c.query("SELECT id,source_id FROM bridge_outgoing WHERE state='pending' AND (scheduled_at IS NULL OR scheduled_at<=NOW()) ORDER BY id LIMIT 1");
    if (candidate) {
      const [[source]] = await c.query(`SELECT *, (SendingDateTime IS NULL OR SendingDateTime='0000-00-00 00:00:00' OR SendingDateTime<=NOW()) AS due FROM ${sourceTable} WHERE ID=? FOR UPDATE`,[candidate.source_id]);
      const [[job]] = await c.query('SELECT * FROM bridge_outgoing WHERE id=? FOR UPDATE',[candidate.id]);
      if (!job || job.state !== 'pending') { await c.commit(); return; }
      if (!source) {
        // Another consumer/deletion won: never send a stale captured copy.
        await c.execute("UPDATE bridge_outgoing SET state='cancelled',error='Source no longer exists; not moved' WHERE id=?",[job.id]);
        await c.commit(); return;
      }
      if (!source.due) { await c.commit(); return; }
      let payload;
      try { payload = validate({destination:source.DestinationNumber,message:source.Text || source.TextDecoded,multipart:source.MultiPart}); } catch(e) {
        await c.execute("UPDATE bridge_outgoing SET state='rejected',error=? WHERE id=?",[e.message,job.id]);
      }
      if (payload) {
        const [result] = await c.execute('INSERT INTO outbox(wa_no,wa_text) VALUES(?,?)',[payload.number,payload.message]);
        await c.execute("UPDATE bridge_outgoing SET state='queued',wagw_id=? WHERE id=?",[result.insertId,job.id]);
        const [removed] = await c.execute(`DELETE FROM ${sourceTable} WHERE ID=?`,[job.source_id]);
        if (removed.affectedRows !== 1) throw Error('Source delete failed; move rolled back');
      }
    }
    await c.commit();
  } catch(e) { await c.rollback().catch(()=>{}); throw e; }
}

async function tick(c, {sourceTable = 'jbssms.outbox', checkCutover = false, schema} = {}) {
  if (!['jbssms.outbox','test_jibas_outbox'].includes(sourceTable)) throw Error('Invalid source table');
  const [[control]] = await c.query('SELECT * FROM bridge_control WHERE id=1');
  if (!control || control.mode !== 'whatsapp' || Number(control.inbox_enabled) !== 0) {
    throw Error('Bridge JIBAS hanya mendukung MOVE outbox WhatsApp');
  }
  const enabled = Number(control.enabled) === 1;
  if (enabled) {
    if (checkCutover) await assertCutover(c,schema);
    await moveOne(c, sourceTable);
  }
  // Pausing only stops new transfers; reconcile already queued jobs either way.
  await c.query("UPDATE bridge_outgoing b JOIN sent s ON s.id=b.wagw_id SET b.state=IF(s.status='sent','sent','failed'),b.error=IF(s.status='sent',NULL,CONCAT('JIBAS WG: ',s.status)) WHERE b.state='queued'");
  return enabled;
}
async function run(signal, cfg=config()) {
  while (!signal?.aborted) {
    let c;
    try {
      c=await connect(cfg);
      c.on('error',err=>{if(!signal?.aborted)console.error('Worker DB:',err.code||err.message);});
      await assertRuntime(c,cfg.database);
      await acquireLock(c,BRIDGE_LOCK);
      let enabled=false;
      while (!signal?.aborted) {
        enabled=await tick(c,{checkCutover:!enabled,schema:cfg.database});
        await sleep(2000,undefined,{signal});
      }
    } catch(e) { if(!signal?.aborted) console.error(new Date().toISOString(),e.message); }
    finally { if(c) await c.end().catch(()=>{}); }
    try { await sleep(5000,undefined,{signal}); }
    catch(e) { if(!signal?.aborted) throw e; }
  }
}
module.exports={normalize,validate,tick,run};
if(require.main===module){
 const stop=new AbortController();
 process.once('SIGTERM',()=>stop.abort());
 process.once('SIGINT',()=>stop.abort());
 run(stop.signal).catch(err=>{console.error(err.code||'',err.message);process.exitCode=1;});
}
