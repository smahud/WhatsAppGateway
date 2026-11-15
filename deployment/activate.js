'use strict';
const {connect,assertRuntime}=require('./database');
(async()=>{const db=await connect();try{await assertRuntime(db);await db.query("UPDATE bridge_control SET enabled=1,mode='whatsapp',inbox_enabled=0 WHERE id=1");console.log('Outbox MOVE enabled; inbox disabled. Old SMS consumer must remain stopped.');}finally{await db.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
