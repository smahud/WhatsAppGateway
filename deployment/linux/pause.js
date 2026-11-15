'use strict';
const {connect}=require('../database');
(async()=>{const db=await connect();try{await db.query('UPDATE bridge_control SET enabled=0,inbox_enabled=0 WHERE id=1');console.log('Outbox transfer paused.');}finally{await db.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
