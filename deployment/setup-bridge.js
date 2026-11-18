'use strict';
const fs=require('fs'),path=require('path');
const {inspectTriggers}=require('./bridge-triggers');
async function setup(db,schema){
 const missing=await inspectTriggers(db,schema);
 await db.query(fs.readFileSync(path.join(__dirname,'bridge-schema.sql'),'utf8'));
 // Install once; do not drop/recreate triggers while live JIBAS writes may occur.
 for(const [name,event,body] of missing) {
  await db.query(`CREATE TRIGGER jbssms.${name} AFTER ${event} ON jbssms.outbox FOR EACH ROW ${body}`);
 }
 console.log('Schema dan trigger capture outbox JIBAS siap.');
}
module.exports={setup};
if(require.main===module){
 console.error('Gunakan node deployment/deploy.js untuk menyiapkan schema dan trigger JIBAS bersama.');
 process.exitCode=1;
}
