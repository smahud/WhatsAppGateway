'use strict';
const fs=require('fs'),path=require('path');
const {connect,assertSource}=require('./database');
function canonical(s){return s.replace(/[`\s;]/g,'').toLowerCase();}
async function ensureTrigger(c,name,event,body){
 const [existing]=await c.execute("SELECT ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='jbssms' AND TRIGGER_NAME=?",[name]);
 if(existing.length){
  if(canonical(existing[0].ACTION_STATEMENT)!==canonical(body))throw Error('Trigger '+name+' differs; stop JIBAS writes and perform a reviewed migration. No trigger was dropped.');
  return;
 }
 await c.query(`CREATE TRIGGER jbssms.${name} AFTER ${event} ON jbssms.outbox FOR EACH ROW ${body}`);
}
async function setup(){
 const c=await connect(undefined,{multipleStatements:true});
 try {
  await assertSource(c);
  await c.query(fs.readFileSync(path.join(__dirname,'bridge-schema.sql'),'utf8'));
  // Install once; do not drop/recreate triggers while live JIBAS writes may occur.
  await ensureTrigger(c,'wagw_capture_outbox','INSERT',`INSERT INTO wagw.bridge_outgoing(source_id,destination,message,scheduled_at,multipart)
   VALUES(NEW.ID,NEW.DestinationNumber,COALESCE(NULLIF(NEW.Text,''),NEW.TextDecoded),NULLIF(NEW.SendingDateTime,'0000-00-00 00:00:00'),NEW.MultiPart)`);
  await ensureTrigger(c,'wagw_update_outbox','UPDATE',`UPDATE wagw.bridge_outgoing SET destination=NEW.DestinationNumber,message=COALESCE(NULLIF(NEW.Text,''),NEW.TextDecoded),scheduled_at=NULLIF(NEW.SendingDateTime,'0000-00-00 00:00:00'),multipart=NEW.MultiPart,state='pending',error=NULL WHERE source_id=NEW.ID AND state IN ('pending','rejected')`);
  // Baseline: do not replay old WhatsApp inbox into JIBAS on installation.
  await c.query("INSERT IGNORE INTO bridge_incoming(source_id,state) SELECT id,'baseline' FROM inbox");
  console.log('Bridge schema/capture installed. Outgoing enabled remains unchanged (default disabled).');
 } finally {await c.end();}
}
module.exports={setup,canonical,ensureTrigger};
if(require.main===module)setup().catch(e=>{console.error(e.message);process.exitCode=1});
