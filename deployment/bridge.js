'use strict';
const {connect,assertRuntime}=require('./database');
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
  if ([...message].length > 2000) throw Error('Pesan melebihi batas schema WAGW 2000 karakter');
  // WAGW interprets these prefixes as special operations, not literal SMS text.
  if (/^(POLLVOTE!|TEXTWITHBUTTON!|\[REQ_ONLINE\])/.test(message)) throw Error('Awalan pesan merupakan perintah khusus WAGW');
  return {number, message};
}
async function tick(c, {sourceTable = 'jbssms.outbox'} = {}) {
  if (!['jbssms.outbox','test_jibas_outbox'].includes(sourceTable)) throw Error('Invalid source table');
  const [[control]] = await c.query('SELECT * FROM bridge_control WHERE id=1');
  if (!control.enabled) return;
  if (control.mode !== 'whatsapp') throw Error('Bridge ini hanya mendukung mode move (whatsapp)');
  await c.beginTransaction();
  try {
    // Match JIBAS UPDATE lock order: source row first, capture row second.
    const [[candidate]] = await c.query("SELECT id,source_id FROM bridge_outgoing WHERE state='pending' AND (scheduled_at IS NULL OR scheduled_at<=NOW()) ORDER BY id LIMIT 1");
    if (candidate) {
      const [[source]] = await c.query(`SELECT *, (SendingDateTime IS NULL OR SendingDateTime='0000-00-00 00:00:00' OR SendingDateTime<=NOW()) AS due FROM ${sourceTable} WHERE ID=? FOR UPDATE`,[candidate.source_id]);
      const [[job]] = await c.query('SELECT * FROM bridge_outgoing WHERE id=? FOR UPDATE',[candidate.id]);
      if (job.state !== 'pending') { await c.commit(); return; }
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
  await c.query("UPDATE bridge_outgoing b JOIN sent s ON s.id=b.wagw_id SET b.state=IF(s.status='sent','sent','failed'),b.error=IF(s.status='sent',NULL,CONCAT('WAGW: ',s.status)) WHERE b.state='queued'");
  // Never automatically retry a send: WAGW itself has no end-to-end idempotency key.
  if (!control.inbox_enabled) return;
  const [incoming] = await c.query("SELECT i.* FROM inbox i LEFT JOIN bridge_incoming b ON b.source_id=i.id WHERE b.source_id IS NULL ORDER BY i.id LIMIT 20");
  for (const item of incoming) {
    let number;
    try { number=normalize(item.wa_no); } catch(e) {
      await c.execute("INSERT INTO bridge_incoming(source_id,state,error) VALUES(?,'rejected',?)",[item.id,e.message]);
      continue;
    }
    const marker = 'WAGW:' + item.id;
    // JIBAS inbox is MyISAM: the marker makes recovery safe after a crash between
    // the inbox insert and the InnoDB receipt, without pretending rollback works.
    const [[found]] = await c.execute('SELECT ID FROM jbssms.inbox WHERE RecipientID=? LIMIT 1',[marker]);
    let id = found && found.ID;
    if (!id) {
      const [result] = await c.execute("INSERT INTO jbssms.inbox(ReceivingDateTime,Text,SenderNumber,Coding,UDH,SMSCNumber,TextDecoded,RecipientID,Processed,Status) VALUES(?, ?, ?, 'Unicode_No_Compression', '', '', ?, ?, 'false', 0)",
        [item.wa_time,item.wa_text,number.startsWith('62')?'0'+number.slice(2):number, [...item.wa_text].slice(0,160).join(''),marker]);
      id=result.insertId;
    }
    await c.execute("INSERT INTO bridge_incoming(source_id,destination_id,state) VALUES(?,?,'copied')",[item.id,id]);
  }
}
async function run() {
  let c;
  for (;;) {
    try {
      c=await connect();
      await assertRuntime(c);
      const [[lock]]=await c.query("SELECT GET_LOCK('wagw-jibas-bridge',0) AS acquired");
      if (!lock.acquired) throw Error('Bridge lain sudah berjalan');
      for (;;) { await tick(c); await new Promise(r=>setTimeout(r,2000)); }
    } catch(e) { console.error(new Date().toISOString(),e.message); }
    finally { if(c) await c.end().catch(()=>{}); }
    await new Promise(r=>setTimeout(r,5000));
  }
}
module.exports={normalize,validate,tick};
if(require.main===module) run();
