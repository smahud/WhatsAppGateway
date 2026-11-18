'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {extractTables}=require('./deploy');
const {setup}=require('./setup-bridge');
const {definitions,inspectTriggers}=require('./bridge-triggers');
const {port,mysqlOptions,gatewaySchema}=require('./settings');
const {config,acquireLock,assertCutover,GATEWAY_LOCK}=require('./database');
const vm=require('vm');
function startupHarness({connect,assertRuntime,assertCutover=async()=>{},workerRunning=false,run}){
 const module={exports:{}};
 const context={module,__dirname:__dirname,console,setInterval,clearInterval,AbortController,require(name){
  if(name==='./settings')return {port};
  if(name==='./database')return {config:()=>({db_type:'mysql',database:'wagw',db_port:33445}),
    connect,assertRuntime,assertCutover,acquireLock,GATEWAY_LOCK,bridgeStatus:async()=>({moveEnabled:true,workerRunning})};
  if(name==='./bridge'&&run)return {run};
  throw Error('Unexpected import before successful preflight: '+name);
 }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'start-gateway.js'),'utf8'),context);
 return module.exports.main;
}
(async()=>{
 const schema=fs.readFileSync(path.join(__dirname,'..','create tables','Create Tables - MySQL.sql'),'utf8');
 const statements=extractTables(schema);
 assert.equal(statements.length,10);
 assert(statements.every(s=>s.startsWith('CREATE TABLE IF NOT EXISTS')&&!/\b(DROP|TRUNCATE|DELETE|ALTER)\b/i.test(s)));
 assert.throws(()=>extractTables('DROP TABLE live;'));
 await assert.rejects(startupHarness({connect:async()=>{throw Error('DB unavailable');}})(),/DB unavailable/);
 let closed=0;
 const connectDb=async()=>({on(){},end:async()=>{closed++;},execute:async()=>[[{acquired:'1'}]]});
 await assert.rejects(startupHarness({connect:connectDb,assertRuntime:async()=>{throw Error('Bad schema');}})(),/Bad schema/);
 await assert.rejects(startupHarness({connect:async()=>({...await connectDb(),execute:async()=>[[{acquired:0}]]})})(),/wagw-gateway/);
 await assert.rejects(startupHarness({connect:connectDb,assertRuntime:async()=>({enabled:1}),assertCutover:async()=>{throw Error('Old queue');}})(),/Old queue/);
  assert.equal(closed,3,'Preflight/lock/cutover failure must close DB before the gateway loads');
 let shutdown=0;
 let workerStarts=0,cutoverChecks=0;
 let signal;
 const app= startupHarness({connect:connectDb,assertRuntime:async()=>({enabled:1}),assertCutover:async()=>{cutoverChecks++;},
  run:(abort,cfg)=>{workerStarts++;signal=abort;assert.equal(cfg.database,'wagw');return Promise.resolve();}});
 const start=async(cfg,options)=>{
  assert.equal(cfg.db_port,33445);
  assert.equal(options.getJibasStatus().moveEnabled,true);
  assert.equal(options.expectJibasWorker,!options.getJibasStatus().maintenance);
  return {close:async()=>{shutdown++;}};
 };
 const application=await app({start});
 assert.equal(workerStarts,1,'No opt-in flag required for JIBAS worker');
 assert.equal(cutoverChecks,1);
 await application.close();
 await application.close();
 assert.equal(signal.aborted,true);
 assert.equal(shutdown,1);assert.equal(closed,4);
 const maintenance=await app({whatsapp:false,start});
 await maintenance.close();
 const external=await app({externalBridge:true,start});
 await external.close();
 assert.equal(workerStarts,1,'Maintenance and external systemd worker must not create duplicate workers');
 assert.equal(cutoverChecks,2);
 await assert.rejects(startupHarness({connect:connectDb,assertRuntime:async()=>({enabled:0}),workerRunning:true})({
   start:async (cfg,options)=>{
   throw Error('Worker duplication not guarded');
   }
 }),/Worker JIBAS lain/);
  let writes=[];
  const fixtures=definitions('jibas_wg').map(([name,event,body])=>({
   TRIGGER_NAME:name,EVENT_OBJECT_TABLE:'outbox',EVENT_MANIPULATION:event,ACTION_TIMING:'AFTER',
   ACTION_STATEMENT:body.replace('jibas_wg.bridge_outgoing','`jibas_wg`.`bridge_outgoing`')+';'
  }));
  const mock=existing=>({execute:async()=>[existing],query:async s=>{writes.push(s);}});
  await setup(mock([]),'jibas_wg');
  assert.equal(writes.length,3);
  assert(writes[1].startsWith('CREATE TRIGGER jbssms.jibas_wg_capture_outbox'));assert(!writes[1].includes('OR REPLACE'));
  writes=[]; assert.deepEqual(await inspectTriggers(mock(fixtures),'jibas_wg',{required:true}),[]);
  await assert.rejects(inspectTriggers(mock([{...fixtures[0],ACTION_STATEMENT:'DELETE FROM live'}]),'jibas_wg'),/differs/);
  await assert.rejects(inspectTriggers(mock([{...fixtures[0],EVENT_OBJECT_TABLE:'outboxhistory'}]),'jibas_wg'),/differs/);
  await assert.rejects(inspectTriggers(mock(fixtures),'wagw'),/database=jibas_wg/);
  await assert.rejects(inspectTriggers(mock([fixtures[0]]),'jibas_wg',{required:true}),/tidak terlihat/);
  assert.equal((await inspectTriggers(mock([]),'jibas_wg')).length,2);
  assert.equal(writes.length,0,'Read-only installer check must not create a missing trigger');
  await assert.rejects(assertCutover({execute:async()=>[[]],query:async()=>[[{count:3}]]},'wagw'),/3 pesan lama/);
  for(const bad of [{db_type:'sqlite',database:'wagw'},{db_type:'mysql',database:'unrelated',host:'localhost',user:'test'}])assert.throws(()=>config(bad),/JIBAS/);
  assert.equal(gatewaySchema(), 'jibas_wg');
  assert.equal(gatewaySchema('wagw'), 'wagw');
  assert.throws(()=>gatewaySchema('jibas_wg; other'),/JIBAS/);
 assert.equal(mysqlOptions({host:'localhost',database:'wagw',user:'fixture',db_port:'33445'}).port,33445);
 assert.equal(mysqlOptions({host:'localhost',database:'wagw',user:'fixture'}).port,3306);
 for(const bad of [0,false,'',3.5,65536])assert.throws(()=>port(bad,3306,'db_port'),/db_port/);
 for(const name of ['odbc','oracledb','mssql','sqlite3'])assert(!Object.keys(require.cache).some(p=>p.includes(path.sep+name+path.sep)));
 console.log('PASS: default JIBAS worker, required schema, maintenance/systemd ownership, old-row cutover refusal, trigger drift and DB port validation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
