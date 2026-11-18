'use strict';
const {root,readConfig,dbType,mysqlOptions,gatewaySchema}=require('./settings');
const {inspectTriggers}=require('./bridge-triggers');
// Keep the same locks across versions/schemas: both workers consume jbssms.outbox.
const GATEWAY_LOCK='wagw-gateway', BRIDGE_LOCK='wagw-jibas-bridge';
function config(c=readConfig()){
 if(dbType(c)!=='mysql')throw Error('JIBAS membutuhkan db_type=mysql dan jbssms pada instance yang sama');
 const options=mysqlOptions(c);
 return {...c,database:gatewaySchema(c.database),db_port:options.port,timezone:options.timezone};
}
async function connect(c=config(),extra={}){
 const options={...mysqlOptions(c),...extra};
 const db=await require('mysql2/promise').createConnection(options);
 try{await db.query('SET SESSION time_zone=?',[options.timezone]);return db;}catch(e){await db.end().catch(()=>{});throw e;}
}
async function assertGateway(db,schema){
 const required={
  inbox:['id','wa_no','sub_no','wa_text','wa_time','status'],
  outbox:['id','wa_no','wa_text','wa_media','wa_file'],
  sent:['id','wa_mode','wa_no','wa_text','wa_media','wa_file','wa_time','status']
 };
 const [columns]=await db.execute(
  `SELECT c.TABLE_NAME AS name,c.COLUMN_NAME AS field,c.CHARACTER_MAXIMUM_LENGTH AS width,t.ENGINE AS engine
   FROM information_schema.COLUMNS c JOIN information_schema.TABLES t
     ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
   WHERE c.TABLE_SCHEMA=? AND c.TABLE_NAME IN ('inbox','outbox','sent')`,
  [schema]
 );
 for(const [name,fields] of Object.entries(required)){
  for(const field of fields)if(!columns.some(c=>c.name===name&&c.field.toLowerCase()===field))throw Error('Missing or inaccessible gateway column '+name+'.'+field+'; check schema/permissions');
 }
 for(const name of ['outbox','sent'])if(columns.find(c=>c.name===name).engine!=='InnoDB')throw Error(name+' must use InnoDB for safe queue writes');
 const width=Number(columns.find(c=>c.name==='sent'&&c.field.toLowerCase()==='status').width);
 if(width<4)throw Error('Gateway requires a text sent.status of at least 4 characters');
 return {sentStatusWidth:width};
}
async function assertSource(db){
 const [tables]=await db.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='jbssms' AND TABLE_NAME='outbox'");
 if(tables.length!==1||tables[0].ENGINE!=='InnoDB')throw Error('jbssms.outbox must exist on this DB server and use InnoDB');
 const [columns]=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='jbssms' AND TABLE_NAME='outbox'");
 for(const name of ['ID','DestinationNumber','Text','TextDecoded','SendingDateTime','MultiPart'])if(!columns.some(c=>c.COLUMN_NAME===name))throw Error('Missing jbssms.outbox.'+name);
}
async function assertRuntime(db,schema){
 gatewaySchema(schema);
 await assertSource(db);
 const [tables]=await db.execute("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('bridge_control','bridge_outgoing')",[schema]);
 if(tables.length!==2||tables.some(t=>t.ENGINE!=='InnoDB'))throw Error('Tabel bridge JIBAS belum lengkap atau bukan InnoDB; jalankan deployment/deploy.js');
 const {sentStatusWidth}=await assertGateway(db,schema);
 if(sentStatusWidth<20)throw Error('Jalankan deployment/deploy.js: sent.status memerlukan minimal 20 karakter');
 await inspectTriggers(db,schema,{required:true});
 const [[control]]=await db.query('SELECT * FROM bridge_control WHERE id=1');
 if(!control||control.mode!=='whatsapp'||Number(control.inbox_enabled)!==0)throw Error('Bridge JIBAS wajib menggunakan MOVE WhatsApp (inbox_enabled=0)');
 return control;
}

async function countUncaptured(db,schema){
 schema=gatewaySchema(schema);
 const [[table]]=await db.execute("SELECT 1 AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='bridge_outgoing'",[schema]);
 const [[row]]=await db.query(table
  ? `SELECT COUNT(*) AS count FROM jbssms.outbox s LEFT JOIN ${schema}.bridge_outgoing b ON b.source_id=s.ID WHERE b.id IS NULL`
  : 'SELECT COUNT(*) AS count FROM jbssms.outbox');
 return Number(row.count);
}
async function assertCutover(db,schema){
 const count=await countUncaptured(db,schema);
 if(count)throw Error(`${count} pesan lama di jbssms.outbox belum tercatat oleh trigger. Rekonsiliasi antrean sebelum mengaktifkan MOVE; tidak ada pengiriman ulang otomatis.`);
}
async function acquireLock(db,name){
 const [[lock]]=await db.execute('SELECT GET_LOCK(?,0) AS acquired',[name]);
 if(Number(lock.acquired)!==1)throw Error(`Proses lain masih memegang lock ${name}; hentikan dahulu sebelum melanjutkan`);
}
async function bridgeStatus(db){
 const [[row]]=await db.query({
  sql:"SELECT enabled,mode,inbox_enabled,IS_USED_LOCK(?) AS worker FROM bridge_control WHERE id=1",
  values:[BRIDGE_LOCK],
  timeout:5000
 });
 if(!row||row.mode!=='whatsapp'||Number(row.inbox_enabled)!==0)throw Error('Kontrol MOVE JIBAS tidak valid');
 return {moveEnabled:Number(row.enabled)===1,workerRunning:row.worker!=null};
}
module.exports={root,config,connect,assertGateway,assertSource,assertRuntime,countUncaptured,assertCutover,acquireLock,bridgeStatus,GATEWAY_LOCK,BRIDGE_LOCK};
