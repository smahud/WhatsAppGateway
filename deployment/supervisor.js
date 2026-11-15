'use strict';
const {spawn}=require('child_process');
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
process.chdir(root);
const children=new Set();
let stopping=false;
function start(script,name){
 const log=fs.openSync(path.join(__dirname,name+'.log'),'a');
 const child=spawn(process.execPath,[path.join(__dirname,script)],{cwd:root,windowsHide:true,stdio:['ignore',log,log]});
 fs.closeSync(log); children.add(child);
 fs.writeFileSync(path.join(__dirname,name+'.pid'),String(child.pid));
 child.on('error',e=>console.error(name,e.message));
 child.on('exit',()=>{children.delete(child);if(!stopping)setTimeout(()=>start(script,name),5000);});
}
function stop(){stopping=true;for(const c of children)c.kill();setTimeout(()=>process.exit(),1000);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
start('start-wagw.js','gateway');start('bridge.js','bridge');
