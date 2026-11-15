'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
function config(){
 const c=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
 if(c.db_type!=='mysql'||c.database!=='wagw')throw Error('Deployment requires db_type=mysql and database=wagw');
 for(const key of ['host','user'])if(!c[key])throw Error('Missing config: '+key);
 const port=Number(c.db_port||3306);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid db_port');
 const timezone=c.timezone||'+07:00';
 if(!/^[+-](?:0\d|1[0-3]):[0-5]\d$/.test(timezone))throw Error('timezone must be an SQL offset, e.g. +07:00');
 return {...c,db_port:port,timezone};
}
function options(c){return {host:c.host,port:c.db_port,user:c.user,password:c.password||'',database:c.database,charset:'utf8mb4',timezone:c.timezone,connectTimeout:10000};}
async function connect(c=config(),extra={}){
 const db=await require('mysql2/promise').createConnection({...options(c),...extra});
 try{await db.query('SET SESSION time_zone=?',[c.timezone]);return db;}catch(e){await db.end();throw e;}
}
async function assertSource(db){
 const [tables]=await db.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='jbssms' AND TABLE_NAME='outbox'");
 if(tables.length!==1||tables[0].ENGINE!=='InnoDB')throw Error('jbssms.outbox must exist on this DB server and use InnoDB');
 const [columns]=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='jbssms' AND TABLE_NAME='outbox'");
 for(const name of ['ID','DestinationNumber','Text','TextDecoded','SendingDateTime','MultiPart'])if(!columns.some(c=>c.COLUMN_NAME===name))throw Error('Missing jbssms.outbox.'+name);
}
async function assertRuntime(db){
 await assertSource(db);
 const [tables]=await db.query("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='wagw' AND TABLE_NAME IN ('inbox','outbox','sent','bridge_control','bridge_outgoing')");
 if(tables.length!==5||tables.some(t=>t.ENGINE!=='InnoDB'))throw Error('Run deploy: WAGW/bridge tables missing or not InnoDB');
 const [status]=await db.query("SELECT CHARACTER_MAXIMUM_LENGTH AS width FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='wagw' AND TABLE_NAME='sent' AND COLUMN_NAME='status'");
 if(!status.length||Number(status[0].width)<20)throw Error('Run deploy: sent.status needs at least 20 characters');
 const [triggers]=await db.query("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='jbssms' AND TRIGGER_NAME IN ('wagw_capture_outbox','wagw_update_outbox')");
 if(triggers.length!==2)throw Error('Bridge capture triggers missing; run deploy with installer privileges');
 const [[control]]=await db.query('SELECT * FROM wagw.bridge_control WHERE id=1');
 if(!control||control.mode!=='whatsapp'||control.inbox_enabled)throw Error('Expected outbox-only move mode, inbox_enabled=0');
 const [[uncaptured]]=await db.query('SELECT COUNT(*) AS count FROM jbssms.outbox s LEFT JOIN wagw.bridge_outgoing b ON b.source_id=s.ID WHERE b.id IS NULL');
 if(Number(uncaptured.count))throw Error('Uncaptured JIBAS outbox rows exist; review/backfill explicitly before activation (no automatic replay)');
 return control;
}
module.exports={root,config,options,connect,assertSource,assertRuntime};
