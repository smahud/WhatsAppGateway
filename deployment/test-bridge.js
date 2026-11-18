'use strict';
const assert=require('assert/strict');
const {config,connect,assertRuntime}=require('./database');
const {normalize,validate,tick}=require('./bridge');
(async()=>{
 assert.equal(normalize('081234567890'),'6281234567890');
 assert.equal(normalize('+62 812-3456-7890'),'6281234567890');
 assert.throws(()=>normalize('123@lid'));
 assert.throws(()=>validate({destination:'081234567890',message:'x'.repeat(2001)}));
 assert.throws(()=>validate({destination:'081234567890',message:'abc',multipart:'true'}));
  const cfg=config();
  const c=await connect(cfg);
 try {
   await assertRuntime(c,cfg.database);
  // Real capture trigger tested transactionally; neither message survives rollback.
  await c.beginTransaction();
   const [r]=await c.query("INSERT INTO jbssms.outbox(InsertIntoDB,SendingDateTime,Text,DestinationNumber,CreatorID) VALUES(NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY),'BRIDGE ROLLBACK TEST','081234567890','JIBAS-WG-INSTALL-TEST')");
  const [[captured]]=await c.execute('SELECT message FROM bridge_outgoing WHERE source_id=?',[r.insertId]);
  assert.equal(captured.message,'BRIDGE ROLLBACK TEST');
  await c.execute('UPDATE jbssms.outbox SET Text=? WHERE ID=?',['BRIDGE UPDATED',r.insertId]);
  const [[updated]]=await c.execute('SELECT message FROM bridge_outgoing WHERE source_id=?',[r.insertId]);assert.equal(updated.message,'BRIDGE UPDATED');
  await c.rollback();
  const [[gone]]=await c.execute('SELECT COUNT(*) AS n FROM bridge_outgoing WHERE source_id=?',[r.insertId]);assert.equal(gone.n,0);
  // Connection-local temporary tables shadow production: scheduler cannot see tests.
  for(const table of ['bridge_control','bridge_outgoing','outbox','sent']) {
    const [[ddl]]=await c.query(`SHOW CREATE TABLE ${table}`);
   await c.query(ddl['Create Table'].replace('CREATE TABLE','CREATE TEMPORARY TABLE'));
  }
  const [[sourceDdl]]=await c.query('SHOW CREATE TABLE jbssms.outbox');
  await c.query(sourceDdl['Create Table'].replace('CREATE TABLE `outbox`','CREATE TEMPORARY TABLE `test_jibas_outbox`'));
  const step=()=>tick(c,{sourceTable:'test_jibas_outbox'});
  await c.query("INSERT INTO bridge_control VALUES(1,1,'whatsapp',0)");
  await c.query("INSERT INTO test_jibas_outbox(ID,DestinationNumber,Text,CreatorID,SendingDateTime) VALUES(1,'081234567890','TEST','TEST',DATE_ADD(NOW(),INTERVAL 1 DAY))");
  await c.query("INSERT INTO bridge_outgoing(source_id,destination,message,scheduled_at) VALUES(1,'081234567890','TEST',DATE_ADD(NOW(),INTERVAL 1 DAY))");
  await step();
  let [[count]]=await c.query('SELECT COUNT(*) AS n FROM outbox');assert.equal(count.n,0);
  let [[remaining]]=await c.query('SELECT COUNT(*) AS n FROM test_jibas_outbox');assert.equal(remaining.n,1);
  await c.query('UPDATE bridge_outgoing SET scheduled_at=NOW()');
  await c.query('UPDATE test_jibas_outbox SET SendingDateTime=NOW()');await step();await step();
  [[count]]=await c.query('SELECT COUNT(*) AS n FROM outbox');assert.equal(count.n,1);
  const [[job]]=await c.query('SELECT * FROM bridge_outgoing');assert.equal(job.state,'queued');
  [[remaining]]=await c.query('SELECT COUNT(*) AS n FROM test_jibas_outbox');assert.equal(remaining.n,0);
  await c.execute("INSERT INTO sent(id,wa_no,wa_text,wa_time,status) VALUES(?,'6281234567890','TEST',NOW(),'sent')",[job.wagw_id]);
   await c.query('UPDATE bridge_control SET enabled=0');
   await step();const [[done]]=await c.query('SELECT state FROM bridge_outgoing');assert.equal(done.state,'sent');
   await c.query('UPDATE bridge_control SET enabled=1');
  await c.query("INSERT INTO test_jibas_outbox(ID,DestinationNumber,Text,CreatorID,SendingDateTime) VALUES(2,'bad','TEST','TEST',NOW())");
  await c.query("INSERT INTO bridge_outgoing(source_id,destination,message) VALUES(2,'bad','TEST')");await step();
  const [[bad]]=await c.query('SELECT state FROM bridge_outgoing WHERE source_id=2');assert.equal(bad.state,'rejected');
  [[remaining]]=await c.query('SELECT COUNT(*) AS n FROM test_jibas_outbox WHERE ID=2');assert.equal(remaining.n,1);
  await c.query("INSERT INTO bridge_outgoing(source_id,destination,message) VALUES(3,'081234567890','MISSING')");await step();
  const [[missing]]=await c.query('SELECT state FROM bridge_outgoing WHERE source_id=3');assert.equal(missing.state,'cancelled');
  await c.query("INSERT INTO test_jibas_outbox(ID,DestinationNumber,Text,CreatorID,SendingDateTime) VALUES(4,'081234567890','ROLLBACK','TEST',NOW())");
  await c.query("INSERT INTO bridge_outgoing(source_id,destination,message) VALUES(4,'081234567890','ROLLBACK')");
  const originalExecute=c.execute.bind(c);
  c.execute=async(sql,args)=>{if(sql.startsWith('DELETE FROM test_jibas_outbox'))throw Error('Simulated DELETE failure');return originalExecute(sql,args);};
  await assert.rejects(step(),/Simulated DELETE failure/);c.execute=originalExecute;
  [[remaining]]=await c.query('SELECT COUNT(*) AS n FROM test_jibas_outbox WHERE ID=4');assert.equal(remaining.n,1);
  [[count]]=await c.query('SELECT COUNT(*) AS n FROM outbox');assert.equal(count.n,1);
  const [[rolled]]=await c.query('SELECT state,wagw_id FROM bridge_outgoing WHERE source_id=4');assert.equal(rolled.state,'pending');assert.equal(rolled.wagw_id,null);
  await step();[[remaining]]=await c.query('SELECT COUNT(*) AS n FROM test_jibas_outbox WHERE ID=4');assert.equal(remaining.n,0);
  const [[lastJob]]=await c.query('SELECT wagw_id FROM bridge_outgoing WHERE source_id=4');
  await c.execute("INSERT INTO sent(id,wa_no,wa_text,wa_time,status) VALUES(?,'6281234567890','ROLLBACK',NOW(),'failed')",[lastJob.wagw_id]);
  await step();const [[failed]]=await c.query('SELECT state FROM bridge_outgoing WHERE source_id=4');assert.equal(failed.state,'failed');
  console.log('PASS: real capture/update/rollback; move deletes source; schedule retained; invalid source retained; missing source cancelled; DELETE failure rolls back destination and receipt; retry queues once; status sync. No messages sent.');
 }finally{await c.rollback().catch(()=>{});await c.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
