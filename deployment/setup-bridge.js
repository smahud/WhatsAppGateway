'use strict';
const fs=require('fs'),path=require('path'),mysql=require('mysql2/promise');
const cfg=require('../config.json');
async function setup(){
 const c=await mysql.createConnection({host:cfg.host,port:cfg.db_port||3306,user:cfg.user,password:cfg.password,database:cfg.database,multipleStatements:true});
 try {
  await c.query(fs.readFileSync(path.join(__dirname,'bridge-schema.sql'),'utf8'));
  // Install once; do not drop/recreate triggers while live JIBAS writes may occur.
  const [triggers]=await c.query("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='jbssms' AND TRIGGER_NAME='wagw_capture_outbox'");
  if(!triggers.length) await c.query(`CREATE TRIGGER jbssms.wagw_capture_outbox AFTER INSERT ON jbssms.outbox FOR EACH ROW
   INSERT INTO wagw.bridge_outgoing(source_id,destination,message,scheduled_at,multipart)
   VALUES(NEW.ID,NEW.DestinationNumber,COALESCE(NULLIF(NEW.Text,''),NEW.TextDecoded),NULLIF(NEW.SendingDateTime,'0000-00-00 00:00:00'),NEW.MultiPart)`);
  await c.query(`CREATE OR REPLACE TRIGGER jbssms.wagw_update_outbox AFTER UPDATE ON jbssms.outbox FOR EACH ROW
   UPDATE wagw.bridge_outgoing SET destination=NEW.DestinationNumber,message=COALESCE(NULLIF(NEW.Text,''),NEW.TextDecoded),scheduled_at=NULLIF(NEW.SendingDateTime,'0000-00-00 00:00:00'),multipart=NEW.MultiPart,state='pending',error=NULL WHERE source_id=NEW.ID AND state IN ('pending','rejected')`);
  // Baseline: do not replay old WhatsApp inbox into JIBAS on installation.
  await c.query("INSERT IGNORE INTO bridge_incoming(source_id,state) SELECT id,'baseline' FROM inbox");
  console.log('Bridge schema/capture installed. Outgoing enabled remains unchanged (default disabled).');
 } finally {await c.end();}
}
setup().catch(e=>{console.error(e.message);process.exitCode=1});
