'use strict';
const fs=require('node:fs'),path=require('node:path');
const {readConfig,dbType,mysqlOptions,port,gatewaySchema}=require('../settings');

function configure(file,settings){
 const config=readConfig(settings.sourceFile||file);
 if(dbType(config)!=='mysql')throw Error('Installer requires db_type=mysql');
 config.database=gatewaySchema(config.database);
 if(settings.installedFile&&fs.existsSync(settings.installedFile)&&readConfig(settings.installedFile).database!==config.database){
  throw Error('Gunakan nama database dari instalasi lama agar antrean JIBAS WG tidak terpisah.');
 }
 config.db_type='mysql';
 config.db_port=mysqlOptions(config).port;
 config.port=port(settings.port,3000,'port');
 config.backend_port=port(settings.backendPort,39000,'backend_port');
 delete config.public_port;
 if(config.port===config.backend_port)throw Error('Port dashboard dan backend harus berbeda');
 const temporary=file+'.install-tmp';
 fs.writeFileSync(temporary,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
 try {fs.renameSync(temporary,file);fs.chmodSync(file,0o600);}
 finally {fs.rmSync(temporary,{force:true});}
 return config;
}
module.exports={configure};
if(require.main===module){
 try{
  configure(path.resolve(__dirname,'../../config.json'),{
   backendPort:process.env.JIBAS_WG_BACKEND_PORT,port:process.env.JIBAS_WG_PUBLIC_PORT,
   installedFile:process.env.JIBAS_WG_INSTALLED_CONFIG
  });
 }catch(e){console.error(e.code||'',e.message);process.exitCode=1;}
}
