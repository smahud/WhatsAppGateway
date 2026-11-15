'use strict';
const {config,connect,assertRuntime}=require('./database');
(async()=>{
 const c=config(),db=await connect(c);
 try{
  const control=await assertRuntime(db);
  const [[server]]=await db.query('SELECT VERSION() AS version,@@session.time_zone AS timezone,NOW() AS now');
  const [[worker]]=await db.query("SELECT IS_USED_LOCK('wagw-jibas-bridge') AS bridge_connection");
  const [jobs]=await db.query('SELECT state,COUNT(*) AS count FROM bridge_outgoing GROUP BY state');
  console.log(JSON.stringify({ok:true,node:process.version,database:server,bridgeEnabled:!!control.enabled,inboxEnabled:!!control.inbox_enabled,workerRunning:!!worker.bridge_connection,jobs,warnings:[...(c.user==='root'?['Use a dedicated runtime DB user in production']:[]),'Never expose dashboard publicly without authentication','Keep the old SMS consumer stopped; retain backups before cutover']},null,2));
 }finally{await db.end();}
})().catch(e=>{console.error('Preflight failed:',e.code||'',e.message);process.exitCode=1;});
