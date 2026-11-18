'use strict';
const {config,connect,assertRuntime,countUncaptured,bridgeStatus}=require('./database');
(async()=>{
  if(process.argv.length>2)throw Error('Usage: node deployment/doctor.js');
  const c=config(),db=await connect(c);
  try{
    const [[server]]=await db.query('SELECT VERSION() AS version,@@session.time_zone AS timezone,NOW() AS now');
    const info={dbConnected:true,dbPort:c.db_port,database:server};
    try {
      await assertRuntime(db,c.database);
      const status=await bridgeStatus(db);
      const uncaptured=await countUncaptured(db,c.database);
      const [jobs]=await db.query('SELECT state,COUNT(*) AS count FROM bridge_outgoing GROUP BY state');
      const ok=!status.moveEnabled||uncaptured===0;
      console.log(JSON.stringify({...info,ok,bridgeConfigured:true,...status,uncaptured,cutoverReady:uncaptured===0,jobs},null,2));
      if(!ok)process.exitCode=1;
    } catch(err) {
      console.log(JSON.stringify({...info,ok:false,bridgeConfigured:false,reason:err.message},null,2));
      process.exitCode=1;
    }
  }finally{await db.end();}
})().catch(err=>{console.error('Preflight JIBAS gagal:',err.code||'',err.message);process.exitCode=1;});
