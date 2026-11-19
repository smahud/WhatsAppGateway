'use strict';
// Mock DB drivers and Baileys: no SQL, credentials, sockets or messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const settings = require('./settings');
const {config: jibasConfig} = require('./database');
const { redactSessionLogs } = require('./session-logs');
const source = fs.readFileSync(path.join(settings.root, 'gateway.js'), 'utf8');
const drivers = ['mysql2/promise'];

function harness(type) {
  const loaded = new Set();
  const routes = {};
  const socketEvents = [];
  const mysqlOptions = [];
  const capturedSql = [];
  const timers = new Set();
  let closed = 0;
  let failQuery = false;
  let failRecording = false;
  let sendAttempts = 0;
  let schemaChecks = 0;
  const connection = {
    query:async () => { if (failQuery) throw Error('fixture DB rejected'); },
    execute:async (sql, parameters) => {
      capturedSql.push({sql, parameters});
      if (sql.startsWith('SELECT * FROM outbox')) {
        return [[{id:99,wa_no:'6280000000',wa_text:'test fixture'}]];
      }
      if (sql.startsWith('SELECT id FROM outbox')) return [[{id:99}]];
      if (sql.startsWith('INSERT INTO sent') && failRecording) throw Error('fixture receipt write rejected');
      return [[]];
    },
    release(){},
    end:async()=>{closed++;},
    beginTransaction:async()=>{capturedSql.push('begin');},
    commit:async()=>{capturedSql.push('commit');},
    rollback:async()=>{capturedSql.push('rollback');}
  };
  const pool = {getConnection:async()=>connection, end:connection.end, close:connection.end, get:async()=>({name:'outbox'})};
  const mocks = {
    'mysql2/promise':{
      createPool:opts=>{mysqlOptions.push(opts);return pool;},
      createConnection:async opts=>{mysqlOptions.push(opts);return connection;}
    }
  };
  const app = {use(route,fn){if(Array.isArray(route))for(const entry of route)routes[entry]=fn;},get(route,fn){routes[route]=fn;},post(route,fn){for(const entry of [route].flat())routes[entry]=fn;}};
  const express = Object.assign(()=>app,{json:()=>()=>{},static:()=>()=>{}});
  const config = {db_type:type,host:'test-host',database:'test',user:'test',db_port:33445,password:'mock-only'};
  const context = vm.createContext({
    __dirname:settings.root, module:{exports:{}}, process:{platform:'linux',pid:10,env:{}}, console:{log(){},error(){}},
    setTimeout(fn){timers.add(fn);return fn;}, clearTimeout(fn){timers.delete(fn);},
    require(name){
      if(drivers.includes(name)) {
        loaded.add(name);return mocks[name];
      }
      if(name==='express')return express;
      if(name==='fs')return {readFileSync:()=>JSON.stringify(config)};
      if(name==='./deployment/settings')return {...settings,readConfig:()=>({...config})};
      if(name==='./package.json')return require('../package.json');
      if(name==='./deployment/database')return {
        config:jibasConfig,
        connect:async cfg=>{mysqlOptions.push(settings.mysqlOptions(cfg));return connection;},
        assertRuntime:async()=>{schemaChecks++;return {enabled:0};}
      };
      if(name==='./deployment/session-logs')return {redactSessionLogs(){}};
      if(name==='./deployment/dashboard-auth')return {dashboardAuth:()=>()=>{},readCredentials:()=>({user:'fixture'})};
      if(name==='path')return path;
      if(name==='node:events')return require('node:events');
      if(name==='child_process'||name==='mime-types')return {};
      if(name==='qrcode')return {toString:async()=>'<svg></svg>'};
      if(name==='@whiskeysockets/baileys')return {
        DisconnectReason:{connectionReplaced:440,loggedOut:401},
        useMultiFileAuthState:async()=>({state:{},saveCreds:async()=>{}}),
        default(){
          const ev = new EventEmitter();
          socketEvents.push(ev);
          return {ev, end(){ev.emit('connection.update',{connection:'close'});},
             async sendMessage(){sendAttempts++;throw Error('simulated failure');}};
        }
      };
      throw Error('Unexpected import: '+name);
    }
  });
  vm.runInContext(source,context);
  function call(route,body){
    let response,status=200;
    return Promise.resolve(routes[route]({body},{
      json(value){response=value;return this;},status(code){status=code;return this;}
    })).then(()=>Object.assign(response,{httpStatus:status}));
  }
  return {run:src=>vm.runInContext(src,context),call,loaded,config,closed:()=>closed,timers,socketEvents,mysqlOptions,capturedSql,
    failQuery:()=>{failQuery=true;},schemaChecks:()=>schemaChecks,
    failRecording:value=>{failRecording=value;},sendAttempts:()=>sendAttempts};
}

(async()=>{
  const h=harness('mysql');
  assert.equal(h.loaded.size,0,'No DB driver should load at module startup');
  await h.run('initDatabase()');
  assert.equal(h.run('isDbConnected'),true);
  assert.deepEqual([...h.loaded].sort(),[...drivers].sort());
  const test=harness('mysql');
  const response=await test.call('/api/test-db',{db_type:'mysql',host:'test-host'});
  assert.equal(response.success,true,'Test connection failed for MySQL');
  assert.deepEqual([...test.loaded].sort(),[...drivers].sort());
  assert.equal(test.closed(),1,'Temporary test connection must close');

  const mysql=harness('mysql');
  await mysql.run('initDatabase()');
  assert.equal(mysql.mysqlOptions[0].port,33445);
  assert.equal((await mysql.call('/api/test-db',{})).success,true);
  assert.equal(mysql.mysqlOptions[1].port,33445);
  assert.equal(mysql.mysqlOptions[1].password,'mock-only');
  assert.equal((await mysql.call('/api/test-db',{db_port:'3309'})).success,true);
  assert.equal(mysql.mysqlOptions[2].port,3309);
  assert.notEqual(mysql.mysqlOptions[2].password,'mock-only','Never forward password to a different port');
  assert.equal((await mysql.call('/api/test-db',{db_port:0})).success,false);
  assert(!Object.hasOwn(await mysql.call('/api/config'),'password'));
  mysql.failQuery();
  assert.equal((await mysql.call('/api/test-db',{})).success,false);
  assert.equal(mysql.closed(),3,'Close failed test connection too');

  const managed=harness('mysql');
  managed.config.database='wagw';
  managed.run('isDbConnected=true; expectJibasWorker=true; getJibasStatus=()=>({workerRunning:false,moveEnabled:true});');
  assert.equal((await managed.call('/api/test-db',{db_type:'sqlite'})).success,false);
  assert.equal((await managed.call('/api/test-db',{database:'not-wagw'})).success,false);
  assert.equal((await managed.call('/api/test-db',{db_port:33445})).success,true);
  assert.equal(managed.schemaChecks(),1);
  assert.equal(managed.mysqlOptions[0].port,33445);
  assert.equal((await managed.call('/healthz')).httpStatus,503);
  managed.run('getJibasStatus=()=>({workerRunning:true,moveEnabled:true});');
  assert.equal((await managed.call('/healthz')).httpStatus,200);
  assert.equal((await managed.call('/api/clear-outbox')).httpStatus,409);
  assert.equal((await managed.call('/api/clear-sent')).httpStatus,409);
  assert.equal((await managed.call('/api/apply-update')).httpStatus,403,'Legacy update API must not write files');
  assert.equal((await managed.call('/api/config',{delay:0})).httpStatus,500);
  assert.equal((await managed.call('/api/send',{no:'081234567890',text:'fixture',file:'example.pdf'})).httpStatus,400);
  assert.equal((await managed.call('/api/send-bulk',{messages:[{no:'081234567890',text:'fixture'},{no:'invalid'}]})).httpStatus,400);
  assert.equal(managed.capturedSql.length,0,'Blocking bulk deletes must not query the DB');

  mysql.run('scheduleOutbox(); scheduleOutbox(); scheduleOutbox();');
  assert.equal(mysql.timers.size,1,'Only one outbox scheduler');
  mysql.run('startSession(); startSession(); startSession();');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(mysql.socketEvents.length,1,'Only one WhatsApp socket');
  mysql.socketEvents[0].emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:440}}}});
  assert.equal(mysql.run('waState'),'conflict');
  assert.equal(mysql.timers.size,1,'Conflict must not reconnect or multiply outbox schedulers');
  await mysql.call('/api/wa-control',{action:'start'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(mysql.socketEvents.length,2);
  mysql.socketEvents[1].emit('connection.update',{connection:'open'});
  assert.equal(mysql.run('waState'),'ready');
  mysql.failRecording(true);
  await assert.rejects(mysql.run('sentStatusWidth=5; processOutbox(99)'),/receipt write rejected/);
  mysql.failRecording(false);
  assert.equal(await mysql.run('processOutbox(99)'),'fail');
  assert.equal(mysql.sendAttempts(),1,'A receipt retry must not send the same message twice');
  assert.match(mysql.capturedSql[0].sql,/WHERE id = \?/);
  assert.equal(mysql.capturedSql[0].parameters[0],99);
  assert.equal(mysql.capturedSql[1],'begin');
  assert.equal(mysql.capturedSql.find(item=>item.sql?.startsWith('INSERT INTO sent')).parameters[5],'fail');
  assert.equal(mysql.capturedSql.at(-1),'commit');

  let written=[];
  const logger={info:(...args)=>written.push(args),warn:(...args)=>written.push(args),error:(...args)=>written.push(args)};
  redactSessionLogs(logger);
  logger.info('Closing session:',{privateMaterial:'do not log'});
  logger.warn('A normal warning');
  assert.deepEqual(written,[['A normal warning']]);
  console.log('PASS: MySQL-only loading, DB ports, enforced JIBAS config and worker readiness, protected queue history, and single WhatsApp socket/scheduler.');
})().catch(e=>{console.error(e);process.exitCode=1;});
