'use strict';
// Non-destructive schema bootstrap. Fill config.json before running.
const fs=require('fs'),path=require('path');
const {root,config,connect,assertGateway,assertSource,assertCutover,acquireLock,assertRuntime,GATEWAY_LOCK,BRIDGE_LOCK}=require('./database');
const {inspectTriggers}=require('./bridge-triggers');
const {setMove}=require('./move');
function extractTables(sql){
 const tables=sql.match(/CREATE TABLE `\w+`\s*\([\s\S]*?\) ENGINE=[^;]+;/g)||[];
 if(tables.length!==10)throw Error('Unexpected original schema; expected 10 CREATE TABLE statements');
 return tables.map(sql=>sql.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
}
async function openDatabase(multipleStatements=false){
 const cfg=config();
 try { return {cfg,db:await connect(cfg,{multipleStatements}),exists:true}; }
 catch(err) {
  if(err.code!=='ER_BAD_DB_ERROR')throw err;
  return {cfg,db:await connect(cfg,{database:undefined,multipleStatements}),exists:false};
 }
}

async function checkDeployment({activateMove=true,diagnostic=false}={}){
 const {cfg,db,exists}=await openDatabase();
 try {
  await assertSource(db);
  if(diagnostic) return await assertRuntime(db,cfg.database);
  await inspectTriggers(db,cfg.database);
  if(activateMove) await assertCutover(db,cfg.database);
  if(exists){
   const [[row]]=await db.execute("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",[cfg.database]);
   if(Number(row.n)) await assertGateway(db,cfg.database);
  }
 }finally{await db.end();}
}
async function deploy({activateMove=true}={}){
 const {cfg,db:c,exists}=await openDatabase(true);
 const schema=cfg.database;
 try {
    await acquireLock(c,GATEWAY_LOCK);
    await acquireLock(c,BRIDGE_LOCK);
    await assertSource(c);
    await inspectTriggers(c,schema);
    // Refuse a default cutover with old JIBAS rows before any schema/data changes.
    if(activateMove) await assertCutover(c,schema);
   if(!exists){
    await c.query(`CREATE DATABASE IF NOT EXISTS ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.query(`USE ${schema}`);
   }
  const [tables]=await c.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",[schema]);
   if(!tables.length) for(const statement of extractTables(fs.readFileSync(path.join(root,'create tables','Create Tables - MySQL.sql'),'utf8')))await c.query(statement);
   else for(const t of ['inbox','outbox','sent']) if(!tables.some(r=>r.TABLE_NAME===t)) throw Error('Database sudah berisi data tetapi tabel '+t+' tidak ada; impor otomatis dibatalkan');
   await assertGateway(c,cfg.database);
  const [[status]]=await c.execute("SELECT DATA_TYPE,CHARACTER_MAXIMUM_LENGTH AS width FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='sent' AND COLUMN_NAME='status'",[schema]);
  if(!status||status.DATA_TYPE!=='varchar')throw Error('Unexpected sent.status schema; manual review required');
    if(Number(status.width)<20){
   await c.query('ALTER TABLE sent MODIFY status VARCHAR(20) NULL');
   console.log('Expanded sent.status to 20 characters (original width 5 cannot store failed).');
    }
    await require('./setup-bridge').setup(c,schema);
    await setMove(c,schema,activateMove);
  }finally{await c.end();}
  console.log(activateMove
   ? 'Schema dan trigger JIBAS siap. MOVE WhatsApp aktif; biarkan consumer SMS lama berhenti.'
   : 'Schema dan trigger JIBAS siap. MOVE dijeda; gunakan deployment/activate.js setelah cutover siap.');
}
module.exports={extractTables,checkDeployment,deploy};
if(require.main===module){
 const args=process.argv.slice(2);
 if(args.some(arg=>!['--check','--no-activate-move'].includes(arg))){
  console.error('Usage: node deployment/deploy.js [--no-activate-move] [--check]');process.exitCode=1;
 }else (args.includes('--check')?checkDeployment:deploy)({activateMove:!args.includes('--no-activate-move')})
  .catch(e=>{console.error(e.code||'',e.message);process.exitCode=1;});
}
