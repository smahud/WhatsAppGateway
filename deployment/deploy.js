'use strict';
// Non-destructive schema bootstrap. Fill config.json before running.
const fs=require('fs'),path=require('path'),mysql=require('mysql2/promise');
const root=path.resolve(__dirname,'..'),cfg=require('../config.json');
(async()=>{
 if(cfg.db_type!=='mysql'||cfg.database!=='wagw') throw Error('Deployment ini memerlukan db_type=mysql dan database=wagw');
 const c=await mysql.createConnection({host:cfg.host,port:Number(cfg.db_port||3306),user:cfg.user,password:cfg.password,multipleStatements:true});
 try {
  await c.query('CREATE DATABASE IF NOT EXISTS wagw CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  const [tables]=await c.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='wagw' AND TABLE_TYPE='BASE TABLE'");
  if(!tables.length) await c.query(fs.readFileSync(path.join(root,'create tables','Create Tables - MySQL.sql'),'utf8'));
  else for(const t of ['inbox','outbox','sent']) if(!tables.some(r=>r.TABLE_NAME===t)) throw Error('Database sudah berisi data tetapi tabel '+t+' tidak ada; impor otomatis dibatalkan');
  const [[jibas]]=await c.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA='jbssms' AND TABLE_NAME='outbox'");
  if(!jibas.n) throw Error('jbssms.outbox tidak ditemukan');
 }finally{await c.end();}
 require('./setup-bridge');
})().catch(e=>{console.error(e.message);process.exitCode=1});
