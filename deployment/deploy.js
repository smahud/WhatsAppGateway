'use strict';
// Non-destructive schema bootstrap. Fill config.json before running.
const fs=require('fs'),path=require('path');
const {root,connect,assertSource,assertRuntime}=require('./database');
function extractTables(sql){
 const tables=sql.match(/CREATE TABLE `\w+`\s*\([\s\S]*?\) ENGINE=[^;]+;/g)||[];
 if(tables.length!==10)throw Error('Unexpected original schema; expected 10 CREATE TABLE statements');
 return tables.map(sql=>sql.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
}
async function deploy(){
 const c=await connect(undefined,{database:undefined});
 try {
  await assertSource(c);
  await c.query('CREATE DATABASE IF NOT EXISTS wagw CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await c.query('USE wagw');
  const [tables]=await c.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='wagw' AND TABLE_TYPE='BASE TABLE'");
  if(!tables.length) for(const statement of extractTables(fs.readFileSync(path.join(root,'create tables','Create Tables - MySQL.sql'),'utf8')))await c.query(statement);
  else for(const t of ['inbox','outbox','sent']) if(!tables.some(r=>r.TABLE_NAME===t)) throw Error('Database sudah berisi data tetapi tabel '+t+' tidak ada; impor otomatis dibatalkan');
  const [[status]]=await c.query("SELECT DATA_TYPE,CHARACTER_MAXIMUM_LENGTH AS width FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='wagw' AND TABLE_NAME='sent' AND COLUMN_NAME='status'");
  if(!status||status.DATA_TYPE!=='varchar')throw Error('Unexpected sent.status schema; manual review required');
  if(Number(status.width)<20){
   await c.query('ALTER TABLE wagw.sent MODIFY status VARCHAR(20) NULL');
   console.log('Expanded sent.status to 20 characters (original width 5 cannot store failed).');
  }
 }finally{await c.end();}
 await require('./setup-bridge').setup();
 const db=await connect();try{await assertRuntime(db);}finally{await db.end();}
 console.log('Deploy complete. Bridge remains disabled on fresh installs; run doctor before activation.');
}
module.exports={extractTables,deploy};
if(require.main===module)deploy().catch(e=>{console.error(e.message);process.exitCode=1});
