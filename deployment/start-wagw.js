'use strict';
// Deployment port adapter only; no installed driver modules are edited.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const {config,connect,assertRuntime}=require('./database');
function configureRuntime() {
const mysql = require('mysql2/promise');
const originalCreatePool = mysql.createPool;
mysql.createPool = function (options) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const port = Number(config.db_port || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid db_port');
  const timezone=config.timezone||'+07:00';
  const pool=originalCreatePool.call(this, { ...options, port,timezone });
  pool.on('connection',connection=>{
    connection.query('SET SESSION time_zone=?',[timezone],err=>{if(err)connection.destroy();});
  });
  return pool;
};
// Original dashboard has no authentication: bind it to loopback for SSH access.
const express=require('express');
const originalListen=express.application.listen;
express.application.listen=function(port,...args){
 if(typeof args[0]==='string')args.shift();
 return originalListen.call(this,port,'127.0.0.1',...args);
};
}
async function main(){
 const cfg=config(),db=await connect(cfg);
 try{
  await assertRuntime(db);
  const [[lock]]=await db.query("SELECT GET_LOCK('wagw-gateway',0) AS acquired");
  if(!lock.acquired)throw Error('Another gateway already owns the WAGW queue');
 }catch(e){await db.end();throw e;}
 let exiting=false;
 const fail=e=>{if(exiting)return;exiting=true;console.error('Gateway DB guard:',e.code||e.message);process.exit(1);};
 db.on('error',fail);
 configureRuntime();
 require(path.join(root, 'wabot.js'));
 let checking=false;
 setInterval(async()=>{if(checking)return;checking=true;try{await db.query('SELECT 1');}catch(e){fail(e);}finally{checking=false;}},10000);
}
module.exports={configureRuntime,main};
if(require.main===module)main().catch(e=>{console.error('Gateway startup failed:',e.code||'',e.message);process.exitCode=1;});
