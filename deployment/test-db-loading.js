'use strict';
// Evaluate API/init code with mocked drivers; no sockets, SQL, sessions or messages.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'wabot.js'), 'utf8');
const code = source.slice(0, source.lastIndexOf('loadConfig().then(config => {'));
const drivers = ['mysql2/promise', 'oracledb', 'mssql', 'sqlite3', 'sqlite', 'odbc'];
const expected = {mysql:['mysql2/promise'], oracle:['oracledb'], sqlserver:['mssql'], sqlite:['sqlite3','sqlite'], odbc:['odbc']};
function harness(type, blocked = []) {
  const loaded = new Set();
  const routes = {};
  let closed = 0;
  let timers = 0;
  const pool = {getConnection:async()=>({release(){}}), end:async()=>{closed++;}, close:async()=>{closed++;}, get:async()=>({name:'outbox'})};
  const mocks = {
    'mysql2/promise':{createPool:()=>pool},
    oracledb:{createPool:async()=>pool},
    mssql:{connect:async()=>pool},
    sqlite3:{Database:class Database{}},
    sqlite:{open:async()=>pool},
    odbc:{pool:async()=>pool}
  };
  const app = {use(){},get(){},post(route,handler){routes[route]=handler;}};
  const express = Object.assign(()=>app,{json:()=>()=>{},static:()=>()=>{}});
  const config = {db_type:type,host:'test-host',database:'test',user:'test'};
  const context = vm.createContext({
    __dirname:root, console:{log(){},error(){}}, setTimeout(){timers++;},
    require(name){
      if(drivers.includes(name)) {
        if(blocked.includes(name)) throw Error('Driver intentionally absent: '+name);
        loaded.add(name);return mocks[name];
      }
      if(name==='express')return express;
      if(name==='fs')return {readFileSync:()=>JSON.stringify(config),existsSync:()=>true};
      if(name==='path')return path;
      if(name==='child_process')return {};
      if(['@whiskeysockets/baileys','mime-types','qrcode-terminal'].includes(name))return {};
      throw Error('Unexpected import: '+name);
    }
  });
  vm.runInContext(code,context);
  return {context,loaded,routes,config,closed:()=>closed,timers:()=>timers};
}
(async()=>{
  for(const type of Object.keys(expected)) {
    const h=harness(type,drivers.filter(d=>!expected[type].includes(d)));
    assert.equal(h.loaded.size,0,'No DB driver should load at module startup');
    await vm.runInContext('initDatabase()',h.context);
    assert.equal(vm.runInContext('isDbConnected',h.context),true);
    assert.deepEqual([...h.loaded].sort(),[...expected[type]].sort());
    const test=harness('mysql',drivers.filter(d=>!expected[type].includes(d)));
    let response;
    await test.routes['/api/test-db']({body:{db_type:type,host:'test-host'}},{json(value){response=value;return this;}});
    assert.equal(response.success,true,'Test connection failed for '+type);
    assert.deepEqual([...test.loaded].sort(),[...expected[type]].sort());
    assert.equal(test.closed(),1,'Temporary test connection must close');
  }
  const switched=harness('mysql');
  await vm.runInContext('initDatabase()',switched.context);
  switched.config.db_type='sqlite';
  await vm.runInContext('initDatabase()',switched.context);
  assert.deepEqual([...switched.loaded].sort(),['mysql2/promise','sqlite','sqlite3']);
  const scheduler=harness('mysql');
  vm.runInContext('initOutboxProcessor(); initOutboxProcessor(); initOutboxProcessor();',scheduler.context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scheduler.timers(),1,'Reconnect must not multiply outbox schedulers');
  console.log('PASS: startup loads no DB drivers; all 5 DB init/test paths load only requested drivers; absent unused drivers are harmless; switching DB works. No real connections or messages.');
})().catch(e=>{console.error(e);process.exitCode=1;});
