'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function run() {
  const elements = new Map();
  const qrBox = {
    innerHTML:'',
    querySelector(selector) {
      if (selector === 'img' || this.innerHTML.includes(selector.slice(4,-1))) return {addEventListener(){}};
      return null;
    }
  };
  elements.set('qr-container',qrBox);
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id,{addEventListener(){},style:{},classList:{contains:()=>true}});
    return elements.get(id);
  };
  let start, responses = 0;
  const intervals = [], redirects = [];
  let status = 200, data = {jibas:{workerRunning:true,moveEnabled:true},qr:null};
  const context = vm.createContext({
    document:{
      addEventListener(name, fn){ if (name === 'DOMContentLoaded') start = fn; },
      getElementById, querySelectorAll:()=>[], querySelector:()=>({}), hidden:false
    },
    window:{location:{replace:route=>redirects.push(route)}},
    setInterval:fn=>intervals.push(fn), AbortSignal,
    fetch:async () => {responses++; return {status,json:async()=>data};}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),context);
  start();
  await new Promise(setImmediate);
  assert.equal(intervals.length,1);
  data.qr = 2;
  intervals[0]();
  await new Promise(setImmediate);
  assert(qrBox.innerHTML.includes('src="/api/pairing-qr?v=2"'));
  data.qr = 3;
  intervals[0]();
  await new Promise(setImmediate);
  assert(qrBox.innerHTML.includes('src="/api/pairing-qr?v=3"'));
  context.document.hidden = true;
  intervals[0]();
  assert.equal(responses,3,'Do not poll hidden dashboard tabs');
  context.document.hidden = false;
  status = 401;
  intervals[0]();
  await new Promise(setImmediate);
  assert.deepEqual(redirects,['/login']);
  console.log('PASS: status polling updates pairing QR and handles an expired dashboard session.');
}

run().catch(err=>{console.error(err);process.exitCode=1;});
