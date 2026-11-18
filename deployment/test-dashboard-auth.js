'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const express = require('express');
const { configureCredentials, readCredentials, dashboardAuth, verify } = require('./dashboard-auth');
const bcrypt = require('bcryptjs');

async function test() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jibas-wg-auth-fixture-'));
  const file = path.join(dir, 'dashboard-auth.json');
  const legacyFile = path.join(dir, 'dashboard.htpasswd');
  const app = express();
  app.use(dashboardAuth({file}));
  app.get('/', (_req, res) => res.end('dashboard content'));
  app.post('/api/send', (_req, res) => res.end('fixture, no send'));
  const server = app.listen(0, '127.0.0.1');
  const secureApp = express();
  secureApp.use(dashboardAuth({file, https:true}));
  secureApp.get('/', (_req, res) => res.end('dashboard content'));
  const secure = secureApp.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    const secureUrl = `http://127.0.0.1:${secure.address().port}`;
    const request = (route, options) => fetch(url + route, {redirect:'manual',...options});
    const form = (username,password) => new URLSearchParams({username,password});
    const signin = (user,pass,origin=url) => request('/login', {method:'POST',body:form(user,pass),headers:{origin}});
    assert.equal((await request('/')).status,503,'Missing credentials fail closed');
    const fresh = configureCredentials({file});
    assert.equal(fresh.user,'admin');
    assert(fresh.generated.length >= 24);
    assert(await verify('admin',fresh.generated,readCredentials(file)));
    assert.deepEqual(configureCredentials({file}),{user:'admin'});
    const changedUser = configureCredentials({file,user:'operator'});
    assert(changedUser.generated && changedUser.generated !== fresh.generated);
    configureCredentials({file,password:'test:satu'});
    assert.equal(readCredentials(file).user,'operator','Only password replaces the existing user password');
    assert.notEqual(readCredentials(file).hash,'test:satu');
    const redirect = await request('/');
    assert.equal(redirect.status,303);
    assert.equal(redirect.headers.get('location'),'/login');
    assert.equal(redirect.headers.get('www-authenticate'),null);
    assert.match(await (await request('/login')).text(),/<form method="post" action="\/login">/);
    assert.equal((await signin('operator','wrong')).status,401);
    assert.equal((await signin('operator','test:satu','https://other.invalid')).status,403);
    const login = await signin('operator','test:satu');
    assert.equal(login.status,303);
    assert.equal(login.headers.get('location'),'/');
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie,/HttpOnly/); assert.match(cookie,/SameSite=Strict/);
    assert.match(cookie,/^jibas_wg_session=/);
    assert.doesNotMatch(cookie,/\bSecure\b/);
    const session = cookie.split(';')[0];
    assert.equal(await (await request('/',{headers:{cookie:session}})).text(),'dashboard content');
    const send = origin => request('/api/send',{method:'POST',headers:{cookie:session,origin}});
    assert.equal((await send('https://untrusted.invalid')).status,403);
    assert.equal((await send(url)).status,200);
    assert.equal((await request('/api/send',{method:'POST'})).status,401);
    assert.equal((await request('/logout',{method:'POST',headers:{cookie:session,origin:url}})).status,303);
    assert.equal((await request('/',{headers:{cookie:session}})).status,303,'Logout invalidates old cookie');
    const second = (await signin('operator','test:satu')).headers.get('set-cookie').split(';')[0];
    configureCredentials({file,user:'new-operator',password:'test:dua'});
    assert.equal((await request('/',{headers:{cookie:second}})).status,303,'Rotation invalidates previous sessions');
    assert.equal((await fetch(secureUrl+'/')).status,403,'Linux dashboard requires HTTPS proxy');
    const requestHost = new URL(secureUrl).host;
    const proxied = await fetch(secureUrl+'/login',{method:'POST',redirect:'manual',body:form('new-operator','test:dua'),
      headers:{'x-forwarded-proto':'https',origin:`https://${requestHost}`}});
    assert.equal(proxied.status,303);
    assert.match(proxied.headers.get('set-cookie'),/\bSecure\b/);
    assert.match(proxied.headers.get('set-cookie'),/^__Host-jibas_wg_session=/);
    fs.rmSync(file);
    fs.writeFileSync(legacyFile,`legacy:${bcrypt.hashSync('legacy-secret',5).replace(/^\$2b/,'$2y')}\n`);
    assert.deepEqual(configureCredentials({file,legacyFile}),{user:'legacy'});
    assert.equal(readCredentials(file).version,2);
    assert.equal((await signin('legacy','legacy-secret')).status,303,'Migrated Linux password authenticates via page');
    fs.writeFileSync(file, '{broken fixture');
    assert.equal((await request('/')).status,503);
    assert.equal(configureCredentials({file,user:'reset'}).user,'reset');
    console.log('PASS: login page/cookie flow, default and replacement credentials, live session invalidation, CSRF, HTTPS and legacy bcrypt migration.');
  } finally {
    await Promise.all([server,secure].map(s=>new Promise(resolve=>s.close(resolve))));
    fs.rmSync(dir, {recursive:true,force:true});
  }
}
test().catch(err=>{console.error(err);process.exitCode=1;});
