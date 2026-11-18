'use strict';

const {config,connect,assertRuntime,assertCutover}=require('./database');

async function setMove(db,schema,enabled){
 await assertRuntime(db,schema);
 if(enabled) await assertCutover(db,schema);
 await db.execute('UPDATE bridge_control SET enabled=? WHERE id=1',[enabled?1:0]);
}

async function changeMove(enabled){
 const cfg=config();
 const db=await connect(cfg);
 try{await setMove(db,cfg.database,enabled);}finally{await db.end();}
 console.log(enabled
  ? 'MOVE WhatsApp JIBAS aktif. Consumer SMS lama harus tetap berhenti.'
  : 'MOVE JIBAS dijeda. Pesan yang sudah berada di outbox gateway tidak dibatalkan.');
}

module.exports={setMove,changeMove};
