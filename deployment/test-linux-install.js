'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {renderNginx}=require('./linux/render-nginx');
const {configure}=require('./linux/configure');
const base=path.resolve(__dirname,'..','dist');fs.mkdirSync(base,{recursive:true});
const directory=fs.mkdtempSync(path.join(base,'installer-test-'));
try{
 const file=path.join(directory,'config.json');
 const fresh=configure(file,{host:'127.0.0.1',dbPort:3434,dbUser:'fixture-user',dbPassword:'fixture-only-not-a-real-secret',backendPort:39000,port:3000});
 assert.equal(fresh.public_port,3000);assert.equal(fresh.port,39000);assert.equal(fresh.db_port,3434);
 const repeat=configure(file,{host:'wrong-host',dbPort:3306,dbUser:'wrong-user',dbPassword:'wrong-password',backendPort:39001,port:4000});
 assert.equal(repeat.password,fresh.password);assert.equal(repeat.host,fresh.host);assert.equal(repeat.user,fresh.user);
 assert.equal(repeat.public_port,4000);assert.equal(repeat.port,39001);
 const original=fs.readFileSync(file,'utf8');
 assert.throws(()=>configure(file,{backendPort:39000,port:70000}),/Invalid/);
 assert.equal(fs.readFileSync(file,'utf8'),original,'Invalid options must not overwrite config');
 const generated=renderNginx(3000,39000);
 assert(generated.includes('listen 3000 ssl;'));
 assert(generated.includes('proxy_pass http://127.0.0.1:39000;'));
 assert(generated.includes('auth_basic_user_file /etc/wagw/dashboard.htpasswd;'));
 assert(generated.includes('TLSv1.2 TLSv1.3'));
 assert(generated.includes('error_page 497 =301 https://$host:$server_port$request_uri;'));
 assert(generated.includes('if ($wagw_bad_origin = 1) { return 403; }'));
 assert(generated.includes('proxy_set_header Authorization "";'));
 assert(!generated.includes('fixture-only-not-a-real-secret'));
 assert.throws(()=>renderNginx('3000; arbitrary nginx directive',39000),/Invalid/);
 assert.throws(()=>renderNginx(3000,3000),/differ/);
 assert.throws(()=>renderNginx(0,39000),/Invalid/);
 assert(renderNginx(65535,39000).includes('listen 65535 ssl;'));
 console.log('PASS: fresh config, reinstall preserves DB credentials, port validation prevents overwrite, HTTPS/auth/CSRF proxy config, command injection rejected. No services/database/messages touched.');
}finally{
 const resolved=path.resolve(directory);
 if(path.dirname(resolved)!==base||!path.basename(resolved).startsWith('installer-test-'))throw Error('Unsafe test cleanup path');
 fs.rmSync(resolved,{recursive:true,force:true});
}
