'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {extractTables}=require('./deploy');
const {ensureTrigger}=require('./setup-bridge');
const vm=require('vm');
function startupHarness(connect,assertRuntime){
 const module={exports:{}};
 const context={module,__dirname:__dirname,process:{chdir(){}},console,require(name){
  if(name==='fs')return fs;if(name==='path')return path;
  if(name==='./database')return {config:()=>({}),connect,assertRuntime};
  throw Error('Unexpected import before successful preflight: '+name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'start-wagw.js'),'utf8'),context);
 return module.exports.main;
}
(async()=>{
 const schema=fs.readFileSync(path.join(__dirname,'..','create tables','Create Tables - MySQL.sql'),'utf8');
 const statements=extractTables(schema);
 assert.equal(statements.length,10);
 assert(statements.every(s=>s.startsWith('CREATE TABLE IF NOT EXISTS')&&!/\b(DROP|TRUNCATE|DELETE|ALTER)\b/i.test(s)));
 assert.throws(()=>extractTables('DROP TABLE live;'));
 await assert.rejects(startupHarness(async()=>{throw Error('DB unavailable');},async()=>{})(),/DB unavailable/);
 let closed=0;
 const blocked={end:async()=>{closed++;},query:async()=>[[{acquired:0}]]};
 await assert.rejects(startupHarness(async()=>blocked,async()=>{throw Error('Bad schema');})(),/Bad schema/);
 await assert.rejects(startupHarness(async()=>blocked,async()=>{})(),/Another gateway/);
 assert.equal(closed,2,'Preflight/lock failure must close DB before WAGW loads');
 let writes=[];
 const body="INSERT INTO wagw.bridge_outgoing(source_id) VALUES(NEW.ID)";
 const mock=existing=>({execute:async()=>[existing],query:async s=>{writes.push(s);}});
 await ensureTrigger(mock([]),'test_capture','INSERT',body);
 assert.equal(writes.length,1);assert(writes[0].startsWith('CREATE TRIGGER'));assert(!writes[0].includes('OR REPLACE'));
 writes=[];await ensureTrigger(mock([{ACTION_STATEMENT:' INSERT INTO `wagw`.`bridge_outgoing`(source_id) VALUES(NEW.ID); '}]),'test_capture','INSERT',body);assert.equal(writes.length,0);
 await assert.rejects(ensureTrigger(mock([{ACTION_STATEMENT:'DELETE FROM live'}]),'test_capture','INSERT',body),/differs/);assert.equal(writes.length,0);
 // Verify loopback binding without loading WAGW or touching WhatsApp.
 require('./start-wagw').configureRuntime();
 const mysql=require('mysql2/promise');
 const pool=mysql.createPool({host:'localhost',user:'unused'});
 assert.equal(pool.pool.config.connectionConfig.port,Number(require('../config.json').db_port||3306));
 await pool.end();
 const express=require('express'),app=express();
 const server=app.listen(0);
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 assert.equal(server.address().address,'127.0.0.1');await new Promise(resolve=>server.close(resolve));
 for(const name of ['odbc','oracledb','mssql','sqlite3'])assert(!Object.keys(require.cache).some(p=>p.includes(path.sep+name+path.sep)));
 console.log('PASS: non-destructive schema extraction, portable/idempotent triggers, drift refusal, configured MySQL port, loopback binding, unused drivers absent. No external connections/messages.');
})().catch(e=>{console.error(e);process.exitCode=1;});
