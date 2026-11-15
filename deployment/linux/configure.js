'use strict';
const fs=require('fs'),path=require('path');
function configure(file,settings){
 const exists=fs.existsSync(file);
 const config=exists?JSON.parse(fs.readFileSync(file,'utf8')):{db_type:'mysql',database:'wagw',delay:10,timezone:'+07:00',webhook_url:'',bot_exe:''};
 if(!exists)Object.assign(config,{host:settings.host,db_port:Number(settings.dbPort),user:settings.dbUser,password:settings.dbPassword});
 config.db_port=Number(config.db_port||3306);
 config.port=Number(settings.backendPort);config.public_port=Number(settings.port);
 for(const key of ['port','public_port','db_port'])if(!Number.isInteger(config[key])||config[key]<1||config[key]>65535)throw Error('Invalid '+key);
 if(!config.host||!config.user||config.db_type!=='mysql'||config.database!=='wagw')throw Error('Invalid MySQL/JIBAS config');
 const temporary=file+'.install-tmp';
 fs.writeFileSync(temporary,JSON.stringify(config,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,file);fs.chmodSync(file,0o600);
 return config;
}
module.exports={configure};
if(require.main===module){try{configure(path.resolve(__dirname,'../../config.json'),{host:process.env.WG_DB_HOST,dbPort:process.env.WG_DB_PORT,dbUser:process.env.WG_DB_USER,dbPassword:process.env.WG_DB_PASSWORD,backendPort:process.env.WG_BACKEND_PORT,port:process.env.WG_PUBLIC_PORT});}catch(e){console.error(e.message);process.exitCode=1;}}
